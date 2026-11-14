"""Reading scans: the page found in a photo with OpenCV (pages.py), then Tesseract through OCRmyPDF into
one searchable PDF, with each page's text beside it.

OCRmyPDF runs as a process of its own: a Tesseract that crashes doesn't take the worker with it, a
stop (SIGTERM) can end it at once, and the memory it used is given back when it's done.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable

from . import pages
from .scan import DEFAULT_LANGUAGE, Cancelled, OcrFailed, Page, UnknownLanguage

log = logging.getLogger("noterat_worker")

# The PDF's pages are this many pixels per inch. A phone photo says 72 (or nothing), which would make
# a page of a metre or so and tell Tesseract the text is huge; 300 is what a scanner gives, a 3000-pixel
# photo becomes a 25-cm page, and a straightened receipt about as wide as a real one.
DPI = pages.DPI

# Tesseract's page segmentation mode 6: "a single uniform block of text". It keeps a receipt's lines
# whole (the item and its price on one line), and it copes with a page photographed at a slant, which
# the default (3, which looks for blocks and columns) and 4 ("a single column") read in pieces. Tried
# on synthetic receipts and a letter, photographed straight, at a slant, sideways and small: 6 read
# the most lines right in every case, cropped or not.
PAGE_SEGMENTATION = 6

# How OCRmyPDF is run (on top of the language, the sidecar and the files). What was tried and left
# out: --deskew (slower, re-encodes the page, and read no better), --clean (unpaper: read the same,
# took twice as long, and 100 MB more in the image), --tesseract-thresholding sauvola or
# adaptive-otsu (both read uneven light worse than Otsu here).
OCRMYPDF_OPTIONS = [
    # a plain PDF: PDF/A would need Ghostscript and re-encode every page
    "--output-type", "pdf",
    # a page photographed sideways or upside down is turned (only the PDF's page, by its /Rotate)
    "--rotate-pages",
    "--tesseract-pagesegmode", str(PAGE_SEGMENTATION),
    "--optimize", "1",  # only lossless: the page's JPEG goes in as it is
    "--quiet",
]

# OCRmyPDF's exit codes that say the input or the setup is wrong, not that this try went badly.
_MISSING_DEPENDENCY = 3


class OcrUnavailable(Exception):
    """Something OCR needs isn't installed (or doesn't work); the message says what."""


class Ocr:
    def __init__(self, jobs: int | None = None, timeout: float = 600.0):
        """Checks that Tesseract and OCRmyPDF are there; raises OcrUnavailable if not."""
        self.jobs = jobs
        self.timeout = timeout  # for one job's OCRmyPDF, all its pages
        self.version = tesseract_version()
        self.languages = tesseract_languages()
        try:
            import img2pdf  # noqa: F401

            self.ocrmypdf = _run([sys.executable, "-m", "ocrmypdf", "--version"]).strip()
        except (ImportError, OSError, subprocess.SubprocessError) as e:
            raise OcrUnavailable(f"OCRmyPDF can't be run ({_short(e)}); install the worker with its ocr extra") from e
        self.name = f"tesseract {self.version}"

    def warm_up(self) -> None:
        """Reads a blank page, so a piece that's missing or broken shows now rather than in the first scan."""
        from PIL import Image

        with tempfile.TemporaryDirectory(prefix="noterat-ocr-check-") as tmp:
            blank = os.path.join(tmp, "blank.png")
            Image.new("L", (600, 400), 255).save(blank)
            try:
                self.read([blank], os.path.join(tmp, "blank.pdf"), DEFAULT_LANGUAGE, lambda: False)
            except (OcrFailed, UnknownLanguage) as e:
                raise OcrUnavailable(str(e)) from e

    # ── scan.Scanner ──

    def prepare(self, src: str, dest: str, crop: bool) -> Page:
        return pages.prepare(src, dest, crop)

    def read(self, images: list[str], pdf: str, language: str, should_stop: Callable[[], bool]) -> list[str]:
        import img2pdf

        base = os.path.splitext(pdf)[0]
        source = base + ".images.pdf"
        sidecar = base + ".txt"
        try:
            with open(source, "wb") as f:
                # the images go in as they are (a JPEG isn't re-encoded); they're upright already
                img2pdf.convert(images, outputstream=f, layout_fun=img2pdf.get_fixed_dpi_layout_fun((DPI, DPI)), rotation=img2pdf.Rotation.none)
        except Exception as e:
            raise OcrFailed(f"the pages couldn't be put into a PDF ({_short(e)})") from e

        command = [sys.executable, "-m", "ocrmypdf", "--language", language, "--sidecar", sidecar, *OCRMYPDF_OPTIONS]
        if self.jobs:
            command += ["--jobs", str(self.jobs)]
        command += [source, pdf]
        log.debug("running %s", " ".join(command))
        with open(base + ".log", "w+b") as output:
            proc = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + self.timeout
            try:
                while True:
                    try:
                        code = proc.wait(timeout=0.2)
                        break
                    except subprocess.TimeoutExpired:
                        if should_stop():
                            raise Cancelled() from None
                        if time.monotonic() > deadline:
                            raise OcrFailed(f"reading the pages took longer than {self.timeout:.0f} s") from None
            finally:
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait()
            output.seek(0)
            said = output.read().decode("utf-8", "replace")

        if code != 0:
            log.debug("OCRmyPDF said:\n%s", said)
            if code == _MISSING_DEPENDENCY and "language" in said.lower():
                raise UnknownLanguage(f"Tesseract on the worker can't read {language!r} (its language data isn't installed)")
            raise OcrFailed(f"reading the pages failed ({_last_line(said) or f'OCRmyPDF exited with {code}'})")
        if said.strip():
            log.debug("OCRmyPDF said:\n%s", said.strip())
        try:
            with open(sidecar, encoding="utf-8", errors="replace") as f:
                text = f.read()
        except OSError as e:
            raise OcrFailed(f"OCRmyPDF wrote no text ({_short(e)})") from e
        # the sidecar has the pages' text one after another, a form feed between two pages
        texts = text.split("\f")
        texts = [_skipped(t) for t in texts[: len(images)]]
        return texts + [""] * (len(images) - len(texts))


def tesseract_version() -> str:
    try:
        said = _run(["tesseract", "--version"])
    except (OSError, subprocess.SubprocessError) as e:
        raise OcrUnavailable(f"Tesseract can't be run ({_short(e)}); install tesseract-ocr") from e
    m = re.search(r"tesseract\s+v?([\w.\-]+)", said, re.IGNORECASE)
    return m.group(1) if m else "?"


def tesseract_languages() -> list[str]:
    try:
        said = _run(["tesseract", "--list-langs"])
    except (OSError, subprocess.SubprocessError) as e:
        raise OcrUnavailable(f"Tesseract can't list its languages ({_short(e)})") from e
    # the first line says where it looked
    return [line.strip() for line in said.splitlines()[1:] if line.strip()]


def _run(command: list[str]) -> str:
    return subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60, check=True).stdout or ""


def _skipped(text: str) -> str:
    # what OCRmyPDF puts for a page it didn't read (one with text already: not ours, but be safe)
    return "" if re.fullmatch(r"\s*\[OCR skipped on page\(s\) [\d\-, ]+\]\s*", text) else text


def _last_line(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith(("Traceback", "File ", "^"))]
    return lines[-1][:200] if lines else ""


def _short(e: BaseException) -> str:
    if isinstance(e, subprocess.CalledProcessError):
        return _last_line(str(e.stderr or e.stdout or "")) or f"exit code {e.returncode}"
    return str(e) or type(e).__name__
