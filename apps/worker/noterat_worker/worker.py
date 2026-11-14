"""The loop: ask Noterat for a job, fetch the recording, transcribe it, send the text back. Forever,
through a server that restarts, a network that drops and a token that's wrong, without crashing."""

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

log = logging.getLogger("noterat_worker")


class Stopping(Exception):
    """The worker was told to stop (SIGTERM, Ctrl+C)."""


class Shutdown:
    """The signal handler and the flag it sets.

    The flag is enough while a job runs: the loop looks at it between segments, and gives the job
    back. While the worker only waits (on the server's 25-s long poll, or for the model to load), the
    handler also raises Stopping, so `docker stop` doesn't have to wait for the wait. A second signal
    quits at once.
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
        model: Model,
        *,
        worker_name: str,
        model_name: str,
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
        log.info("asking %s for work as %r", self.server, self.worker_name)
        while not self.shutdown.is_set():
            self.step()
        log.info("stopped")

    def step(self) -> None:
        """One request for a job, and the job if there is one."""
        asked = self.clock()
        try:
            with self.shutdown.interruptible():
                job = self.client.next_job(self.worker_name, self.model_name)
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
            self._failed(str(job["id"]), f"the transcriber ran into an error ({type(e).__name__}: {e})", retry=True)

    # ── a job ──

    def handle(self, job: dict[str, Any]) -> None:
        job_id = str(job["id"])
        started = self.clock()
        if self.shutdown.is_set():
            self._failed(job_id, "the transcriber was stopped before it started", retry=True)
            return
        if job.get("kind", "transcribe") != "transcribe":
            log.error("job %s is a %r job; this worker only transcribes", job_id, job.get("kind"))
            self._failed(job_id, f"the worker can't do {job.get('kind')!r} jobs", retry=True)
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
            try:
                self._download(file_hash, path)
            except Stopping:
                self._failed(job_id, "the transcriber was stopped before it finished", retry=True)
                return
            except NotFound:
                log.error("job %s: the server hasn't got the recording %s", job_id, file_hash)
                self._failed(job_id, "the recording isn't on the server", retry=False)
                return
            except JobGone:
                log.info("job %s was taken back before the recording was fetched", job_id)
                return
            except Unauthorized:
                log.error("job %s: the server turned down the worker token (401) for the recording", job_id)
                return
            except (Unreachable, ApiError) as e:
                log.warning("job %s: couldn't fetch the recording (%s)", job_id, e)
                self._failed(job_id, f"the transcriber couldn't fetch the recording ({e})", retry=True)
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

    def _download(self, file_hash: str, path: str) -> None:
        """A couple of quick tries: a recording is small, and the server just handed out the job."""
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
