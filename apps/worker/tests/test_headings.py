"""A page with no recipe a program can see, read by its headings (headings.py)."""

from __future__ import annotations

import importlib.util

import pytest

from noterat_worker.recipe import NoRecipe

pytestmark = pytest.mark.skipif(importlib.util.find_spec("recipe_scrapers") is None, reason="recipe-scrapers isn't installed")

URL = "https://matbloggen.example/2026/11/kottfarssas/"

# A blog post as people write them: headings in bold paragraphs, the sauce's own part, a list of tips
# after the ingredients, and a menu, related posts and a logo around it all.
KOTTFARSSAS = """<!doctype html><html lang="sv"><head><meta charset="utf-8">
<title>Köttfärssås som mormor gjorde | Matbloggen</title>
<meta property="og:site_name" content="Matbloggen">
<meta property="og:image" content="https://matbloggen.example/bilder/kottfarssas-1200.jpg">
<meta name="description" content="En köttfärssås att längta efter.">
<script type="application/ld+json">{"@context": "https://schema.org", "@type": "BlogPosting", "headline": "Köttfärssås"}</script>
</head><body>
<header class="site-header"><img class="custom-logo" src="/bilder/logo.png" width="300" height="80"><nav><ul><li>Hem</li><li>Recept</li></ul></nav></header>
<main><article class="post">
<h1>Köttfärssås som mormor gjorde</h1>
<figure><img src="/bilder/kottfarssas-600.jpg" srcset="/bilder/kottfarssas-600.jpg 600w, /bilder/kottfarssas-1200.jpg 1200w, /bilder/kottfarssas-4000.jpg 4000w" width="600" height="400"></figure>
<p>Den här såsen räcker till 4 portioner, och lite till.</p>
<p><strong>Ingredienser</strong></p>
<ul><li>500 g nötfärs</li><li>1 gul lök</li><li>1 burk krossade tomater</li></ul>
<p>Till såsen:</p>
<ul><li>2 dl grädde</li><li>1 msk soja</li></ul>
<p><strong>Tips</strong></p>
<ul><li>Byt nötfärs mot linser.</li></ul>
<h2>Gör så här</h2>
<p>Så här gör du:</p>
<ol><li>Hacka löken.</li><li>Bryn färsen med löken.</li><li>Häll i tomaterna och låt puttra i 30 minuter.</li></ol>
<img src="/bilder/steg-2.jpg" width="800" height="600">
<img src="/bilder/pil.png" width="24" height="24">
<div class="share-buttons"><img src="/bilder/dela-facebook.jpg"></div>
</article>
<section class="related-posts"><h2>Fler recept</h2><img src="/bilder/lasagne.jpg"><ul><li>Lasagne</li><li>Pannbiff</li></ul></section>
</main></body></html>
"""


def read(html: str, url: str = URL):
    from noterat_worker.scraper import Scraper

    return Scraper().read(html, url)


def test_a_blog_post_is_read_by_its_headings():
    recipe = read(KOTTFARSSAS)
    assert recipe.read_by == "headings" and recipe.guessed
    assert recipe.title == "Köttfärssås som mormor gjorde"
    # its own part ("Till såsen:") is the recipe's; the tips after it aren't
    assert recipe.ingredients == ["500 g nötfärs", "1 gul lök", "1 burk krossade tomater", "Till såsen:", "2 dl grädde", "1 msk soja"]
    # the numbered list, not the introduction ending in a colon
    assert recipe.steps == ["Hacka löken.", "Bryn färsen med löken.", "Häll i tomaterna och låt puttra i 30 minuter."]
    assert recipe.servings == 4
    assert recipe.description == "En köttfärssås att längta efter."


def test_the_pictures_to_choose_from_are_the_posts_own():
    recipe = read(KOTTFARSSAS)
    # og:image first; the srcset's largest that's no more than 2000 px wide (the same picture); no
    # logo, no tiny arrow, nothing in the sharing buttons or the related posts
    assert recipe.image == "https://matbloggen.example/bilder/kottfarssas-1200.jpg"
    assert recipe.images == ["https://matbloggen.example/bilder/kottfarssas-1200.jpg", "https://matbloggen.example/bilder/steg-2.jpg"]
    sent = recipe.as_json()
    assert sent["images"] == recipe.images and sent["guessed"] is True


def test_a_single_picture_isnt_a_choice():
    page = KOTTFARSSAS.replace('<img src="/bilder/steg-2.jpg" width="800" height="600">', "")
    recipe = read(page)
    assert recipe.images == ["https://matbloggen.example/bilder/kottfarssas-1200.jpg"]
    assert "images" not in recipe.as_json() and recipe.as_json()["image"] == recipe.images[0]


def test_an_english_post_with_the_method_after_a_heading_without_a_list():
    page = """<html><head><title>Cowboy Soup - Recipe Box</title></head><body><article>
    <h1>Cowboy Soup</h1><h2>Ingredients</h2><p>Key ingredients include:</p>
    <ul><li>1 pound ground beef</li><li>4 cups beef broth</li></ul><p>Possible substitutions:</p><ul><li>Ground turkey</li></ul>
    <h2>Preparation Steps</h2><p>Chop the onion and the bell pepper into evenly sized pieces before you start.</p>
    <h2>Cooking Instructions</h2><ol><li>Brown the beef.</li><li>Add the broth and simmer.</li></ol>
    <h2>Serving Suggestions</h2><ul><li>Cornbread</li></ul></article></body></html>"""
    recipe = read(page, "https://recipebox.example/cowboy-soup/")
    assert recipe.ingredients == ["1 pound ground beef", "4 cups beef broth"]
    assert recipe.steps == ["Brown the beef.", "Add the broth and simmer."]


def test_a_method_in_paragraphs():
    page = """<html><body><h1>Gröt</h1><h3>Du behöver</h3><ul><li>1 dl havregryn</li><li>2 dl vatten</li></ul>
    <h3>Gör så här</h3><p>Koka upp vatten och gryn under omrörning.</p><p>Låt koka i tre minuter och servera med mjölk.</p></body></html>"""
    recipe = read(page)
    assert recipe.title == "Gröt"
    assert recipe.steps == ["Koka upp vatten och gryn under omrörning.", "Låt koka i tre minuter och servera med mjölk."]
    assert recipe.images == [] and recipe.image is None


@pytest.mark.parametrize(
    "body",
    [
        "<h1>Om oss</h1><p>Vi lagar mat.</p>",
        # a heading about ingredients, but no list under it
        "<h1>Vår filosofi</h1><h2>Ingredienserna</h2><p>Vi väljer dem med omsorg.</p><h2>Kontakt</h2><ul><li>a</li><li>b</li></ul>",
        # one line is no list of ingredients
        "<h1>Salt</h1><h2>Ingredienser</h2><ul><li>salt</li></ul>",
    ],
)
def test_a_page_without_ingredients_under_a_heading_has_no_recipe(body: str):
    with pytest.raises(NoRecipe):
        read(f"<html><head><title>Sida</title></head><body>{body}</body></html>")


def test_a_recipe_read_from_its_schema_org_data_is_no_guess():
    page = """<html><head><script type="application/ld+json">{"@context": "https://schema.org", "@type": "Recipe",
      "name": "Smörgås", "recipeIngredient": ["1 skiva bröd", "smör"]}</script></head>
      <body><h2>Ingredienser</h2><ul><li>annat</li><li>helt annat</li></ul></body></html>"""
    recipe = read(page)
    assert recipe.read_by == "schema.org" and not recipe.guessed
    assert recipe.ingredients == ["1 skiva bröd", "smör"]
    assert "guessed" not in recipe.as_json() and "images" not in recipe.as_json()
