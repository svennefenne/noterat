"""OCR jobs (docs/decisions/0008) through the worker's loop, against the fake Noterat and a fake scanner
(no OpenCV or Tesseract needed), and the job kinds a worker asks for."""

from __future__ import annotations

import hashlib
import threading
from collections.abc import Callable
from typing import Any

import pytest
from fake_noterat import FakeNoterat
from test_worker import SEGMENTS, FakeModel, Running, make_worker

from noterat_worker import __main__ as cli
from noterat_worker.config import ConfigError, from_env
from noterat_worker.scan import Cancelled, OcrFailed, Page, UndecodableImage, UnknownLanguage, join_pages, language_of, page_text
from noterat_worker.worker import Worker

PHOTO = b"\xff\xd8 a photo of a receipt with a PAGE in it"  # the fake finds a page in this one
SCREENSHOT = b"\x89PNG a screenshot, cropped already"
BLURRY = b"\xff\xd8 a photo where no page can be made out"
GARBAGE = b"not an image at all, a zip or so"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def ocr_job(job_id: str = "scan-1", files: tuple[bytes, ...] = (PHOTO, SCREENSHOT, BLURRY), crop: list[bool] | None = None, language: str | None = "swe+eng") -> dict[str, Any]:
    return {
        "id": job_id,
        "kind": "ocr",
        "files": [{"hash": sha(f), "type": "image/jpeg", "size": len(f)} for f in files],
        "language": language,
        "crop": crop if crop is not None else [True, False, True][: len(files)],
    }


class FakeScanner:
    """Finds a page in a file with PAGE in it (when asked to crop), refuses one that starts with "not
    an image", and reads each page as the given texts; remembers what it was given."""

    name = "fake-ocr 1.0"

    def __init__(self, texts: list[str] | None = None, error: Exception | None = None, on_read: Callable[[Callable[[], bool]], None] | None = None):
        self.texts = texts
        self.error = error
        self.on_read = on_read
        self.prepared: list[tuple[bytes, bool]] = []
        self.reads: list[tuple[list[bytes], str]] = []
        self.pdf = b""

    def prepare(self, src: str, dest: str, crop: bool) -> Page:
        with open(src, "rb") as f:
            data = f.read()
        self.prepared.append((data, crop))
        if data.startswith(b"not an image"):
            raise UndecodableImage("the file isn't an image that can be read")
        if crop and b"PAGE" in data:
            path = dest + ".jpg"
            with open(path, "wb") as f:
                f.write(b"straightened " + data)
            return Page(path, True, 800, 2000, [(10, 20), (810, 30), (800, 2030), (5, 2010)])
        return Page(src, False, 1000, 1500)

    def read(self, images: list[str], pdf: str, language: str, should_stop: Callable[[], bool]) -> list[str]:
        pages = []
        for path in images:
            with open(path, "rb") as f:
                pages.append(f.read())
        self.reads.append((pages, language))
        if self.on_read:
            self.on_read(should_stop)
        if self.error:
            raise self.error
        self.pdf = b"%PDF-1.7 " + b" | ".join(pages)
        with open(pdf, "wb") as f:
            f.write(self.pdf)
        return self.texts if self.texts is not None else [f"page {i + 1}" for i in range(len(images))]


TEXTS = [
    "ICA Nära Ekhagen  \n2026-11-14\n\n\n\nMjölk 1,5 l 16,90\nTOTALT 76,80\n",
    "",  # a page with nothing on it
    "  Kort  \n",
]


@pytest.fixture
def server():
    fake = FakeNoterat(files={sha(f): f for f in (PHOTO, SCREENSHOT, BLURRY, GARBAGE)})
    yield fake
    fake.close()


def ocr_worker(server: FakeNoterat, scanner: Any, **kwargs: Any) -> Worker:
    return make_worker(server, None, scanner=scanner, model_name=None, **kwargs)


def wait_done_or_failed(server: FakeNoterat) -> None:
    server.wait_for(lambda rs: any(r.path.endswith(("/done", "/failed")) for r in rs))


def test_an_ocr_job_crops_reads_uploads_and_is_done(server: FakeNoterat):
    server.answers = [ocr_job()]
    scanner = FakeScanner(TEXTS)
    running = Running(ocr_worker(server, scanner))
    wait_done_or_failed(server)
    running.stop()

    # an OCR-only worker asks only for OCR jobs, and has no Whisper model to name
    assert server.requests[0].body == {"worker": "test-worker", "kinds": ["ocr"], "model": None}

    paths = server.paths()
    assert [p for p in paths if p.startswith("GET")] == [f"GET /api/worker/files/{sha(f)}" for f in (PHOTO, SCREENSHOT, BLURRY)]
    # the new files go up only once the reading is done, the cropped page first, then the PDF; then done
    puts = [i for i, p in enumerate(paths) if p == "PUT /api/worker/jobs/scan-1/files"]
    assert len(puts) == 2
    assert puts[0] > max(i for i, p in enumerate(paths) if p.endswith("/progress"))
    assert paths[-1] == "POST /api/worker/jobs/scan-1/done"
    assert "POST /api/worker/jobs/scan-1/failed" not in paths

    cropped = b"straightened " + PHOTO
    assert server.uploads() == [("scan-1", "image/jpeg", cropped), ("scan-1", "application/pdf", scanner.pdf)]
    # what was read: the straightened page, the screenshot as it was, and the photo without a clear
    # page as it was too
    assert scanner.prepared == [(PHOTO, True), (SCREENSHOT, False), (BLURRY, True)]
    assert scanner.reads == [([cropped, SCREENSHOT, BLURRY], "swe+eng")]

    progress = [r.body["progress"] for r in server.find("/progress")]
    assert len(progress) == 7  # after each page is fetched and prepared, and after the reading
    assert progress == sorted(progress) and all(0 <= p <= 1 for p in progress)
    assert progress[-1] == 0.9

    (done,) = server.find("/done")
    assert done.body == {
        "text": "ICA Nära Ekhagen\n2026-11-14\n\nMjölk 1,5 l 16,90\nTOTALT 76,80\n\nKort",
        "language": "swe+eng",
        "pages": [
            {"hash": sha(cropped), "text": "ICA Nära Ekhagen\n2026-11-14\n\nMjölk 1,5 l 16,90\nTOTALT 76,80", "cropped": True, "width": 800, "height": 2000},
            {"hash": sha(SCREENSHOT), "text": "", "cropped": False, "width": 1000, "height": 1500},
            {"hash": sha(BLURRY), "text": "Kort", "cropped": False, "width": 1000, "height": 1500},
        ],
        "pdf": {"hash": sha(scanner.pdf)},
        "model": "fake-ocr 1.0",
    }


def test_a_job_without_crop_or_language_reads_the_pages_as_they_are(server: FakeNoterat):
    job = ocr_job(files=(PHOTO,), language=None)
    del job["crop"]
    server.answers = [job]
    scanner = FakeScanner()
    running = Running(ocr_worker(server, scanner))
    wait_done_or_failed(server)
    running.stop()

    assert scanner.prepared == [(PHOTO, False)]
    assert scanner.reads == [([PHOTO], "swe+eng")]
    assert [u[1] for u in server.uploads()] == ["application/pdf"]  # no new page, only the PDF
    (done,) = server.find("/done")
    assert done.body["pages"] == [{"hash": sha(PHOTO), "text": "page 1", "cropped": False, "width": 1000, "height": 1500}]
    assert done.body["text"] == "page 1"


def test_progress_409_stops_the_scan(server: FakeNoterat):
    server.answers = [ocr_job()]
    server.progress_statuses = [204, 409]
    scanner = FakeScanner()
    running = Running(ocr_worker(server, scanner))
    server.wait_for(lambda rs: len([r for r in rs if r.path.endswith("/progress")]) == 2)
    server.wait_for(lambda rs: rs[-1].path == "/api/worker/next" and len(rs) > 4)
    running.stop()

    assert scanner.reads == []
    assert not server.uploads()
    assert not server.find("/done")
    assert not server.find("/failed")


def test_an_upload_409_stops_the_scan(server: FakeNoterat):
    server.answers = [ocr_job()]
    server.upload_statuses = [409]
    running = Running(ocr_worker(server, FakeScanner()))
    server.wait_for(lambda rs: any(r.method == "PUT" for r in rs))
    server.wait_for(lambda rs: rs[-1].path == "/api/worker/next")
    running.stop()

    assert len(server.uploads()) == 1
    assert not server.find("/done")
    assert not server.find("/failed")


def test_a_file_that_isnt_an_image_fails_without_retry(server: FakeNoterat):
    server.answers = [ocr_job(files=(PHOTO, GARBAGE), crop=[True, True])]
    scanner = FakeScanner()
    running = Running(ocr_worker(server, scanner))
    wait_done_or_failed(server)
    running.stop()

    (failed,) = server.find("/failed")
    assert failed.body == {"error": "page 2: the file isn't an image that can be read", "retry": False}
    assert scanner.reads == []
    assert not server.uploads()  # the page cropped before it wasn't handed over either
    assert not server.find("/done")


@pytest.mark.parametrize(
    ("error", "retry"),
    [
        (OcrFailed("reading the pages failed (tesseract crashed: Segmentation fault)"), True),
        (UnknownLanguage("Tesseract on the worker can't read 'fin' (its language data isn't installed)"), False),
    ],
)
def test_a_failed_reading_posts_failed(server: FakeNoterat, error: Exception, retry: bool):
    server.answers = [ocr_job()]
    running = Running(ocr_worker(server, FakeScanner(error=error)))
    wait_done_or_failed(server)
    running.stop()

    (failed,) = server.find("/failed")
    assert failed.body == {"error": str(error), "retry": retry}
    assert not server.uploads()


def test_a_page_missing_on_the_server_fails_without_retry(server: FakeNoterat):
    server.answers = [ocr_job(files=(PHOTO, b"a page the server never got"), crop=[False, False])]
    running = Running(ocr_worker(server, FakeScanner()))
    wait_done_or_failed(server)
    running.stop()

    (failed,) = server.find("/failed")
    assert failed.body == {"error": "page 2 isn't on the server", "retry": False}


@pytest.mark.parametrize("job", [{"id": "odd", "kind": "ocr", "files": []}, {"id": "odd", "kind": "ocr", "files": [{"hash": "x"}], "language": "swe; rm -rf /"}])
def test_a_job_that_makes_no_sense_fails_without_retry(server: FakeNoterat, job: dict[str, Any]):
    server.answers = [job]
    running = Running(ocr_worker(server, FakeScanner()))
    wait_done_or_failed(server)
    running.stop()

    (failed,) = server.find("/odd/failed")
    assert failed.body["retry"] is False


def test_stopping_while_reading_gives_the_scan_back(server: FakeNoterat):
    server.answers = [ocr_job()]
    box: list[Worker] = []

    def stop(should_stop: Callable[[], bool]) -> None:
        box[0].shutdown.set()  # what SIGTERM does
        assert should_stop()
        raise Cancelled()

    worker = ocr_worker(server, FakeScanner(on_read=stop))
    box.append(worker)
    thread = threading.Thread(target=worker.run, daemon=True)
    thread.start()
    thread.join(5)
    assert not thread.is_alive()

    (failed,) = server.find("/failed")
    assert failed.body == {"error": "the worker was stopped before it finished", "retry": True}
    assert not server.uploads()


# ── kinds ──


def test_a_worker_with_both_asks_for_both_and_does_both(server: FakeNoterat):
    from test_worker import job as transcribe_job

    audio = b"\x1aE\xdf\xa3 not really webm, but the fake model doesn't mind"
    server.files[sha(audio)] = audio
    server.answers = [transcribe_job(), ocr_job("scan-2", files=(SCREENSHOT,), crop=[False])]
    model, scanner = FakeModel(SEGMENTS), FakeScanner()
    running = Running(make_worker(server, model, scanner=scanner))
    server.wait_for(lambda rs: any(r.path.endswith("/scan-2/done") for r in rs))
    running.stop()

    assert server.requests[0].body["kinds"] == ["transcribe", "ocr"]
    assert len(server.find("/job-1/done")) == 1
    assert scanner.reads == [([SCREENSHOT], "swe+eng")]


def test_a_job_of_a_kind_the_worker_doesnt_do_is_handed_back(server: FakeNoterat):
    server.answers = [ocr_job()]
    running = Running(make_worker(server, FakeModel(SEGMENTS)))  # transcribes only
    wait_done_or_failed(server)
    running.stop()

    assert server.requests[0].body["kinds"] == ["transcribe"]
    (failed,) = server.find("/failed")
    assert failed.body == {"error": "the worker can't do 'ocr' jobs", "retry": True}


ENV = {"NOTERAT_URL": "http://noterat:3000", "WORKER_TOKEN": "x" * 40}


@pytest.mark.parametrize(
    ("value", "kinds"),
    [(None, ("transcribe", "ocr")), ("", ("transcribe", "ocr")), ("ocr", ("ocr",)), (" OCR, transcribe ", ("ocr", "transcribe")), ("transcribe,transcribe", ("transcribe",))],
)
def test_worker_kinds_setting(value: str | None, kinds: tuple[str, ...]):
    env = dict(ENV) if value is None else {**ENV, "WORKER_KINDS": value}
    assert from_env(env).kinds == kinds


@pytest.mark.parametrize("value", ["speech", "ocr,scan", ","])
def test_worker_kinds_errors(value: str):
    with pytest.raises(ConfigError):
        from_env({**ENV, "WORKER_KINDS": value})


def no_whisper(config: Any, shutdown: Any) -> Any:
    raise AssertionError("Whisper was loaded")


def test_an_ocr_only_worker_never_loads_whisper(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(cli, "load", no_whisper)
    monkeypatch.setattr(cli, "load_ocr", lambda: FakeScanner())
    worker = cli.make_worker(from_env({**ENV, "WORKER_KINDS": "ocr"}), cli.Shutdown())
    assert worker is not None
    assert worker.kinds == ("ocr",)
    assert worker.model is None and worker.model_name is None


def test_without_ocr_a_worker_goes_on_transcribing(monkeypatch: pytest.MonkeyPatch):
    model = FakeModel()
    monkeypatch.setattr(cli, "load", lambda config, shutdown: model)
    monkeypatch.setattr(cli, "load_ocr", lambda: None)  # Tesseract missing, say
    worker = cli.make_worker(from_env(ENV), cli.Shutdown())
    assert worker is not None
    assert worker.kinds == ("transcribe",)
    assert worker.model is model and worker.model_name == "KBLab/kb-whisper-large"

    # and one that's only to read scans has nothing left to do
    monkeypatch.setattr(cli, "load", no_whisper)
    assert cli.make_worker(from_env({**ENV, "WORKER_KINDS": "ocr"}), cli.Shutdown()) is None


def test_a_transcribe_only_worker_doesnt_look_for_ocr(monkeypatch: pytest.MonkeyPatch):
    def no_ocr() -> Any:
        raise AssertionError("OCR was checked")

    monkeypatch.setattr(cli, "load", lambda config, shutdown: FakeModel())
    monkeypatch.setattr(cli, "load_ocr", no_ocr)
    worker = cli.make_worker(from_env({**ENV, "WORKER_KINDS": "transcribe"}), cli.Shutdown())
    assert worker is not None and worker.kinds == ("transcribe",)


# ── text ──


def test_the_pages_text_joins_with_a_blank_line():
    assert join_pages(["  Sida ett \n", "", "\n\nSida två\n\n\n\nmer\n", "   "]) == "Sida ett\n\nSida två\n\nmer"
    assert join_pages([]) == ""
    assert page_text("a  \r\nb\n\n\n\nc\n") == "a\nb\n\nc"


def test_the_language_is_tesseracts():
    assert language_of(None) == "swe+eng"
    assert language_of("") == "swe+eng"
    assert language_of("eng") == "eng"
    assert language_of("swe+eng+chi_sim") == "swe+eng+chi_sim"
    assert language_of("swe eng") is None
    assert language_of("--psm 0") is None
