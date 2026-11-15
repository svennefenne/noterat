"""The loop: ask Noterat for a job, fetch its files, do it, send the result back. Forever, through a
server that restarts, a network that drops and a token that's wrong, without crashing.

Three kinds of job: transcribe (a recording to text), ocr (a scan's pages to text and a searchable
PDF, the pages found in photos and straightened first where the job asks for it) and recipe (a web
page the server fetched, read for its recipe)."""

from __future__ import annotations

import logging
import os
import tempfile
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from typing import Any

from .client import ApiError, Client, JobGone, NotFound, Unauthorized, Unreachable
from .model import Model, Segment, UndecodableAudio, join_text
from .recipe import NoRecipe, RecipeReader, UndecodablePage, clip, decode_page
from .scan import Cancelled, OcrFailed, Page, Scanner, UndecodableImage, UnknownLanguage, join_pages, language_of, page_text

log = logging.getLogger("noterat_worker")


class Stopping(Exception):
    """The worker was told to stop (SIGTERM, Ctrl+C)."""


class Shutdown:
    """The signal handler and the flag it sets.

    The flag is enough while a job runs: the loop looks at it between segments (or pages), and gives
    the job back. While the worker only waits (on the server's 25-s long poll, or for the model to
    load), the handler also raises Stopping, so `docker stop` doesn't have to wait for the wait. A
    second signal quits at once.
    """

    def __init__(self) -> None:
        self.event = threading.Event()
        self._interruptible = False

    def __call__(self, signum: int, frame: Any) -> None:
        if self.event.is_set():
            raise SystemExit(1)
        self.event.set()
        if self._interruptible:
            raise Stopping()

    def is_set(self) -> bool:
        return self.event.is_set()

    def set(self) -> None:
        self.event.set()

    def wait(self, seconds: float) -> bool:
        """Sleeps, but wakes up for a stop. True when stopping."""
        return self.event.wait(max(0.0, seconds))

    @contextmanager
    def interruptible(self):
        if self.event.is_set():
            raise Stopping()
        self._interruptible = True
        try:
            yield
        finally:
            self._interruptible = False


class Worker:
    def __init__(
        self,
        client: Client,
        model: Model | None,
        *,
        worker_name: str,
        model_name: str | None,
        scanner: Scanner | None = None,
        reader: RecipeReader | None = None,
        kinds: tuple[str, ...] | None = None,
        server: str = "",
        shutdown: Shutdown | None = None,
        progress_every: float = 5.0,
        max_backoff: float = 30.0,
        unauthorized_wait: float = 60.0,
        min_poll: float = 1.0,
        report_for: float = 600.0,
        temp_dir: str | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.client = client
        self.model = model
        self.scanner = scanner
        self.reader = reader
        # the kinds of job it asks for: those it has what it takes for, unless told otherwise
        self.kinds = kinds or tuple(kind for kind, engine in (("transcribe", model), ("ocr", scanner), ("recipe", reader)) if engine is not None)
        if not self.kinds:
            raise ValueError("a worker needs a model, a scanner or a recipe reader")
        self.worker_name = worker_name
        self.model_name = model_name
        self.server = server or client.base
        self.shutdown = shutdown or Shutdown()
        self.progress_every = progress_every
        self.max_backoff = max_backoff
        self.unauthorized_wait = unauthorized_wait
        self.min_poll = min_poll
        # how long to keep trying to deliver a finished job while the server is down: about as long
        # as the job stays ours without word from us
        self.report_for = report_for
        self.temp_dir = temp_dir
        self.clock = clock
        self._backoff = 0.0
        self._unreachable_since: float | None = None

    # ── asking for work ──

    def run(self) -> None:
        log.info("asking %s for work (%s) as %r", self.server, ", ".join(self.kinds), self.worker_name)
        while not self.shutdown.is_set():
            self.step()
        log.info("stopped")

    def step(self) -> None:
        """One request for a job, and the job if there is one."""
        asked = self.clock()
        try:
            with self.shutdown.interruptible():
                job = self.client.next_job(self.worker_name, self.model_name, self.kinds)
        except Stopping:
            return
        except Unauthorized:
            log.error(
                "Noterat at %s says the worker token is wrong (401): WORKER_TOKEN has to be the same "
                "here as on Noterat. Asking again in %d s.",
                self.server,
                self.unauthorized_wait,
            )
            self.shutdown.wait(self.unauthorized_wait)
            return
        except Unreachable as e:
            self._backoff = min(self._backoff * 2, self.max_backoff) if self._backoff else 1.0
            if self._unreachable_since is None:
                self._unreachable_since = self.clock()
                log.warning("can't reach Noterat at %s (%s); trying again, every %d s at most", self.server, e, self.max_backoff)
            else:
                log.debug("still can't reach Noterat (%s); next try in %.0f s", e, self._backoff)
            self.shutdown.wait(self._backoff)
            return
        except (ApiError, ValueError) as e:
            # a 404 (a Noterat without the worker API), a 400, an answer that isn't JSON…
            log.error("Noterat at %s gave an answer the worker doesn't understand (%s). Asking again in %d s.", self.server, e, self.unauthorized_wait)
            self.shutdown.wait(self.unauthorized_wait)
            return

        if self._unreachable_since is not None:
            log.info("reached Noterat again, after %.0f s", self.clock() - self._unreachable_since)
        self._backoff = 0.0
        self._unreachable_since = None

        if job is None:
            # The server normally holds the request for a while; if it says "nothing" at once, don't
            # ask it again in a tight loop.
            self.shutdown.wait(self.min_poll - (self.clock() - asked))
            return
        try:
            self.handle(job)
        except Exception as e:  # a job shaped in a way nobody expected mustn't take the worker down
            log.exception("job %s: unexpected error", job.get("id"))
            who = "the worker" if job.get("kind") in ("ocr", "recipe") else "the transcriber"
            self._failed(str(job["id"]), f"{who} ran into an error ({type(e).__name__}: {e})", retry=True)

    # ── a job ──

    def handle(self, job: dict[str, Any]) -> None:
        job_id = str(job["id"])
        kind = job.get("kind", "transcribe")
        if kind not in self.kinds:
            # the server only sends the kinds the worker asks for; another worker may take it
            log.error("job %s is a %r job; this worker does %s", job_id, kind, " and ".join(self.kinds))
            self._failed(job_id, f"the worker can't do {kind!r} jobs", retry=True)
            return
        if kind == "ocr":
            self.read_scan(job)
        elif kind == "recipe":
            self.read_recipe(job)
        else:
            self.transcribe(job)

    # ── transcription ──

    def transcribe(self, job: dict[str, Any]) -> None:
        job_id = str(job["id"])
        started = self.clock()
        if self.shutdown.is_set():
            self._failed(job_id, "the transcriber was stopped before it started", retry=True)
            return
        file = job.get("file") or {}
        file_hash = str(file.get("hash") or "")
        if not file_hash:
            self._failed(job_id, "the job names no file", retry=False)
            return
        # Whisper wants "sv", not "sv-SE"
        language = str(job.get("language") or "").replace("_", "-").split("-")[0].lower() or None

        with tempfile.TemporaryDirectory(prefix="noterat-worker-", dir=self.temp_dir) as tmp:
            path = os.path.join(tmp, "recording")
            if not self._fetch(job_id, file_hash, path, what="the recording", who="the transcriber"):
                return

            try:
                result, segments = self._transcribe(job_id, path, language)
            except JobGone:
                log.info("job %s isn't this worker's any more (taken back, or the memo was deleted); stopped it", job_id)
                return
            except Stopping:
                log.info("job %s: stopping, so it goes back in the queue", job_id)
                self._failed(job_id, "the transcriber was stopped before it finished", retry=True)
                return
            except UndecodableAudio as e:
                log.error("job %s: %s", job_id, e)
                self._failed(job_id, str(e), retry=False)
                return
            except Exception as e:  # the model failed: out of GPU memory, a CUDA error…
                log.exception("job %s: transcription failed", job_id)
                self._failed(job_id, f"transcription failed ({type(e).__name__}: {e})", retry=True)
                return

        if self._report(job_id, "done", lambda: self.client.done(job_id, result)):
            log.info(
                "job %s: %.1f s of audio in %.1f s (%s, %d segments), %d chars",
                job_id,
                result["duration"],
                self.clock() - started,
                result["language"],
                len(segments),
                len(result["text"]),
            )

    def _fetch(self, job_id: str, file_hash: str, path: str, *, what: str, who: str) -> bool:
        """Downloads a job's file; when it can't, says so to the server (or, if the job isn't ours any
        more, to the log) and returns False."""
        try:
            self._download(file_hash, path)
            return True
        except Stopping:
            self._failed(job_id, f"{who} was stopped before it finished", retry=True)
        except NotFound:
            log.error("job %s: the server hasn't got %s %s", job_id, what, file_hash)
            self._failed(job_id, f"{what} isn't on the server", retry=False)
        except JobGone:
            log.info("job %s was taken back before %s was fetched", job_id, what)
        except Unauthorized:
            log.error("job %s: the server turned down the worker token (401) for %s", job_id, what)
        except (Unreachable, ApiError) as e:
            log.warning("job %s: couldn't fetch %s (%s)", job_id, what, e)
            self._failed(job_id, f"{who} couldn't fetch {what} ({e})", retry=True)
        return False

    def _download(self, file_hash: str, path: str) -> None:
        """A couple of quick tries: a file is small, and the server just handed out the job."""
        delay = 1.0
        for attempt in range(3):
            try:
                self.client.download(file_hash, path)
                return
            except Unreachable:
                if attempt == 2:
                    raise
                if self.shutdown.wait(delay):
                    raise Stopping() from None
                delay *= 2

    def _transcribe(self, job_id: str, path: str, language: str | None) -> tuple[dict[str, Any], list[Segment]]:
        transcription = self.model.transcribe(path, language)
        duration = float(transcription.duration or 0.0)
        segments: list[Segment] = []
        last_report = self.clock()
        stream = transcription.segments
        try:
            for seg in stream:
                if self.shutdown.is_set():
                    raise Stopping()
                text = seg.text.strip()
                if text:
                    segments.append(Segment(seg.start, seg.end, text))
                now = self.clock()
                if duration > 0 and now - last_report >= self.progress_every:
                    last_report = now
                    self._progress(job_id, min(max(seg.end / duration, 0.0), 1.0))
        finally:
            close = getattr(stream, "close", None)
            if close:
                close()  # an abandoned faster-whisper generator lets go of the GPU now, not later
        result = {
            "text": join_text(segments),
            "language": transcription.language or language,
            "duration": round(duration, 2),
            "model": self.model_name,
            "segments": [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text} for s in segments],
        }
        return result, segments

    # ── scans ──

    def read_scan(self, job: dict[str, Any]) -> None:
        """An ocr job: fetch the pages, find and straighten the page in each photo the job says isn't
        cropped yet, read them all into one searchable PDF, hand the server the new files (the cropped
        pages and the PDF), and then the text."""
        job_id = str(job["id"])
        started = self.clock()
        if self.shutdown.is_set():
            self._failed(job_id, "the worker was stopped before it started", retry=True)
            return
        files = job.get("files")
        if not isinstance(files, list) or not files or not all(isinstance(f, dict) and f.get("hash") for f in files):
            self._failed(job_id, "the job names no pages", retry=False)
            return
        hashes = [str(f["hash"]) for f in files]
        wanted = job.get("crop") if isinstance(job.get("crop"), list) else []
        crop = [i < len(wanted) and wanted[i] is True for i in range(len(hashes))]
        language = language_of(job.get("language"))
        if language is None:
            self._failed(job_id, f"the job's language ({job.get('language')!r}) isn't one Tesseract can be asked for", retry=False)
            return
        assert self.scanner is not None
        count = len(hashes)

        def page_name(i: int) -> str:
            return f"page {i + 1}" if count > 1 else "the page"

        with tempfile.TemporaryDirectory(prefix="noterat-worker-", dir=self.temp_dir) as tmp:
            pages: list[Page] = []
            try:
                for i, file_hash in enumerate(hashes):
                    if self.shutdown.is_set():
                        raise Stopping()
                    src = os.path.join(tmp, f"file-{i}")
                    if not self._fetch(job_id, file_hash, src, what=page_name(i), who="the worker"):
                        return
                    self._progress(job_id, 0.3 * (i + 0.5) / count)
                    if self.shutdown.is_set():
                        raise Stopping()
                    try:
                        pages.append(self.scanner.prepare(src, os.path.join(tmp, f"page-{i}"), crop[i]))
                    except UndecodableImage as e:
                        raise UndecodableImage(f"{page_name(i)}: {e}" if count > 1 else str(e)) from e
                    self._progress(job_id, 0.3 * (i + 1) / count)

                pdf = os.path.join(tmp, "scan.pdf")
                texts = self.scanner.read([p.path for p in pages], pdf, language, self.shutdown.is_set)
                self._progress(job_id, 0.9)

                # Only now, with the reading done, do the new files go to the server: a job that fails
                # or is taken back leaves nothing behind there.
                result_pages = []
                for page, file_hash, text in zip(pages, hashes, texts):
                    if page.cropped:
                        file_hash = self._upload(job_id, page.path, "image/jpeg")["hash"]
                    # (and its size, upright, which a cropped page has a new one of)
                    result_pages.append({"hash": file_hash, "text": page_text(text), "cropped": page.cropped, "width": page.width, "height": page.height})
                pdf_hash = self._upload(job_id, pdf, "application/pdf")["hash"]
            except JobGone:
                log.info("job %s isn't this worker's any more (taken back, or the scan was deleted); stopped it", job_id)
                return
            except (Stopping, Cancelled):
                log.info("job %s: stopping, so it goes back in the queue", job_id)
                self._failed(job_id, "the worker was stopped before it finished", retry=True)
                return
            except (UndecodableImage, UnknownLanguage) as e:
                log.error("job %s: %s", job_id, e)
                self._failed(job_id, str(e), retry=False)
                return
            except OcrFailed as e:
                log.error("job %s: %s", job_id, e)
                self._failed(job_id, str(e), retry=True)
                return
            except Unauthorized:
                log.error("job %s: the server turned down the worker token (401) for a file the job made", job_id)
                return
            except (Unreachable, ApiError) as e:
                log.warning("job %s: couldn't hand the server a file the job made (%s)", job_id, e)
                self._failed(job_id, f"the worker couldn't hand over the pages ({e})", retry=True)
                return

        result: dict[str, Any] = {
            "text": join_pages(p["text"] for p in result_pages),
            "language": language,
            "pages": result_pages,
            "pdf": {"hash": pdf_hash},
            "model": self.scanner.name,
        }
        if self._report(job_id, "done", lambda: self.client.done(job_id, result)):
            log.info(
                "job %s: %d page%s (%d cropped) read in %.1f s (%s), %d chars",
                job_id,
                count,
                "" if count == 1 else "s",
                sum(1 for p in pages if p.cropped),
                self.clock() - started,
                language,
                len(result["text"]),
            )

    # ── recipes ──

    def read_recipe(self, job: dict[str, Any]) -> None:
        """A recipe job: fetch the page the server fetched (the worker never fetches the job's url, nor
        anything else: the url only says which site the page is from), read its recipe, and send it.
        It takes a fraction of a second, so there's no progress to report."""
        job_id = str(job["id"])
        started = self.clock()
        if self.shutdown.is_set():
            self._failed(job_id, "the worker was stopped before it started", retry=True)
            return
        files = job.get("files")
        if not isinstance(files, list) or not files or not isinstance(files[0], dict) or not files[0].get("hash"):
            self._failed(job_id, "the job names no page", retry=False)
            return
        url = job.get("url")
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            self._failed(job_id, "the job doesn't say which address the page is from", retry=False)
            return
        file = files[0]
        assert self.reader is not None

        with tempfile.TemporaryDirectory(prefix="noterat-worker-", dir=self.temp_dir) as tmp:
            path = os.path.join(tmp, "page.html")
            if not self._fetch(job_id, str(file["hash"]), path, what="the page", who="the worker"):
                return
            with open(path, "rb") as f:
                data = f.read()
        if self.shutdown.is_set():
            self._failed(job_id, "the worker was stopped before it finished", retry=True)
            return

        try:
            html, encoding = decode_page(data, str(file.get("type") or ""))
            recipe = self.reader.read(html, url)
        except (UndecodablePage, NoRecipe) as e:
            log.info("job %s: %s (%s, %d bytes)", job_id, e, url, len(data))
            self._failed(job_id, str(e), retry=False)
            return
        except Exception as e:  # recipe-scrapers (or what it reads with) broke on the page
            log.exception("job %s: reading %s failed", job_id, url)
            self._failed(job_id, f"the worker couldn't read the page ({type(e).__name__}: {clip(str(e), 200)})", retry=True)
            return

        if recipe.missing:
            log.debug("job %s: not on the page: %s", job_id, ", ".join(f"{k} ({v})" for k, v in recipe.missing.items()))
        if self._report(job_id, "done", lambda: self.client.done(job_id, {"recipe": recipe.as_json()})):
            log.info(
                "job %s: recipe %r read in %.1f s (%s, %s): %d ingredients, %d steps",
                job_id,
                recipe.title,
                self.clock() - started,
                recipe.read_by,
                encoding,
                len(recipe.ingredients),
                len(recipe.steps),
            )

    def _upload(self, job_id: str, path: str, content_type: str) -> dict[str, Any]:
        """A couple of quick tries, as for a download."""
        delay = 1.0
        for attempt in range(3):
            try:
                return self.client.upload(job_id, path, content_type)
            except Unreachable:
                if attempt == 2:
                    raise
                if self.shutdown.wait(delay):
                    raise Stopping() from None
                delay *= 2
        raise AssertionError("unreachable")

    def _progress(self, job_id: str, progress: float) -> None:
        """409 (JobGone) goes up and stops the job; anything else is only a missed update."""
        try:
            self.client.progress(job_id, round(progress, 3))
        except JobGone:
            raise
        except (Unreachable, ApiError) as e:
            log.warning("job %s: couldn't report progress (%s); carrying on", job_id, e)

    def _failed(self, job_id: str, error: str, retry: bool) -> None:
        self._report(job_id, "failed", lambda: self.client.failed(job_id, error, retry))

    def _report(self, job_id: str, what: str, send: Callable[[], None]) -> bool:
        """Delivers done or failed. While the server can't be reached, keeps trying (with back-off)
        for as long as the job stays ours; a finished transcript is worth the wait."""
        deadline = self.clock() + self.report_for
        delay = 1.0
        while True:
            try:
                send()
                return True
            except JobGone:
                log.info("job %s isn't this worker's any more; its %s wasn't taken", job_id, what)
                return False
            except Unauthorized:
                log.error("job %s: the server turned down the worker token (401) for %s", job_id, what)
                return False
            except ApiError as e:
                log.error("job %s: the server didn't take %s (%s)", job_id, what, e)
                return False
            except Unreachable as e:
                if self.shutdown.is_set() or self.clock() + delay > deadline:
                    log.error("job %s: couldn't tell the server it's %s (%s); it will be queued again", job_id, what, e)
                    return False
                log.warning("job %s: couldn't tell the server it's %s (%s); trying again in %.0f s", job_id, what, e, delay)
                if self.shutdown.wait(delay):
                    return False
                delay = min(delay * 2, self.max_backoff)
