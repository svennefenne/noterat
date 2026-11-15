"""What the worker needs to read a recipe out of a web page, kept small so the tests can stand in a fake
reader (and recipe-scrapers, which brings BeautifulSoup and extruct, is only imported by scraper.py).

The page's bytes come from the server, which fetched them (docs/decisions/0009); the worker never goes
on the network for a recipe. Here they're turned into text, and what was read is tidied into what the
server is sent.
"""

from __future__ import annotations

import codecs
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urljoin, urlsplit

# How long what's sent may be. A title or an ingredient longer than this is junk from the page (a
# whole paragraph read as one), and the recipe is a document that syncs to every phone.
TITLE_LIMIT = 200
LINE_LIMIT = 500  # an ingredient, or a step
DESCRIPTION_LIMIT = 1000
IMAGE_LIMIT = 2000  # a URL cut short is no URL, so a longer one is left out
MAX_LINES = 200  # ingredients, and steps

# Where a <meta charset> is looked for: browsers look in the first 1024 bytes, but plenty of pages put
# it after a long run of other <meta>s and scripts.
CHARSET_WINDOW = 64 * 1024
_META_CHARSET = re.compile(rb"""<meta\b[^>]*?charset\s*=\s*["']?\s*([A-Za-z0-9_.:\-]+)""", re.IGNORECASE)
_XML_DECLARATION = re.compile(r"^\s*<\?xml[^>]*\?>", re.IGNORECASE)
_XML_ENCODING = re.compile(rb"""^\s*<\?xml[^>]*?encoding\s*=\s*["']([A-Za-z0-9_.:\-]+)""", re.IGNORECASE)
# Python's codecs that aren't a web page's encoding, whatever the page says.
_NOT_A_PAGE_ENCODING = {"idna", "punycode", "raw-unicode-escape", "unicode-escape", "undefined", "utf-7", "mbcs", "oem"}

_SPACE = re.compile(r"\s+")
# zero-width spaces and joiners, a byte order mark, a soft hyphen: invisible, and in the way of matching
_INVISIBLE = re.compile("[\u200b\u200c\u200d\u2060\ufeff\u00ad]")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


@dataclass
class Recipe:
    """A recipe as the server is sent it (as_json), tidied: strings trimmed, empty ones left out,
    lengths capped."""

    title: str | None = None
    ingredients: list[str] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    servings: int | float | None = None
    minutes: int | None = None
    image: str | None = None
    description: str | None = None
    # not sent: what read it ("arla.se", recipe-scrapers' scraper for the site, or "schema.org", its
    # reading of any page's schema.org data), and the fields it couldn't find, with why
    read_by: str = ""
    missing: dict[str, str] = field(default_factory=dict)

    def found(self) -> bool:
        """A title or an ingredient: anything less, and the page had no recipe the worker could see."""
        return bool(self.title or self.ingredients)

    def as_json(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "ingredients": self.ingredients,
            "steps": self.steps,
            "servings": self.servings,
            "minutes": self.minutes,
            "image": self.image,
            "description": self.description,
        }


class UndecodablePage(Exception):
    """The file isn't a web page that can be read as text; trying again won't help."""


class NoRecipe(Exception):
    """The page was read, and there's no recipe on it; trying again won't help."""


class RecipeReader(Protocol):
    name: str  # what reads the recipes, e.g. "recipe-scrapers 15.13.0"

    def read(self, html: str, url: str) -> Recipe:
        """Reads the recipe in the page (url is only where it came from, for knowing the site; it is
        never fetched). Raises NoRecipe when there's none; anything else that goes wrong is unexpected."""
        ...


# ── the page's text ──


def decode_page(data: bytes, content_type: str | None = None) -> tuple[str, str]:
    """The page as text, and the encoding it was read in: as its byte order mark says, else the
    charset the file's type says, else its <meta charset> (or an XHTML page's <?xml encoding>), unless
    it's valid UTF-8 anyway, else UTF-8, with anything that isn't replaced by �. Raises
    UndecodablePage for a file that isn't a page."""
    if not data.strip():
        raise UndecodablePage("the page is empty")
    encoding = None
    for bom, name in ((codecs.BOM_UTF8, "utf-8"), (codecs.BOM_UTF16_LE, "utf-16-le"), (codecs.BOM_UTF16_BE, "utf-16-be")):
        if data.startswith(bom):
            data, encoding = data[len(bom) :], name
            break
    if encoding is None:
        encoding = _encoding(_charset_of_type(content_type)) or _page_encoding(data)
    text = data.decode(encoding, errors="replace")
    head = text[:CHARSET_WINDOW]
    # a picture, a PDF or a zip has NULs early on; a page in the wrong encoding has some � but no NULs
    if "\x00" in head or head.count("\ufffd") > len(head) / 4:
        raise UndecodablePage("the page isn't text that can be read (it looks like another kind of file)")
    # An XHTML page's <?xml … encoding="…"?> stops lxml (under recipe-scrapers) from reading a str at
    # all, which looked like a page with no recipe. It's been decoded now, so the declaration can go.
    return _XML_DECLARATION.sub("", text, count=1), encoding


def _page_encoding(data: bytes) -> str:
    """What the page says it's in, unless it's UTF-8 whatever it says: the server keeps a page it
    fetched as UTF-8 text, and the page's <meta> still names what it was sent in. Bytes beyond ASCII
    that are all valid UTF-8 are next to never ISO-8859-1 or Windows-1252 text by chance."""
    said = _encoding(_meta_charset(data)) or _encoding(_xml_encoding(data))
    if said and said != "utf-8" and not data.isascii():
        try:
            data.decode("utf-8")
            return "utf-8"
        except UnicodeDecodeError:
            pass
    return said or "utf-8"


def _charset_of_type(content_type: str | None) -> str | None:
    m = re.search(r";\s*charset\s*=\s*[\"']?([^\"';\s]+)", content_type or "", re.IGNORECASE)
    return m.group(1) if m else None


def _meta_charset(data: bytes) -> str | None:
    m = _META_CHARSET.search(data[:CHARSET_WINDOW])
    return m.group(1).decode("ascii", "replace") if m else None


def _xml_encoding(data: bytes) -> str | None:
    """What an XHTML page's <?xml … encoding="…"?> says, for one without a <meta charset>."""
    m = _XML_ENCODING.match(data[:1024])
    return m.group(1).decode("ascii", "replace") if m else None


def _encoding(label: str | None) -> str | None:
    """Python's codec for a charset a page names; None for one it doesn't know (the page is then read
    as UTF-8, as a browser falls back too)."""
    if not label:
        return None
    try:
        info = codecs.lookup(label.strip().lower())
    except LookupError:
        return None
    if not getattr(info, "_is_text_encoding", True) or info.name in _NOT_A_PAGE_ENCODING:
        return None
    # As browsers do: ISO-8859-1 and ASCII mean Windows-1252, which pages so labelled use (€, “ ”, –),
    # and a page that's readable as ASCII to find its <meta> can't be UTF-16, whatever it says.
    if info.name in ("iso8859-1", "ascii"):
        return "cp1252"
    if info.name.startswith("utf-16"):
        return "utf-8"
    return info.name


# ── tidying what was read ──


def line(value: Any, limit: int = LINE_LIMIT) -> str:
    """One line of text: whitespace (line breaks too) made single spaces, trimmed, capped."""
    if value is None or isinstance(value, (bool, dict, list, tuple)):
        return ""
    text = _SPACE.sub(" ", _INVISIBLE.sub("", str(value))).strip()
    return clip(text, limit)


def clip(text: str, limit: int) -> str:
    """At most limit characters: cut at a word if one ends near the limit, with "…" for what's left out."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    space = cut.rfind(" ")
    if space > limit * 0.8:
        cut = cut[:space]
    return cut.rstrip(" ,;:-–") + "…"


def lines(values: Iterable[Any] | None, limit: int = LINE_LIMIT, count: int = MAX_LINES) -> list[str]:
    """Each value as a line; empty ones left out; at most count of them."""
    if isinstance(values, str):
        values = [values]
    out: list[str] = []
    for value in values or ():
        text = line(value, limit)
        if text:
            out.append(text)
            if len(out) == count:
                break
    return out


def steps(values: Iterable[Any] | None, limit: int = LINE_LIMIT, count: int = MAX_LINES) -> list[str]:
    """As lines, except that a step too long for one is split between its sentences: some sites put
    the whole method in one block, and cutting it at the limit would lose the rest of the recipe."""
    if isinstance(values, str):
        values = [values]
    out: list[str] = []
    for value in values or ():
        text = line(value, limit=1 << 20)
        for part in _split(text, limit) if text else ():
            out.append(part)
            if len(out) == count:
                return out
    return out


def _split(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    parts: list[str] = []
    current = ""
    for sentence in _SENTENCE_END.split(text):
        joined = f"{current} {sentence}" if current else sentence
        if len(joined) <= limit:
            current = joined
            continue
        if current:
            parts.append(current)
        current = sentence if len(sentence) <= limit else clip(sentence, limit)
    if current:
        parts.append(current)
    return parts


def servings_of(value: Any) -> int | float | None:
    """The number of servings in what a page says: "4 portioner" → 4, "4-6 portioner" → 4 (the
    smaller), ["4", "4 portioner"] → 4, "1,5 liter" → 1.5; None when there's no number, or a silly one."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (list, tuple)):
        for item in value:
            number = servings_of(item)
            if number is not None:
                return number
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        m = _NUMBER.search(str(value))
        if not m:
            return None
        number = float(m.group(0).replace(",", "."))
    if not 0 < number <= 1000:
        return None
    return int(number) if number.is_integer() else round(number, 2)


def minutes_of(value: Any) -> int | None:
    """Whole minutes, more than none and less than a fortnight; None otherwise."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    minutes = round(value)
    return minutes if 0 < minutes < 14 * 24 * 60 else None


def image_of(value: Any, page_url: str) -> str | None:
    """The image's address, made whole against the page's (a page may give "/bilder/x.jpg"); only
    http(s), and None for one that's too long to be kept whole."""
    if not isinstance(value, str) or not value.strip():
        return None
    # (a space left in a file name happens; a URL can't have one)
    url = urljoin(page_url, value.strip().replace(" ", "%20"))
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc or len(url) > IMAGE_LIMIT or _SPACE.search(url):
        return None
    return url
