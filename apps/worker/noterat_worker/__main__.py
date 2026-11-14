"""python -m noterat_worker: load the model, then work for Noterat until stopped.

python -m noterat_worker --file memo.webm transcribes one file and prints the result instead, without
a server; handy to see that the model and the GPU work.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import time

from . import __version__
from .client import Client
from .config import Config, ConfigError, from_env
from .model import join_text
from .worker import Shutdown, Stopping, Worker

log = logging.getLogger("noterat_worker")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="noterat-worker", description="Noterat's speech-to-text worker. Settings come from the environment (see README.md).")
    parser.add_argument("--file", metavar="AUDIO", help="transcribe this file, print the result and exit (no server needed)")
    parser.add_argument("--language", metavar="CODE", help="with --file: the language, e.g. sv (default: detect it)")
    args = parser.parse_args(argv)

    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S", stream=sys.stdout)
    if level != "DEBUG":
        # one line per job, not one per HTTP request of the model download and two per recording
        for name in ("httpx", "httpx2", "httpcore", "huggingface_hub", "faster_whisper"):
            logging.getLogger(name).setLevel(logging.WARNING)
    try:
        config = from_env(need_server=not args.file)
    except ConfigError as e:
        log.error("%s", e)
        return 2

    shutdown = Shutdown()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    try:
        if args.file:
            return transcribe_file(config, args.file, args.language)
        log.info("noterat-worker %s", os.environ.get("NOTERAT_VERSION") or __version__)
        model = load(config, shutdown)
        worker = Worker(Client(config.noterat_url, config.token), model, worker_name=config.worker_name, model_name=config.model, server=config.noterat_url, shutdown=shutdown)
        worker.run()
        return 0
    except Stopping:
        log.info("stopped")
        return 0


def load(config: Config, shutdown: Shutdown):
    """The model, however long it takes: a first start without internet, or a GPU the container
    can't see yet, is worth waiting out (and saying why) rather than crash and restart over and over."""
    from .whisper import Whisper

    delay = 10.0
    while True:
        try:
            with shutdown.interruptible():
                return Whisper(config)
        except Stopping:
            raise
        except Exception as e:
            log.error("couldn't load %s on %s (%s: %s); trying again in %.0f s", config.model, config.device, type(e).__name__, e, delay)
            if shutdown.wait(delay):
                raise Stopping() from None
            delay = min(delay * 2, 300.0)


def transcribe_file(config: Config, path: str, language: str | None) -> int:
    from .whisper import Whisper

    started = time.monotonic()
    model = Whisper(config)
    loaded = time.monotonic()
    transcription = model.transcribe(path, language)
    segments = [s for s in transcription.segments if s.text.strip()]
    done = time.monotonic()
    print(
        json.dumps(
            {
                "text": join_text(segments),
                "language": transcription.language,
                "duration": round(transcription.duration, 2),
                "model": config.model,
                "device": model.device,
                "compute_type": model.compute_type,
                "load_seconds": round(loaded - started, 2),
                "transcribe_seconds": round(done - loaded, 2),
                "segments": [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
