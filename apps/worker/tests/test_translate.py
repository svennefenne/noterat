"""Translate jobs (docs/decisions/0009) through the worker's loop, against the fake Noterat, with a fake
translator (the real one needs its model downloaded; `python -m noterat_worker --translate` tries it).
Then the kinds a worker does, with translating among them or not."""

from __future__ import annotations

import sys
from typing import Any

import pytest
from fake_noterat import FakeNoterat
from test_worker import Running, make_worker

from noterat_worker import __main__ as cli
from noterat_worker.config import from_env
from noterat_worker.translate import UnknownPair

ENV = {"NOTERAT_URL": "http://noterat:3000", "WORKER_TOKEN": "x" * 40}
PIECES = ["Add the beans and simmer for 20 minutes.", "Drain off any excess grease."]


class FakeTranslator:
    """Puts "sv:" before each piece (or raises), and remembers what it was asked."""

    name = "fake-translator"

    def __init__(self, error: Exception | None = None, drop: bool = False):
        self.error = error
        self.drop = drop
        self.asked: list[tuple[list[str], str, str]] = []

    def translate(self, texts: list[str], source: str, target: str) -> list[str]:
        self.asked.append((texts, source, target))
        if self.error:
            raise self.error
        if (source, target) != ("en", "sv"):
            raise UnknownPair(f"the worker translates en to sv, not {source} to {target}")
        out = [f"sv: {t}" for t in texts]
        return out[:-1] if self.drop else out


def translate_job(job_id: str = "translate-1", **fields: Any) -> dict[str, Any]:
    return {"id": job_id, "kind": "translate", "from": "en", "to": "sv", "texts": PIECES, **fields}


@pytest.fixture
def server():
    fake = FakeNoterat(files={})
    yield fake
    fake.close()


def run_one(server: FakeNoterat, translator: Any, *jobs: dict[str, Any]) -> None:
    server.answers = list(jobs)
    last = jobs[-1]["id"]
    running = Running(make_worker(server, None, translator=translator, model_name=None))
    server.wait_for(lambda rs: any(r.path.endswith((f"/{last}/done", f"/{last}/failed")) for r in rs))
    running.stop()


def test_a_translate_job_sends_back_each_piece_translated_in_order(server: FakeNoterat):
    translator = FakeTranslator()
    run_one(server, translator, translate_job())

    assert server.requests[0].body["kinds"] == ["translate"]
    assert server.paths()[:2] == ["POST /api/worker/next", "POST /api/worker/jobs/translate-1/done"]  # no files, no progress
    (done,) = server.find("/done")
    assert done.body == {"texts": [f"sv: {t}" for t in PIECES]}
    assert translator.asked == [(PIECES, "en", "sv")]


def test_languages_it_doesnt_translate_fail_without_retry(server: FakeNoterat):
    run_one(server, FakeTranslator(), translate_job(**{"from": "sv", "to": "en"}))

    (failed,) = server.find("/failed")
    assert failed.body == {"error": "the worker translates en to sv, not sv to en", "retry": False}


def test_a_job_without_text_fails_without_retry(server: FakeNoterat):
    translator = FakeTranslator()
    run_one(server, translator, translate_job(texts="Add the beans."))

    (failed,) = server.find("/failed")
    assert failed.body["retry"] is False
    assert translator.asked == []


def test_a_model_that_breaks_or_loses_a_piece_fails_with_retry(server: FakeNoterat):
    run_one(server, FakeTranslator(error=RuntimeError("out of memory")), translate_job())
    (failed,) = server.find("/failed")
    assert failed.body == {"error": "the worker couldn't translate (RuntimeError: out of memory)", "retry": True}

    run_one(server, FakeTranslator(drop=True), translate_job("translate-2"))
    (failed,) = server.find("/translate-2/failed")
    assert failed.body == {"error": "the model gave 1 translations of 2 pieces", "retry": True}


# ── the kinds a worker does ──


def test_translate_is_a_kind_and_a_translate_only_worker_loads_nothing_else(monkeypatch: pytest.MonkeyPatch):
    def no(*args: Any) -> Any:
        raise AssertionError("loaded something a translating worker doesn't need")

    translator = FakeTranslator()
    monkeypatch.setattr(cli, "load", no)
    monkeypatch.setattr(cli, "load_ocr", no)
    monkeypatch.setattr(cli, "load_recipes", no)
    monkeypatch.setattr(cli, "load_translator", lambda config: translator)
    assert "translate" in from_env(ENV).kinds
    worker = cli.make_worker(from_env({**ENV, "WORKER_KINDS": "translate"}), cli.Shutdown())
    assert worker is not None and worker.kinds == ("translate",) and worker.translator is translator


def test_without_sentencepiece_a_worker_goes_on_with_the_rest(monkeypatch: pytest.MonkeyPatch, tmp_path: Any):
    from test_recipe import FakeReader

    # as if the translate extra weren't installed
    monkeypatch.setitem(sys.modules, "sentencepiece", None)
    assert cli.load_translator(from_env({**ENV, "MODELS_DIR": str(tmp_path)})) is None

    monkeypatch.setattr(cli, "load_recipes", lambda: FakeReader())
    worker = cli.make_worker(from_env({**ENV, "WORKER_KINDS": "recipe,translate", "MODELS_DIR": str(tmp_path)}), cli.Shutdown())
    assert worker is not None and worker.kinds == ("recipe",) and worker.translator is None
