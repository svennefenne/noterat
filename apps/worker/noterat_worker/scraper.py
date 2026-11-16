"""Reading recipes with recipe-scrapers: its own scraper for a site it knows (arla.se, ica.se, koket.se
and some 600 others), else its reading of the page's schema.org Recipe, as JSON-LD or microdata;
and a page with neither read by its headings (headings.py), as a guess.

Only the page the server fetched is read: recipe-scrapers is handed the HTML and the address it came
from (which says which site it is), and never asked to fetch anything (its online mode stays off).
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from .headings import read_by_headings
from .recipe import DESCRIPTION_LIMIT, TITLE_LIMIT, NoRecipe, Recipe, image_of, line, lines, minutes_of, servings_of, steps

log = logging.getLogger("noterat_worker")

# What warm_up reads: a recipe as small as can be, so a broken install shows at start, not in the first job.
_CHECK_PAGE = """<!doctype html><html lang="sv"><head><script type="application/ld+json">
{"@context": "https://schema.org", "@type": "Recipe", "name": "Smörgås",
 "recipeIngredient": ["1 skiva bröd", "smör"], "recipeInstructions": "Bred smör på brödet."}
</script></head><body></body></html>"""


class RecipesUnavailable(Exception):
    """recipe-scrapers is installed but doesn't read recipes; the message says what came out."""


class Scraper:
    def __init__(self) -> None:
        """Raises ImportError when recipe-scrapers isn't installed."""
        import recipe_scrapers
        from recipe_scrapers.__version__ import __version__

        self.version = __version__
        self.name = f"recipe-scrapers {self.version}"
        self.sites = len(recipe_scrapers.SCRAPERS)

    def warm_up(self) -> None:
        try:
            recipe = self.read(_CHECK_PAGE, "https://noterat.invalid/check")
        except Exception as e:
            raise RecipesUnavailable(f"{self.name} couldn't read a test recipe ({type(e).__name__}: {e})") from e
        if recipe.title != "Smörgås" or recipe.ingredients != ["1 skiva bröd", "smör"]:
            raise RecipesUnavailable(f"{self.name} read a test recipe wrong ({recipe.as_json()})")

    # ── recipe.RecipeReader ──

    def read(self, html: str, url: str) -> Recipe:
        from recipe_scrapers import NoSchemaFoundInWildMode, scrape_html

        try:
            # supported_only=False: a site it has no scraper of its own for is read by its schema.org
            # data; a page with none raises NoSchemaFoundInWildMode
            scraper = scrape_html(html, org_url=url, supported_only=False)
        except NoSchemaFoundInWildMode:
            return self._by_headings(html, url)

        # Each field on its own: recipe-scrapers raises for one the page hasn't got (and a site's own
        # scraper may trip over a page laid out differently), and that mustn't lose the others.
        missing: dict[str, str] = {}

        def get(name: str, method: Callable[[], Any]) -> Any:
            try:
                return method()
            except Exception as e:
                missing[name] = type(e).__name__
                return None

        schema = getattr(getattr(scraper, "schema", None), "data", None) or {}
        site = type(scraper).__name__ != "SchemaScraper"
        recipe = Recipe(
            title=line(get("title", scraper.title), TITLE_LIMIT) or None,
            ingredients=lines(get("ingredients", scraper.ingredients)),
            steps=steps(get("steps", scraper.instructions_list)),
            # The page's own words first: yields() makes "4-6 portioner" "6 servings", and the smaller
            # number is the one to scale from. Its yields() when the schema.org data has none.
            servings=servings_of(schema.get("recipeYield") or schema.get("yield")) or servings_of(get("servings", scraper.yields)),
            minutes=minutes_of(get("minutes", scraper.total_time)),
            image=image_of(get("image", scraper.image), url),
            description=line(get("description", scraper.description), DESCRIPTION_LIMIT) or None,
            read_by=_host(scraper) if site else "schema.org",
            missing=missing,
        )
        if not recipe.found():
            return self._by_headings(html, url)
        return recipe

    @staticmethod
    def _by_headings(html: str, url: str) -> Recipe:
        recipe = read_by_headings(html, url)
        if recipe is None:
            raise NoRecipe("no recipe was found on the page")
        return recipe


def _host(scraper: Any) -> str:
    try:
        return str(scraper.host())
    except Exception:
        return type(scraper).__name__
