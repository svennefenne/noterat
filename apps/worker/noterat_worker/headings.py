"""Reading a recipe out of a page that hasn't one a program can see (no schema.org Recipe, no site
recipe-scrapers knows): a blog post with a heading "Ingredienser" over a list, and "Gör så här" over
another, as people write them. It's a guess, and said to be one (Recipe.guessed), so the app asks
for it to be looked over, and offers the page's pictures to choose from (Recipe.images).

Only the page the server fetched is read, with BeautifulSoup (which recipe-scrapers brings).
"""

from __future__ import annotations

import re
from typing import Any

from .recipe import DESCRIPTION_LIMIT, TITLE_LIMIT, Recipe, image_of, line, lines, servings_of, steps

# What a heading over the ingredients says, and over the method: Swedish, the Nordic languages,
# English and a few more. (A heading longer than HEADING_MAX is a sentence, not a heading.)
_INGREDIENTS = re.compile(
    r"ingredien|du behöver|det här behöver du|detta behöver du|till \d+ portioner|zutaten|ainekset|"
    r"you(?:'|’| wi)ll need|what you need",
    re.IGNORECASE,
)
_METHOD = re.compile(
    r"gör så här|så här gör du|gör så|instruktion|tillagning|tillvägagångssätt|steg för steg|^steg\b|"
    r"fremgangsmåde|sådan gør du|framgangsmåte|slik gjør du|valmistus|"
    r"instructions?|directions|method|^steps?\b|preparation|how to make|zubereitung|préparation|elaboración|preparazione",
    re.IGNORECASE,
)
# A part after the ingredients or the method that isn't more of them ("Tips", "Ersättningar"): where
# they end.
_NOT_THE_RECIPE = re.compile(r"tips|substitut|ersätt|alternativ|variation|servering|serving|förvaring|storage|equipment|utrustning|note|anteckning", re.IGNORECASE)
_SERVINGS = re.compile(r"(?:serves|servings|portioner|portions|yield|makes|räcker till)\s*:?\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:portioner|servings|personer|port\.)", re.IGNORECASE)
HEADING_MAX = 60
# Where the page's pictures are not: its frame, the site's own, and what's beside the post.
_NOT_CONTENT = re.compile(r"related|similar|comment|share|social|sidebar|widget|author|footer|\bnav|menu|newsletter|cookie|popup|modal", re.IGNORECASE)
_NOT_A_PHOTO = re.compile(r"logo|avatar|gravatar|icon|emoji|sprite|pixel|spinner|placeholder|loading|badge|banner|\bads?\b|ads-|advert", re.IGNORECASE)
MAX_IMAGES = 12
MIN_SIDE = 150  # px, when the page says: anything smaller is an icon or a button


def read_by_headings(html: str, url: str) -> Recipe | None:
    """The recipe under the page's headings, or None when there's no list of ingredients under one."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    meta = _meta(soup)
    for tag in soup(["script", "style", "noscript", "template", "iframe", "svg", "form"]):
        tag.decompose()

    found = _ingredients(soup)
    if found is None:
        return None
    heading, ingredients = found
    method = _method(soup, heading)
    root = _content_root(heading)
    images = _images(root, url, meta)
    recipe = Recipe(
        title=_title(soup, root, meta),
        ingredients=lines(ingredients),
        steps=steps(method),
        servings=_servings(root, heading),
        image=images[0] if images else None,
        images=images,
        description=line(meta.get("description"), DESCRIPTION_LIMIT) or None,
        read_by="headings",
        guessed=True,
    )
    return recipe if recipe.ingredients else None


# ── the page's headings ──


def _level(tag: Any) -> int | None:
    """How big a heading the tag is: 1–6 for <h1>–<h6>, 7 for a short paragraph that's all bold or
    ends with a colon ("<p><strong>Till såsen</strong></p>", "Du behöver:"); None if it's no heading."""
    name = getattr(tag, "name", None)
    if name and re.fullmatch(r"h[1-6]", name):
        return int(name[1])
    if name in ("p", "div") and not tag.find(["p", "div", "ul", "ol", "img"]):
        text = line(tag.get_text(" ", strip=True))
        if not text or len(text) > HEADING_MAX:
            return None
        bold = "".join(b.get_text(" ", strip=True) for b in tag.find_all(["strong", "b"]))
        if line(bold) == text or text.endswith(":"):
            return 7
    return None


def _text(tag: Any) -> str:
    return line(tag.get_text(" ", strip=True)).rstrip(":").strip()


def _headings(soup: Any, words: re.Pattern[str]) -> list[Any]:
    out = []
    for tag in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "div"]):
        if _level(tag) is None:
            continue
        text = _text(tag)
        if text and len(text) <= HEADING_MAX and words.search(text):
            out.append(tag)
    return out


def _section(heading: Any) -> list[Any]:
    """What's under a heading: the tags after it, up to the next heading as big as it or bigger. (A
    bold paragraph's own parts are bold paragraphs too, "Till såsen:": what ends it is a real heading,
    or a bold one that starts another part of the recipe, or what's after it.)"""
    level = _level(heading) or 7
    out = []
    for tag in heading.find_all_next(True):
        if heading in tag.parents:
            continue
        found = _level(tag)
        if found is not None and found <= level:
            if found < 7 or any(words.search(_text(tag)) for words in (_INGREDIENTS, _METHOD, _NOT_THE_RECIPE)):
                break
        out.append(tag)
    return out


def _items(list_tag: Any) -> list[str]:
    return [li.get_text(" ", strip=True) for li in list_tag.find_all("li", recursive=False)]


def _lists(section: list[Any], kinds: tuple[str, ...]) -> list[str]:
    """The section's first list, and the lists after it under smaller headings of their own ("Till
    såsen:" and its list, as "Till såsen:" and its lines); a list after anything else ("Tips", or no
    heading at all) is the end of it."""
    out: list[str] = []
    taken: list[Any] = []
    under: str | None = None
    for tag in section:
        if any(t in tag.parents for t in taken):
            continue
        # (a heading in the section is a smaller one: _section ends at the others)
        if _level(tag) is not None:
            under = _text(tag)
            continue
        if tag.name not in kinds:
            continue
        items = [i for i in _items(tag) if i]
        if not items:
            continue
        if taken:
            if not under or _NOT_THE_RECIPE.search(under):
                break
            out.append(f"{under}:")
        out.extend(items)
        taken.append(tag)
        under = None
    return out


def _ingredients(soup: Any) -> tuple[Any, list[str]] | None:
    """The first heading over ingredients with a list under it, and the list (two lines or more)."""
    for heading in _headings(soup, _INGREDIENTS):
        found = _lists(_section(heading), ("ul", "ol"))
        if len(found) >= 2:
            return heading, found
    return None


def _method(soup: Any, after: Any) -> list[str]:
    """The steps: under the first heading over the method with a numbered list, else one with a
    list, else its paragraphs (an introduction ending with a colon left out). Headings after the
    ingredients first."""
    headings = _headings(soup, _METHOD)
    later = [h for h in headings if after in h.find_all_previous(True)]
    for candidates in (later, headings):
        for kinds in (("ol",), ("ul", "ol")):
            for heading in candidates:
                found = _lists(_section(heading), kinds)
                if found:
                    return found
        for heading in candidates:
            paragraphs = _paragraphs(_section(heading))
            if paragraphs:
                return paragraphs
    return []


def _paragraphs(section: list[Any]) -> list[str]:
    """A method written as paragraphs, up to "Tips" or the like."""
    out: list[str] = []
    for tag in section:
        if _level(tag) is not None:
            if _NOT_THE_RECIPE.search(_text(tag)):
                break
            continue
        text = line(tag.get_text(" ", strip=True)) if tag.name == "p" else ""
        if len(text) > 20 and not text.endswith(":"):
            out.append(text)
            if len(out) == 30:
                break
    return out


# ── the rest ──


def _meta(soup: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    for tag in soup.find_all("meta"):
        key = (tag.get("property") or tag.get("name") or "").lower()
        if key in ("og:title", "og:image", "og:image:secure_url", "twitter:image", "og:description", "description", "og:site_name") and tag.get("content"):
            out.setdefault(key.removeprefix("og:"), str(tag["content"]))
    title = soup.find("title")
    if title:
        out.setdefault("page_title", title.get_text(" ", strip=True))
    return out


def _content_root(heading: Any) -> Any:
    """The post the heading is in: its outermost <article> (a theme may wrap parts of the post in
    their own), else <main>, else the page."""
    articles = [p for p in heading.parents if p.name == "article"]
    if articles:
        return articles[-1]
    return next((p for p in heading.parents if p.name == "main"), None) or heading.find_parent("body") or heading.find_parent()


def _title(soup: Any, root: Any, meta: dict[str, str]) -> str | None:
    h1 = root.find("h1") or soup.find("h1")
    if h1 and _text(h1):
        return line(h1.get_text(" ", strip=True), TITLE_LIMIT)
    for key in ("title", "page_title"):
        text = meta.get(key, "")
        site = meta.get("site_name", "")
        # "Köttbullar | Mormors kök" → "Köttbullar"
        parts = re.split(r"\s+[|–—-]\s+", text)
        if len(parts) > 1 and (not site or site in parts[-1]):
            text = " - ".join(parts[:-1])
        if line(text):
            return line(text, TITLE_LIMIT)
    return None


def _servings(root: Any, heading: Any) -> int | float | None:
    for text in (_text(heading), root.get_text(" ", strip=True)[:20_000]):
        m = _SERVINGS.search(text)
        if m:
            return servings_of(m.group(1) or m.group(2))
    return None


def _images(root: Any, url: str, meta: dict[str, str]) -> list[str]:
    """The page's own picture (og:image) first, then the pictures in the post, as whole addresses;
    no logos, icons, avatars or ads, nothing beside the post, nothing the page says is small."""
    found: list[str] = []

    def add(value: Any) -> None:
        image = image_of(value, url) if isinstance(value, str) and not value.startswith("data:") else None
        if image and image not in found and not _NOT_A_PHOTO.search(urlpath(image)) and len(found) < MAX_IMAGES:
            found.append(image)

    for key in ("image:secure_url", "image", "twitter:image"):
        add(meta.get(key))
    for img in root.find_all("img"):
        if _NOT_A_PHOTO.search(_names(img)) or _small(img.get("width")) or _small(img.get("height")) or _beside(img, root):
            continue
        add(_largest(img.get("data-srcset") or img.get("srcset")) or img.get("data-lazy-src") or img.get("data-src") or img.get("data-original") or img.get("src"))
    return found


def _names(tag: Any) -> str:
    return " ".join(tag.get("class", [])) + " " + str(tag.get("id") or "")


def _beside(img: Any, root: Any) -> bool:
    """Whether a picture in the post is in something beside it: links to other posts, comments,
    buttons for sharing, a menu."""
    for parent in img.parents:
        if parent is root:
            return False
        if parent.name in ("nav", "footer") or _NOT_CONTENT.search(_names(parent)):
            return True
    return False


def urlpath(image: str) -> str:
    """The address without its query (a picture's "?w=1280&logo=…" says nothing of what it is)."""
    return image.split("?", 1)[0].rsplit("/", 1)[-1]


def _small(value: Any) -> bool:
    try:
        return int(str(value).strip().removesuffix("px")) < MIN_SIDE
    except (TypeError, ValueError):
        return False


def _largest(srcset: Any) -> str | None:
    """The biggest picture in a srcset that's no more than 2000 px wide (a page's "full size" can be
    a camera's)."""
    if not isinstance(srcset, str):
        return None
    best: tuple[int, str] | None = None
    for part in srcset.split(","):
        bits = part.strip().split()
        if not bits:
            continue
        width = int(bits[1][:-1]) if len(bits) > 1 and bits[1].endswith("w") and bits[1][:-1].isdigit() else 0
        if width <= 2000 and (best is None or width > best[0]):
            best = (width, bits[0])
    return best[1] if best else None
