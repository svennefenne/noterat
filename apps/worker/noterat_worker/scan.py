"""What the worker needs to read a scan, kept small so the tests can stand in a fake (and OpenCV and
OCRmyPDF, which are big, are only imported by pages.py and ocr.py)."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Protocol

# Tesseract's names for the languages, joined by "+": it reads Swedish and English on the same page.
DEFAULT_LANGUAGE = "swe+eng"
_LANGUAGE = re.compile(r"^[A-Za-z][A-Za-z_]*(\+[A-Za-z][A-Za-z_]*)*$")


@dataclass
class Page:
    """A page ready to be read: the photo as it was, or the page found in it and straightened."""

    path: str  # the image the PDF's page is made from
    cropped: bool  # True: path is a new JPEG of the page found in the photo (to upload)
    width: int
    height: int
    # where the page's corners were found in the (upright) photo: top left, top right, bottom right,
    # bottom left; None when it wasn't cropped
    corners: list[tuple[int, int]] | None = None


class UndecodableImage(Exception):
    """The file isn't an image that can be read; trying again won't help."""


class UnknownLanguage(Exception):
    """Tesseract hasn't got the language the job asks for; trying again on this worker won't help."""


class OcrFailed(Exception):
    """Reading went wrong (OCRmyPDF or Tesseract crashed, or a timeout); another try may work."""


class Cancelled(Exception):
    """The reading was stopped part-way, because the worker is stopping."""


class Scanner(Protocol):
    name: str  # what reads the text, e.g. "tesseract 5.5.0"

    def prepare(self, src: str, dest: str, crop: bool) -> Page:
        """Reads the image at src, upright (as its EXIF says). With crop, looks for the page in it and,
        if there's a clear one, writes it straightened as a JPEG at dest (with an extension added).
        Raises UndecodableImage for a file that isn't an image."""
        ...

    def read(self, images: list[str], pdf: str, language: str, should_stop: Callable[[], bool]) -> list[str]:
        """Reads the images, in order, into one searchable PDF at pdf; returns each page's text.
        Raises Cancelled when should_stop() turns true, UnknownLanguage, UndecodableImage or OcrFailed."""
        ...


def language_of(value: object) -> str | None:
    """The job's language in Tesseract's form ("swe+eng"); the default when it names none, and None
    when it isn't a language name at all (it goes on OCRmyPDF's command line)."""
    text = str(value or "").strip()
    if not text:
        return DEFAULT_LANGUAGE
    return text if _LANGUAGE.match(text) else None


def page_text(text: str) -> str:
    """One page's text as Tesseract gives it, tidied: no spaces at the ends of lines, at most one blank
    line in a row, nothing around it."""
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def join_pages(texts: Iterable[str]) -> str:
    """The pages' texts as one text, a blank line between pages (an empty page adds nothing)."""
    return "\n\n".join(t for t in (page_text(t) for t in texts) if t).strip()
