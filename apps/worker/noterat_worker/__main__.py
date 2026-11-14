"""python -m noterat_worker: get ready for the kinds of job it's set to do (load the model, check that
OCR works), then work for Noterat until stopped.

Without a server, handy to see that it all works:
  python -m noterat_worker --file memo.webm                 transcribes one recording, prints the result
  python -m noterat_worker --ocr page1.jpg page2.jpg --crop  reads a scan, prints the text, writes the PDF
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import signal
import sys
import tempfile
import time

from . import __version__
from .client import Client
from .config import Config, ConfigError, from_env
from .model import join_text
from .scan import DEFAULT_LANGUAGE, Cancelled, OcrFailed, UndecodableImage, UnknownLanguage, join_pages, language_of, page_text
from .worker import Shutdown, Stopping, Worker

log = logging.getLogger("noterat_worker")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="noterat-worker", description="Noterat's worker: speech to text and reading scans. Settings come from the environment (see README.md).")
    what = parser.add_mutually_exclusive_group()
    what.add_argument("--file", metavar="AUDIO", help="transcribe this file, print the result and exit (no server needed)")
    what.add_argument("--ocr", metavar="IMAGE", nargs="+", help="read these images as the pages of one scan, print the text, write the PDF next to the first, and exit (no server needed)")
    parser.add_argument("--crop", action="store_true", help="with --ocr: find the page in each photo and straighten it (written next to it as NAME.cropped.jpg)")
    parser.add_argument("--language", metavar="CODE", help=f"with --file: the language, e.g. sv (default: detect it); with --ocr: Tesseract's languages (default: {DEFAULT_LANGUAGE})")
    args = parser.parse_args(argv)

    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S", stream=sys.stdout)
    if level != "DEBUG":
        # one line per job, not one per HTTP request of the model download and two per recording (nor
        # pikepdf's hello when img2pdf loads it)
        for name in ("httpx", "httpx2", "httpcore", "huggingface_hub", "faster_whisper", "pikepdf"):
            logging.getLogger(name).setLevel(logging.WARNING)
    try:
        config = from_env(need_server=not (args.file or args.ocr))
    except ConfigError as e:
        log.error("%s", e)
        return 2

    shutdown = Shutdown()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    try:
        if args.file:
            return transcribe_file(config, args.file, args.language)
        if args.ocr:
            return ocr_files(args.ocr, args.crop, args.language, shutdown)
        log.info("noterat-worker %s", os.environ.get("NOTERAT_VERSION") or __version__)
        worker = make_worker(config, shutdown)
        if worker is None:
            return 2
        worker.run()
        return 0
    except Stopping:
        log.info("stopped")
        return 0


def make_worker(config: Config, shutdown: Shutdown) -> Worker | None:
    """A worker for the kinds of job it's set to do (WORKER_KINDS): Whisper is only loaded when it's to
    transcribe. When OCR can't work here, it goes on without it, saying why; None when nothing's left."""
    kinds = list(config.kinds)
    scanner = None
    if "ocr" in kinds:
        scanner = load_ocr()
        if scanner is None:
            kinds.remove("ocr")
            if not kinds:
                log.error("WORKER_KINDS is ocr only, and OCR can't work here (above); stopping")
                return None
            log.warning("going on without OCR: scans are left for another worker")
    model = load(config, shutdown) if "transcribe" in kinds else None
    return Worker(
        Client(config.noterat_url, config.token),
        model,
        scanner=scanner,
        kinds=tuple(kinds),
        worker_name=config.worker_name,
        model_name=config.model if model is not None else None,
        server=config.noterat_url,
        shutdown=shutdown,
    )


def load_ocr():
    """The OCR engine, checked on a blank page; None (and why, in the log) when something's missing."""
    try:
        from .ocr import Ocr, OcrUnavailable
    except ImportError as e:  # OpenCV, Pillow or numpy: the ocr extra isn't installed
        log.error("OCR is off: %s isn't installed (pip install '.[ocr]', or use the image)", e.name or e)
        return None
    started = time.monotonic()
    try:
        ocr = Ocr()
        missing = [lang for lang in DEFAULT_LANGUAGE.split("+") if lang not in ocr.languages]
        if missing:
            log.warning("Tesseract hasn't got %s (it has %s): scans in it will be read badly; install tesseract-ocr-%s", "+".join(missing), ", ".join(ocr.languages) or "none", missing[0])
        ocr.warm_up()
    except OcrUnavailable as e:
        log.error("OCR is off: %s", e)
        return None
    log.info("OCR is ready: %s (%s) and OCRmyPDF %s, in %.1f s", ocr.name, ", ".join(ocr.languages), ocr.ocrmypdf, time.monotonic() - started)
    return ocr


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


def ocr_files(paths: list[str], crop: bool, language: str | None, shutdown: Shutdown) -> int:
    """Reads the images as one scan's pages, as an ocr job would: prints the text (all of it and each
    page's), whether each page was cropped and the timings; writes the PDF (and any cropped page) next
    to the first image."""
    from .ocr import Ocr, OcrUnavailable

    lang = language_of(language)
    if lang is None:
        log.error("--language should be Tesseract's names, e.g. swe+eng (it is %r)", language)
        return 2
    started = time.monotonic()
    try:
        ocr = Ocr()
    except OcrUnavailable as e:
        log.error("%s", e)
        return 1
    first = os.path.splitext(paths[0])[0]
    pdf = first + ".ocr.pdf"
    out = []
    try:
        with tempfile.TemporaryDirectory(prefix="noterat-ocr-") as tmp:
            pages = []
            for i, path in enumerate(paths):
                t0 = time.monotonic()
                page = ocr.prepare(path, os.path.join(tmp, f"page-{i}"), crop)
                item = {"file": path, "cropped": page.cropped, "size": [page.width, page.height], "prepare_seconds": round(time.monotonic() - t0, 2)}
                if page.cropped:
                    item["corners"] = page.corners
                    item["image"] = os.path.splitext(path)[0] + ".cropped.jpg"
                    shutil.copyfile(page.path, item["image"])
                pages.append(page)
                out.append(item)
            prepared = time.monotonic()
            texts = ocr.read([p.path for p in pages], pdf, lang, shutdown.is_set)
            done = time.monotonic()
    except (UndecodableImage, UnknownLanguage, OcrFailed) as e:
        log.error("%s", e)
        return 1
    except Cancelled:
        log.info("stopped")
        return 1
    for item, text in zip(out, texts):
        item["text"] = page_text(text)
    print(
        json.dumps(
            {
                "text": join_pages(texts),
                "language": lang,
                "model": ocr.name,
                "pdf": pdf,
                "pdf_bytes": os.path.getsize(pdf),
                "prepare_seconds": round(prepared - started, 2),
                "ocr_seconds": round(done - prepared, 2),
                "pages": out,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
