"""Recipe jobs (docs/decisions/0009) through the worker's loop, against the fake Noterat: with the real
recipe-scrapers on small pages (those tests skip themselves when it isn't installed; CI installs it),
and with a fake reader for what goes wrong. Then the page's encoding, the tidying, and the job kinds."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import socket
import sys
from typing import Any

import pytest
from fake_noterat import FakeNoterat
from test_worker import Running, make_worker

from noterat_worker import __main__ as cli
from noterat_worker.config import from_env
from noterat_worker.recipe import (
    NoRecipe,
    Recipe,
    UndecodablePage,
    clip,
    decode_page,
    image_of,
    line,
    lines,
    minutes_of,
    servings_of,
    steps,
)
from noterat_worker.worker import Worker

needs_scrapers = pytest.mark.skipif(importlib.util.find_spec("recipe_scrapers") is None, reason="recipe-scrapers isn't installed")

URL = "https://mormorskok.example/recept/kottbullar-med-graddsas"

# A page with its recipe as schema.org JSON-LD, on a site recipe-scrapers has no scraper of its own for.
KOTTBULLAR = """<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<title>Köttbullar med gräddsås | Mormors kök</title>
<meta property="og:title" content="Köttbullar med gräddsås">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Recipe",
  "name": "Köttbullar med gräddsås",
  "description": "Mormors köttbullar,  som de ska vara.\\n Med gräddsås och lingon.",
  "image": ["https://mormorskok.example/bilder/kottbullar.jpg"],
  "recipeYield": "4 portioner",
  "totalTime": "PT45M",
  "recipeIngredient": ["500 g blandfärs", "1 dl ströbröd", "1 ägg", "2 dl mjölk", " 1 gul lök ", "", "salt och peppar"],
  "recipeInstructions": [
    {"@type": "HowToStep", "text": "Blanda ströbröd och mjölk och låt svälla i 10 minuter."},
    {"@type": "HowToStep", "text": "Riv löken och blanda med färs, ägg, salt och peppar."},
    {"@type": "HowToStep", "text": "Rulla små bullar och stek dem gyllene i smör."},
    {"@type": "HowToStep", "text": "Koka upp grädde och buljong till en sås och servera."}
  ]
}
</script>
</head>
<body><h1>Köttbullar med gräddsås</h1><p>Mormors bästa.</p></body>
</html>
"""
KOTTBULLAR_RECIPE = {
    "title": "Köttbullar med gräddsås",
    "ingredients": ["500 g blandfärs", "1 dl ströbröd", "1 ägg", "2 dl mjölk", "1 gul lök", "salt och peppar"],
    "steps": [
        "Blanda ströbröd och mjölk och låt svälla i 10 minuter.",
        "Riv löken och blanda med färs, ägg, salt och peppar.",
        "Rulla små bullar och stek dem gyllene i smör.",
        "Koka upp grädde och buljong till en sås och servera.",
    ],
    "servings": 4,
    "minutes": 45,
    "image": "https://mormorskok.example/bilder/kottbullar.jpg",
    "description": "Mormors köttbullar, som de ska vara. Med gräddsås och lingon.",
}

# An older site's page: ISO-8859-1, said so in a <meta http-equiv>, and a range of servings.
ARTSOPPA = """<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">
<title>Ärtsoppa med fläsk</title>
<script type="application/ld+json">
{"@context": "http://schema.org", "@type": "Recipe", "name": "Ärtsoppa med fläsk",
 "recipeIngredient": ["500 g gula ärtor", "1 gul lök", "400 g rimmat fläsk", "1 tsk timjan"],
 "recipeInstructions": "Blötlägg ärtorna över natten.\\nKoka ärtorna med lök och fläsk i 2 timmar.\\nSmaka av med timjan.",
 "recipeYield": "4-6 portioner", "prepTime": "PT30M", "cookTime": "PT2H"}
</script></head><body><h1>Ärtsoppa med fläsk</h1></body></html>
""".encode("iso-8859-1")

# A page with no recipe on it at all.
OM_OSS = """<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Om oss</title>
<meta property="og:title" content="Om Mormors kök"><meta property="og:image" content="/bilder/mormor.jpg">
<script type="application/ld+json">{"@context": "https://schema.org", "@type": "WebSite", "name": "Mormors kök"}</script>
</head><body><h1>Om oss</h1><p>Vi lagar mat.</p></body></html>
"""

# A recipe as microdata (no JSON-LD), its picture given relative to the page.
PANNKAKOR = """<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Pannkakor</title></head><body>
<div itemscope itemtype="http://schema.org/Recipe">
<h1 itemprop="name">Pannkakor</h1>
<span itemprop="recipeYield">4 portioner</span><meta itemprop="totalTime" content="PT30M">
<ul><li itemprop="recipeIngredient">3 dl vetemjöl</li><li itemprop="recipeIngredient">6 dl mjölk</li><li itemprop="recipeIngredient">3 ägg</li></ul>
<div itemprop="recipeInstructions"><p>Vispa ihop mjöl och hälften av mjölken.</p><p>Vispa i resten av mjölken och äggen.</p></div>
<img itemprop="image" src="/bilder/pannkakor.jpg" alt="">
</div></body></html>
"""


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def recipe_job(job_id: str = "recipe-1", page: bytes = KOTTBULLAR.encode(), url: str | None = URL) -> dict[str, Any]:
    job: dict[str, Any] = {"id": job_id, "kind": "recipe", "files": [{"hash": sha(page), "type": "text/html", "size": len(page)}]}
    if url is not None:
        job["url"] = url
    return job


@pytest.fixture
def server():
    pages = [KOTTBULLAR.encode(), ARTSOPPA, OM_OSS.encode(), PANNKAKOR.encode()]
    fake = FakeNoterat(files={sha(p): p for p in pages}, types={sha(p): "text/html" for p in pages})
    yield fake
    fake.close()


def scraper():
    from noterat_worker.scraper import Scraper

    return Scraper()


def recipe_worker(server: FakeNoterat, reader: Any, **kwargs: Any) -> Worker:
    return make_worker(server, None, reader=reader, model_name=None, **kwargs)


def run_one(server: FakeNoterat, reader: Any, *jobs: dict[str, Any]) -> None:
    server.answers = list(jobs)
    last = jobs[-1]["id"]
    running = Running(recipe_worker(server, reader))
    server.wait_for(lambda rs: any(r.path.endswith((f"/{last}/done", f"/{last}/failed")) for r in rs))
    running.stop()


class FakeReader:
    """Gives the recipe it was given (or raises), and remembers what it was asked to read."""

    name = "fake-reader 1.0"

    def __init__(self, recipe: Recipe | None = None, error: Exception | None = None):
        self.recipe = recipe or Recipe(title="Pannkakor", ingredients=["3 ägg"], read_by="fake")
        self.error = error
        self.reads: list[tuple[str, str]] = []

    def read(self, html: str, url: str) -> Recipe:
        self.reads.append((html, url))
        if self.error:
            raise self.error
        return self.recipe


# ── with recipe-scrapers ──


@needs_scrapers
def test_a_recipe_job_fetches_the_page_reads_it_and_is_done(server: FakeNoterat):
    run_one(server, scraper(), recipe_job())

    paths = server.paths()
    assert paths[:3] == ["POST /api/worker/next", f"GET /api/worker/files/{sha(KOTTBULLAR.encode())}", "POST /api/worker/jobs/recipe-1/done"]
    assert all(p == "POST /api/worker/next" for p in paths[3:])  # no progress: it's quick
    assert server.requests[0].body["kinds"] == ["recipe"]
    assert server.requests[0].body["model"] is None
    (done,) = server.find("/done")
    assert done.body == {"recipe": KOTTBULLAR_RECIPE}
    assert not server.find("/failed")


@needs_scrapers
def test_a_page_without_a_recipe_fails_without_retry(server: FakeNoterat):
    run_one(server, scraper(), recipe_job(page=OM_OSS.encode(), url="https://mormorskok.example/om-oss"))

    (failed,) = server.find("/failed")
    assert failed.body == {"error": "no recipe was found on the page", "retry": False}
    assert not server.find("/done")


@needs_scrapers
def test_a_page_in_iso_8859_1_is_read_by_its_meta_charset(server: FakeNoterat):
    run_one(server, scraper(), recipe_job(page=ARTSOPPA, url="https://gammalsajt.example/recept.php?id=12"))

    (done,) = server.find("/done")
    assert done.body == {
        "recipe": {
            "title": "Ärtsoppa med fläsk",
            "ingredients": ["500 g gula ärtor", "1 gul lök", "400 g rimmat fläsk", "1 tsk timjan"],
            "steps": ["Blötlägg ärtorna över natten.", "Koka ärtorna med lök och fläsk i 2 timmar.", "Smaka av med timjan."],
            "servings": 4,  # "4-6 portioner": the smaller
            "minutes": 150,  # no totalTime: prepTime and cookTime added up
            "image": None,
            "description": None,
        }
    }


@needs_scrapers
def test_a_page_the_server_kept_as_utf_8_is_read_whatever_its_meta_says(server: FakeNoterat):
    # the server decodes the page it fetched and keeps it as UTF-8; its <meta> still says ISO-8859-1
    page = ARTSOPPA.decode("iso-8859-1").encode("utf-8")
    server.files[sha(page)] = page
    run_one(server, scraper(), recipe_job(page=page, url="https://gammalsajt.example/recept.php?id=12"))

    (done,) = server.find("/done")
    assert done.body["recipe"]["title"] == "Ärtsoppa med fläsk"
    assert done.body["recipe"]["ingredients"][0] == "500 g gula ärtor"


@needs_scrapers
def test_microdata_is_read_too():
    recipe = scraper().read(PANNKAKOR, "https://mormorskok.example/recept/pannkakor")
    assert recipe.as_json() == {
        "title": "Pannkakor",
        "ingredients": ["3 dl vetemjöl", "6 dl mjölk", "3 ägg"],
        "steps": ["Vispa ihop mjöl och hälften av mjölken.", "Vispa i resten av mjölken och äggen."],
        "servings": 4,
        "minutes": 30,
        "image": "https://mormorskok.example/bilder/pannkakor.jpg",
        "description": None,
    }
    assert recipe.read_by == "schema.org"
    assert "description" in recipe.missing


@needs_scrapers
def test_a_site_recipe_scrapers_knows_is_read_by_its_own_scraper():
    recipe = scraper().read(KOTTBULLAR, "https://www.ica.se/recept/kottbullar-med-graddsas-123456/")
    assert recipe.read_by == "ica.se"
    assert recipe.as_json() == KOTTBULLAR_RECIPE

    # and a page there that isn't a recipe has none, whatever its og:title and og:image say
    with pytest.raises(NoRecipe):
        scraper().read(OM_OSS, "https://www.ica.se/artikel/om-oss/")


@needs_scrapers
def test_one_missing_field_doesnt_lose_the_others():
    page = """<html><head><script type="application/ld+json">{"@context": "https://schema.org", "@type": "Recipe",
      "name": "Smörgås", "recipeIngredient": ["1 skiva bröd", "smör"]}</script></head></html>"""
    recipe = scraper().read(page, URL)
    assert recipe.as_json() == {"title": "Smörgås", "ingredients": ["1 skiva bröd", "smör"], "steps": [], "servings": None, "minutes": None, "image": None, "description": None}
    assert {"servings", "minutes", "description"} <= set(recipe.missing)  # (no image is None, not an error)


@needs_scrapers
def test_an_xhtml_page_with_an_xml_declaration_is_read():
    page = ('<?xml version="1.0" encoding="ISO-8859-1"?>\n<!DOCTYPE html>\n' + KOTTBULLAR.split("\n", 1)[1].replace('<meta charset="utf-8">', "")).encode("iso-8859-1")
    html, encoding = decode_page(page, "text/html")
    assert encoding == "cp1252"
    assert scraper().read(html, URL).title == "Köttbullar med gräddsås"


@needs_scrapers
def test_reading_never_goes_out_on_the_network(monkeypatch: pytest.MonkeyPatch):
    def refuse(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError(f"the network was used: {args!r}")

    reader = scraper()
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    for page, url in ((KOTTBULLAR, URL), (KOTTBULLAR, "https://www.arla.se/recept/kottbullar/"), (PANNKAKOR, URL)):
        assert reader.read(page, url).title
    for page, url in ((OM_OSS, URL), (OM_OSS, "https://www.koket.se/om-oss")):
        with pytest.raises(NoRecipe):
            reader.read(page, url)


@needs_scrapers
def test_load_recipes_checks_that_it_reads():
    reader = cli.load_recipes()
    assert reader is not None
    assert reader.name.startswith("recipe-scrapers ") and reader.sites > 100


@needs_scrapers
def test_the_recipe_mode_prints_what_done_would_send(tmp_path, capsys: pytest.CaptureFixture[str]):
    path = tmp_path / "artsoppa.html"
    path.write_bytes(ARTSOPPA)
    assert cli.recipe_file(str(path), "https://gammalsajt.example/recept.php?id=12") == 0
    out = json.loads(capsys.readouterr().out)
    assert out["recipe"]["title"] == "Ärtsoppa med fläsk"
    assert out["recipe"]["servings"] == 4
    assert out["encoding"] == "cp1252" and out["read_by"] == "schema.org" and out["bytes"] == len(ARTSOPPA)

    path.write_text(OM_OSS)
    assert cli.recipe_file(str(path), URL) == 1


# ── what goes wrong (a fake reader) ──


def test_an_unexpected_error_while_reading_fails_with_retry(server: FakeNoterat):
    reader = FakeReader(error=RuntimeError("lxml fell over"))
    run_one(server, reader, recipe_job())

    (failed,) = server.find("/failed")
    assert failed.body == {"error": "the worker couldn't read the page (RuntimeError: lxml fell over)", "retry": True}
    assert reader.reads == [(KOTTBULLAR, URL)]


def test_a_file_that_isnt_a_page_fails_without_retry(server: FakeNoterat):
    png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10" + bytes(range(256)) * 4
    server.files[sha(png)] = png
    reader = FakeReader()
    run_one(server, reader, recipe_job(page=png))

    (failed,) = server.find("/failed")
    assert failed.body == {"error": "the page isn't text that can be read (it looks like another kind of file)", "retry": False}
    assert reader.reads == []


def test_the_page_is_handed_to_the_reader_decoded_with_its_url(server: FakeNoterat):
    reader = FakeReader(Recipe(title="  Ärtsoppa ", ingredients=["gula ärtor"], servings=4))
    run_one(server, reader, recipe_job(page=ARTSOPPA, url="https://gammalsajt.example/r"))

    (html, url), = reader.reads
    assert "Ärtsoppa med fläsk" in html and url == "https://gammalsajt.example/r"
    (done,) = server.find("/done")
    # (the reader tidies; what it gives is sent as it is)
    assert done.body == {"recipe": {"title": "  Ärtsoppa ", "ingredients": ["gula ärtor"], "steps": [], "servings": 4, "minutes": None, "image": None, "description": None}}


@pytest.mark.parametrize(
    ("job", "error"),
    [
        (recipe_job(url=None), "the job doesn't say which address the page is from"),
        (recipe_job(url="file:///etc/passwd"), "the job doesn't say which address the page is from"),
        ({"id": "recipe-1", "kind": "recipe", "files": [], "url": URL}, "the job names no page"),
        (recipe_job(page=b"<html>a page the server hasn't got</html>"), "the page isn't on the server"),
    ],
)
def test_a_job_that_cant_be_done_fails_without_retry(server: FakeNoterat, job: dict[str, Any], error: str):
    reader = FakeReader()
    run_one(server, reader, job)

    (failed,) = server.find("/failed")
    assert failed.body == {"error": error, "retry": False}
    assert reader.reads == []


def test_a_409_on_done_is_the_end_of_it(server: FakeNoterat):
    server.done_statuses = [409]
    run_one(server, FakeReader(), recipe_job(), recipe_job("recipe-2"))

    assert len(server.find("/recipe-1/done")) == 1  # not sent again
    assert len(server.find("/recipe-2/done")) == 1  # and the worker went on
    assert not server.find("/failed")


def test_a_worker_with_everything_asks_for_all_three(server: FakeNoterat):
    from test_ocr import FakeScanner
    from test_worker import FakeModel

    server.answers = [recipe_job()]
    running = Running(make_worker(server, FakeModel(), scanner=FakeScanner(), reader=FakeReader()))
    server.wait_for(lambda rs: any(r.path.endswith("/done") for r in rs))
    running.stop()
    assert server.requests[0].body["kinds"] == ["transcribe", "ocr", "recipe"]


# ── the kinds a worker does ──

ENV = {"NOTERAT_URL": "http://noterat:3000", "WORKER_TOKEN": "x" * 40}


def test_recipe_is_a_kind_and_one_of_the_default_ones():
    assert from_env(ENV).kinds == ("transcribe", "ocr", "recipe")
    assert from_env({**ENV, "WORKER_KINDS": "recipe"}).kinds == ("recipe",)
    assert from_env({**ENV, "WORKER_KINDS": "ocr, recipe"}).kinds == ("ocr", "recipe")


def test_a_recipe_only_worker_loads_neither_whisper_nor_ocr(monkeypatch: pytest.MonkeyPatch):
    def no(*args: Any) -> Any:
        raise AssertionError("loaded something a recipe worker doesn't need")

    reader = FakeReader()
    monkeypatch.setattr(cli, "load", no)
    monkeypatch.setattr(cli, "load_ocr", no)
    monkeypatch.setattr(cli, "load_recipes", lambda: reader)
    worker = cli.make_worker(from_env({**ENV, "WORKER_KINDS": "recipe"}), cli.Shutdown())
    assert worker is not None
    assert worker.kinds == ("recipe",)
    assert worker.reader is reader and worker.model is None and worker.scanner is None and worker.model_name is None


def test_without_recipe_scrapers_a_worker_goes_on_with_the_rest(monkeypatch: pytest.MonkeyPatch):
    from test_ocr import FakeScanner
    from test_worker import FakeModel

    # as if the recipe extra weren't installed
    monkeypatch.setitem(sys.modules, "recipe_scrapers", None)
    assert cli.load_recipes() is None

    monkeypatch.setattr(cli, "load", lambda config, shutdown: FakeModel())
    monkeypatch.setattr(cli, "load_ocr", lambda: FakeScanner())
    worker = cli.make_worker(from_env(ENV), cli.Shutdown())
    assert worker is not None and worker.kinds == ("transcribe", "ocr")
    assert worker.reader is None

    # and one that's only to read recipes has nothing left to do
    assert cli.make_worker(from_env({**ENV, "WORKER_KINDS": "recipe"}), cli.Shutdown()) is None


# ── the page's text ──


@pytest.mark.parametrize(
    ("data", "content_type", "text", "encoding"),
    [
        (b'<meta charset="utf-8"><p>K\xc3\xb6ttbullar</p>', None, "Köttbullar", "utf-8"),
        (b"<meta charset=iso-8859-1><p>K\xf6ttbullar \x80</p>", None, "Köttbullar €", "cp1252"),  # as browsers read it
        (b'<meta http-equiv="content-type" content="text/html; charset=windows-1252"><p>\xc4rter</p>', None, "Ärter", "cp1252"),
        (b"<p>K\xf6ttbullar</p>", "text/html; charset=ISO-8859-1", "Köttbullar", "cp1252"),  # the type wins over…
        (b'<meta charset="utf-8"><p>K\xf6ttbullar</p>', "text/html; charset=latin1", "Köttbullar", "cp1252"),  # …the page's <meta>
        (b"\xef\xbb\xbf<meta charset=iso-8859-1><p>K\xc3\xb6ttbullar</p>", None, "Köttbullar", "utf-8"),  # the BOM wins over both
        (b"\xff\xfe" + "<p>Köttbullar</p>".encode("utf-16-le"), None, "Köttbullar", "utf-16-le"),
        # what the server keeps: the page as UTF-8, its <meta> still saying what it was fetched in
        (b"<meta charset=iso-8859-1><p>K\xc3\xb6ttbullar</p>", "text/html", "Köttbullar", "utf-8"),
        (b"<meta charset=iso-8859-1><p>Kottbullar</p>", "text/html", "Kottbullar", "cp1252"),  # (all ASCII: either)
        (b"<p>K\xc3\xb6ttbullar</p>", None, "Köttbullar", "utf-8"),  # nothing said: UTF-8
        (b"<p>K\xf6ttbullar</p>", None, "K\ufffdttbullar", "utf-8"),  # …with what isn't replaced
        (b"<meta charset=klingon><p>K\xc3\xb6ttbullar</p>", None, "Köttbullar", "utf-8"),  # a charset nobody knows
        (b"<meta charset=base64><p>K\xc3\xb6ttbullar</p>", None, "Köttbullar", "utf-8"),  # nor Python's non-text codecs
        (b"<meta charset=utf-16><p>K\xc3\xb6ttbullar</p>", None, "Köttbullar", "utf-8"),  # readable as ASCII: not UTF-16
    ],
)
def test_the_page_is_decoded_as_it_says(data: bytes, content_type: str | None, text: str, encoding: str):
    html, used = decode_page(data, content_type)
    assert text in html
    assert used == encoding


@pytest.mark.parametrize("data", [b"", b"   \n ", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + bytes(200), b"\x1f\x8b\x08\x00" + bytes(range(256))])
def test_what_isnt_a_page_is_undecodable(data: bytes):
    with pytest.raises(UndecodablePage):
        decode_page(data, "text/html")


def test_an_xml_declaration_is_taken_off():
    html, encoding = decode_page(b'<?xml version="1.0" encoding="iso-8859-1"?>\n<html><p>\xc4rter</p></html>')
    assert encoding == "cp1252"
    assert html == "\n<html><p>Ärter</p></html>"


# ── tidying ──


@pytest.mark.parametrize(
    ("value", "servings"),
    [
        ("4 portioner", 4),
        ("4 servings", 4),
        ("4-6 portioner", 4),
        ("4–6 portioner", 4),
        (4, 4),
        (4.0, 4),
        (["4", "4 portioner"], 4),
        (["några", "6 st"], 6),
        ("Ca 1,5 liter", 1.5),
        ("", None),
        ("några", None),
        ("0 portioner", None),
        (None, None),
        (True, None),
        ("99999 portioner", None),
    ],
)
def test_servings_are_the_first_number(value: Any, servings: Any):
    assert servings_of(value) == servings


def test_lines_are_trimmed_capped_and_the_empty_ones_left_out():
    assert line("  1 dl\n  ströbröd\u00a0 \u200b") == "1 dl ströbröd"
    assert line(None) == "" and line(["a"]) == ""
    assert lines([" a ", "", None, "  ", "b\n c"]) == ["a", "b c"]
    assert lines("en enda rad") == ["en enda rad"]
    assert len(lines([f"{i} g smör" for i in range(300)])) == 200

    long_line = lines(["ord " * 200])[0]
    assert len(long_line) <= 500 and long_line.endswith("ord…")
    assert clip("x" * 600, 500) == "x" * 499 + "…"
    assert clip("kort", 500) == "kort"


def test_a_long_step_is_split_between_its_sentences():
    method = " ".join(f"Steg {i}: gör något med smöret och mjölet i ungefär tio minuter till." for i in range(20))
    parts = steps([method, "", "Servera."])
    assert len(parts) > 2 and all(len(p) <= 500 for p in parts)
    assert " ".join(parts[:-1]) == method  # nothing lost
    assert parts[-1] == "Servera."
    assert len(steps([f"Steg {i}." for i in range(300)])) == 200

    # one sentence longer than a line is cut there
    (cut,) = steps(["och " * 200])
    assert len(cut) <= 500 and cut.endswith("…")


def test_minutes_and_the_image():
    assert minutes_of(45) == 45 and minutes_of(44.6) == 45
    assert minutes_of(0) is None and minutes_of(None) is None and minutes_of("45") is None and minutes_of(10**7) is None
    page = "https://mormorskok.example/recept/kottbullar"
    assert image_of("https://cdn.example/a.jpg", page) == "https://cdn.example/a.jpg"
    assert image_of("/bilder/a b.jpg", page) == "https://mormorskok.example/bilder/a%20b.jpg"
    assert image_of("//cdn.example/a.jpg", page) == "https://cdn.example/a.jpg"
    assert image_of("data:image/png;base64,AAAA", page) is None
    assert image_of("javascript:alert(1)", page) is None
    assert image_of("https://cdn.example/" + "a" * 3000, page) is None
    assert image_of("", page) is None and image_of(None, page) is None


def test_no_title_and_no_ingredients_is_no_recipe():
    assert not Recipe(steps=["Gör så här."], image="https://x.example/a.jpg").found()
    assert Recipe(title="Pannkakor").found()
    assert Recipe(ingredients=["3 ägg"]).found()
