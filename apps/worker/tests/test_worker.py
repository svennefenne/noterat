"""The worker's loop against a fake Noterat (a real HTTP server in a thread) and a fake model."""

from __future__ import annotations

import hashlib
import logging
import threading
import time
from collections.abc import Callable
from typing import Any

import pytest
from fake_noterat import FakeNoterat

from noterat_worker.client import Client
from noterat_worker.model import Segment, Transcription, UndecodableAudio
from noterat_worker.worker import Shutdown, Worker

AUDIO = b"\x1aE\xdf\xa3 not really webm, but the fake model doesn't mind"
HASH = hashlib.sha256(AUDIO).hexdigest()
MODEL = "KBLab/kb-whisper-large"


def job(job_id: str = "job-1", language: str | None = "sv", data: bytes = AUDIO) -> dict[str, Any]:
    return {
        "id": job_id,
        "kind": "transcribe",
        "file": {"hash": hashlib.sha256(data).hexdigest(), "type": "audio/webm;codecs=opus", "size": len(data)},
        "language": language,
    }


class FakeModel:
    """Yields the given segments one by one, the way faster-whisper does (the work happens as they're
    read), and remembers what it was given."""

    def __init__(
        self,
        segments: list[Segment] | None = None,
        duration: float = 20.0,
        detected: str = "sv",
        error: Exception | None = None,
        on_segment: Callable[[int], None] | None = None,
    ):
        self.segments = segments if segments is not None else []
        self.duration = duration
        self.detected = detected
        self.error = error
        self.on_segment = on_segment
        self.calls: list[tuple[bytes, str | None]] = []
        self.yielded = 0

    def transcribe(self, path: str, language: str | None) -> Transcription:
        with open(path, "rb") as f:
            self.calls.append((f.read(), language))
        if self.error:
            raise self.error

        def stream():
            for i, seg in enumerate(self.segments):
                self.yielded += 1
                if self.on_segment:
                    self.on_segment(i)
                yield seg

        return Transcription(language or self.detected, self.duration, stream())


SEGMENTS = [
    Segment(0.0, 2.5, " Hej, det här är ett röstmemo."),
    Segment(2.7, 6.0, " Kom ihåg att köpa mjölk."),
    Segment(8.5, 12.0, " Och ring mormor på söndag. "),
    Segment(12.0, 12.4, "  "),
]
EXPECTED_DONE = {
    "text": "Hej, det här är ett röstmemo. Kom ihåg att köpa mjölk.\n\nOch ring mormor på söndag.",
    "language": "sv",
    "duration": 20.0,
    "model": MODEL,
    "segments": [
        {"start": 0.0, "end": 2.5, "text": "Hej, det här är ett röstmemo."},
        {"start": 2.7, "end": 6.0, "text": "Kom ihåg att köpa mjölk."},
        {"start": 8.5, "end": 12.0, "text": "Och ring mormor på söndag."},
    ],
}


@pytest.fixture
def server():
    fake = FakeNoterat(files={HASH: AUDIO})
    yield fake
    fake.close()


def make_worker(server: FakeNoterat, model: Any, token: str | None = None, **kwargs: Any) -> Worker:
    options: dict[str, Any] = {"worker_name": "test-worker", "model_name": MODEL, "progress_every": 0.0, "unauthorized_wait": 0.05, "min_poll": 0.0}
    options.update(kwargs)
    return Worker(Client(server.url, token or server.token), model, **options)


class Running:
    """The worker's loop in a thread, stopped (the way SIGTERM stops it) at the end of the test."""

    def __init__(self, worker: Worker):
        self.worker = worker
        self.error: BaseException | None = None
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self) -> None:
        try:
            self.worker.run()
        except BaseException as e:  # noqa: BLE001 - the test wants to see anything
            self.error = e

    def stop(self) -> None:
        self.worker.shutdown.set()
        self.thread.join(5)
        assert not self.thread.is_alive(), "the worker didn't stop"
        assert self.error is None, f"the worker crashed: {self.error!r}"


def test_a_job_goes_next_file_progress_done(server: FakeNoterat):
    server.answers = [job()]
    model = FakeModel(SEGMENTS)
    running = Running(make_worker(server, model))
    server.wait_for(lambda rs: any(r.path.endswith("/done") for r in rs))
    running.stop()

    paths = server.paths()
    assert paths[0] == "POST /api/worker/next"
    assert paths[1] == f"GET /api/worker/files/{HASH}"
    assert paths[2] == "POST /api/worker/jobs/job-1/progress"
    done_at = paths.index("POST /api/worker/jobs/job-1/done")
    assert all(p == "POST /api/worker/jobs/job-1/progress" for p in paths[2:done_at])
    assert "POST /api/worker/jobs/job-1/failed" not in paths

    for r in server.requests:
        assert r.headers["Authorization"] == f"Bearer {server.token}"
    assert server.requests[0].body == {"worker": "test-worker", "kinds": ["transcribe"], "model": MODEL}
    assert server.requests[0].headers["Content-Type"] == "application/json"

    progress = [r.body["progress"] for r in server.find("/progress")]
    assert progress == sorted(progress) and all(0 <= p <= 1 for p in progress)
    assert progress[0] == pytest.approx(2.5 / 20.0)

    (done,) = server.find("/done")
    assert done.body == EXPECTED_DONE
    assert model.calls == [(AUDIO, "sv")]


def test_204_then_a_job(server: FakeNoterat):
    server.answers = [None, None, job("job-2", language=None)]
    model = FakeModel(SEGMENTS[:1], duration=3.0, detected="en")
    running = Running(make_worker(server, model))
    server.wait_for(lambda rs: any(r.path.endswith("/done") for r in rs))
    running.stop()

    paths = server.paths()
    assert paths[:3] == ["POST /api/worker/next"] * 3
    assert paths[3] == f"GET /api/worker/files/{HASH}"
    assert model.calls == [(AUDIO, None)]  # null: let the model hear which language it is
    (done,) = server.find("/done")
    assert done.body["language"] == "en"
    assert done.body["text"] == "Hej, det här är ett röstmemo."


def test_a_failing_transcription_posts_failed_with_retry(server: FakeNoterat):
    server.answers = [job()]
    running = Running(make_worker(server, FakeModel(error=RuntimeError("CUDA failed with error out of memory"))))
    server.wait_for(lambda rs: any(r.path.endswith("/failed") for r in rs))
    running.stop()

    (failed,) = server.find("/failed")
    assert failed.body["retry"] is True
    assert "out of memory" in failed.body["error"]
    assert not server.find("/done")


def test_a_file_that_isnt_audio_fails_without_retry(server: FakeNoterat):
    server.answers = [job()]
    running = Running(make_worker(server, FakeModel(error=UndecodableAudio("the recording can't be read as audio"))))
    server.wait_for(lambda rs: any(r.path.endswith("/failed") for r in rs))
    running.stop()

    (failed,) = server.find("/failed")
    assert failed.body == {"error": "the recording can't be read as audio", "retry": False}


def test_a_missing_file_fails_without_retry(server: FakeNoterat):
    server.answers = [job(data=b"some other recording")]
    model = FakeModel(SEGMENTS)
    running = Running(make_worker(server, model))
    server.wait_for(lambda rs: any(r.path.endswith("/failed") for r in rs))
    running.stop()

    (failed,) = server.find("/failed")
    assert failed.body["retry"] is False
    assert model.calls == []


def test_progress_409_stops_the_job_without_done(server: FakeNoterat):
    server.answers = [job()]
    server.progress_statuses = [204, 409]
    model = FakeModel([Segment(i, i + 1, f"mening {i}") for i in range(10)], duration=10.0)
    running = Running(make_worker(server, model))
    server.wait_for(lambda rs: len([r for r in rs if r.path.endswith("/progress")]) == 2)
    # the worker goes back to asking for work
    server.wait_for(lambda rs: rs[-1].path == "/api/worker/next" and len(rs) > 4)
    running.stop()

    assert not server.find("/done")
    assert not server.find("/failed")
    assert model.yielded == 2  # it stopped reading segments at the 409


def test_progress_is_reported_at_most_every_5_seconds(server: FakeNoterat):
    now = [1000.0]
    server.answers = [job()]

    def tick(_: int) -> None:
        now[0] += 2.0  # every segment takes 2 s

    model = FakeModel([Segment(2 * i, 2 * i + 2, f"mening {i}") for i in range(6)], duration=12.0, on_segment=tick)
    running = Running(make_worker(server, model, progress_every=5.0, clock=lambda: now[0]))
    server.wait_for(lambda rs: any(r.path.endswith("/done") for r in rs))
    running.stop()

    # 6 s and 12 s in: after the 3rd and the 6th segment
    assert [r.body["progress"] for r in server.find("/progress")] == [0.5, 1.0]


def test_a_wrong_token_waits_and_keeps_asking(server: FakeNoterat, caplog: pytest.LogCaptureFixture):
    caplog.set_level(logging.ERROR, logger="noterat_worker")
    running = Running(make_worker(server, FakeModel(), token="wrong"))
    server.wait_for(lambda rs: len(rs) >= 3)
    assert running.thread.is_alive()
    running.stop()

    assert all(r.path == "/api/worker/next" for r in server.requests)
    assert any("token is wrong" in m and "WORKER_TOKEN" in m for m in caplog.messages)


class RecordingShutdown(Shutdown):
    """Notes how long the worker would sleep, without sleeping."""

    def __init__(self) -> None:
        super().__init__()
        self.waits: list[float] = []

    def wait(self, seconds: float) -> bool:
        self.waits.append(seconds)
        return self.is_set()


def test_401_waits_60_seconds_between_tries(server: FakeNoterat):
    shutdown = RecordingShutdown()
    worker = make_worker(server, FakeModel(), token="wrong", shutdown=shutdown, unauthorized_wait=60.0)
    for _ in range(3):
        worker.step()
    assert shutdown.waits == [60.0, 60.0, 60.0]


def test_a_server_that_is_down_is_retried_with_back_off(server: FakeNoterat, caplog: pytest.LogCaptureFixture):
    caplog.set_level(logging.INFO, logger="noterat_worker")
    url = server.url
    server.close()  # nothing listens there now
    shutdown = RecordingShutdown()
    worker = Worker(Client(url, "secret-token"), FakeModel(), worker_name="w", model_name=MODEL, shutdown=shutdown, min_poll=0.0)
    for _ in range(8):
        worker.step()
    assert shutdown.waits == [1, 2, 4, 8, 16, 30, 30, 30]
    assert len([m for m in caplog.messages if "can't reach Noterat" in m]) == 1  # said once, not every time

    # and when it's back, the back-off starts over
    back = FakeNoterat(answers=[None])
    try:
        worker.client = Client(back.url, back.token)
        worker.step()
        assert any("reached Noterat again" in m for m in caplog.messages)
        worker.client = Client(url, "secret-token")
        worker.step()
        assert shutdown.waits[-1] == 1
    finally:
        back.close()


def test_done_is_sent_again_when_the_server_hiccups(server: FakeNoterat):
    server.answers = [job()]
    server.done_statuses = [503]
    running = Running(make_worker(server, FakeModel(SEGMENTS)))
    server.wait_for(lambda rs: len([r for r in rs if r.path.endswith("/done")]) == 2)
    running.stop()

    first, second = server.find("/done")
    assert first.body == second.body == EXPECTED_DONE


def test_stopping_during_a_job_gives_it_back(server: FakeNoterat):
    server.answers = [job()]
    worker_box: list[Worker] = []

    def stop_at_second(i: int) -> None:
        if i == 1:
            worker_box[0].shutdown.set()  # what SIGTERM does

    worker = make_worker(server, FakeModel([Segment(i, i + 1, "ord") for i in range(5)], on_segment=stop_at_second))
    worker_box.append(worker)
    thread = threading.Thread(target=worker.run, daemon=True)
    thread.start()
    thread.join(5)
    assert not thread.is_alive()

    (failed,) = server.find("/failed")
    assert failed.body["retry"] is True
    assert not server.find("/done")


def test_the_signal_handler_cuts_a_long_poll_short(server: FakeNoterat):
    """While the worker only waits on the server, SIGTERM shouldn't have to wait out the 25 s."""
    import signal

    server.idle_wait = 10.0
    worker = make_worker(server, FakeModel())
    previous = signal.signal(signal.SIGALRM, worker.shutdown)
    try:
        signal.setitimer(signal.ITIMER_REAL, 0.2)
        started = time.monotonic()
        worker.run()  # in this (the main) thread, where signals arrive
        assert time.monotonic() - started < 3
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def test_a_job_the_worker_cant_make_sense_of_doesnt_stop_it(server: FakeNoterat):
    server.answers = [{"id": "odd", "kind": "transcribe", "file": "not an object"}, job("job-after")]
    running = Running(make_worker(server, FakeModel(SEGMENTS)))
    server.wait_for(lambda rs: any(r.path.endswith("/job-after/done") for r in rs))
    running.stop()

    (failed,) = server.find("/odd/failed")
    assert failed.body["retry"] is True
