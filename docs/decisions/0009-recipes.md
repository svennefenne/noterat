# 9. Recipes: imported by the server, scaled on the device

Date: 2026-11-15 · Status: accepted (phase 5)

## Context

Phase 5 brings recipes: imported from a web page, written by hand, with photos, scaled to more or fewer
servings, put on the shopping list, shared live, and exported as a PDF.

## Decision

- **A recipe is a document**, `recipe/<id>`: `meta` (title, source URL, servings, time, createdBy,
  createdAt), `ingredients` (a `Y.Text`, one ingredient per line, so people edit it together as text),
  `steps` (a `Y.Text` of Markdown), `tags` and `photos` (files by hash, as a journal entry's), and `import`
  (how an import from its source is coming along, as a memo's transcription).
- **Importing is the server's job**, not the device's: a web page can't be fetched across origins from the
  app. The app makes the recipe with its source URL and asks the server (`POST /api/objects/:id/import`).
  The server fetches the page itself, **only from public addresses** (every address a name resolves to is
  checked, redirects too, so a link can't reach the home network), at most 5 MB in 15 s, and reads its
  schema.org `Recipe` (JSON-LD). Without one, the page goes to the worker as a file, and the worker reads it
  with **recipe-scrapers** (a job of the kind `recipe`; the worker never fetches anything itself). Either way
  the server writes the recipe into the document and fetches its photo the same careful way.
- **A page with no recipe a program can see** (a blog post with no schema.org data, on a site
  recipe-scrapers doesn't know) is read by its headings, in the worker: the list under a heading such as
  "Ingredienser" or "Ingredients", and the one under "Gör så här" or "Instructions". It's a guess, and the
  recipe says so (`meta.guessed`) until someone has looked it over. Which of such a page's pictures is the
  recipe's is a guess too, so the worker sends them all (up to 12, no logos, icons or pictures beside the
  post); the server fetches them the same careful way, keeps them as the recipe's files, puts the likeliest
  among its photos and the rest in `photoChoices`, and the app offers them as thumbnails to choose from.
  When the choosing's done, the choices and the guess go (the files stay, as any removed photo's do).
- **A site that keeps programs out** (one behind Cloudflare's wall against bots answers 403 with
  `cf-mitigated: challenge`; others 401 or 429) isn't worked around: the server doesn't pretend to be a
  browser. The import says why it failed (`reason`: blocked, not_public or no_recipe, the last also when
  the worker gives up on a page for good), and the app says it plainly and offers **pasting the recipe**
  instead: copied on the page, in the person's own browser, a selection or the whole page. Core's
  `recipeText.ts` reads it on the device, the way the worker reads a page by its headings: the part
  under an ingredients heading that looks most like a list of them (not a blog's "what you'll need" in
  prose, nor a carousel of other recipes), the steps under a method heading, and the title (the line the
  link names, else the one that talks about what's in the recipe), servings and time. Scale buttons,
  ratings, ads, a photo credit after each step, notes, questions and reviews are left out, and a note on
  a line of its own ("2 carrots" / "finely chopped") is joined to its ingredient. What's pasted takes the
  place of the ingredients and steps, and the import is done with.
- **Scaling happens on the device**: core's `ingredients.ts` reads a line's amount ("1 1/2 dl", "½ tsk",
  "2–3", "1,5 kg") and writes it scaled, in Swedish ("3 dl", "¾ tsk"); a line without an amount stays.
- **American measures are converted on the device, when asked**: core's `units.ts` turns cups, ounces,
  pounds, tablespoons, teaspoons, sticks of butter, °F and inches into dl, msk, tsk, g, kg, l, °C and cm,
  rounded as a cook would (a cup is 2,4 dl), and keeps a metric measure the recipe gives beside the other.
  It's only shown, in the ingredients, the method, the PDF and the shopping list; the recipe keeps its own
  words. The app offers it on a recipe that uses such measures, and remembers the choice on the device.
- **To the shopping list**: the scaled lines, as rows in a list picked (core's `addTextRows`).
- **The PDF is made on the device** (pdf-lib), offline too, and saved or shared: a download on the web,
  the phone's share sheet in the app (`@capacitor/filesystem` and `@capacitor/share`), which also gives a
  scan's PDF a way out of the app.

## Consequences

- Recipes from most Swedish sites (they publish schema.org data) import at once; others wait for the
  worker, and without a worker they say so. A page the worker can only guess at imports too, marked as a
  guess; a page with no list under an ingredients heading still has no recipe. A site that won't let
  the server in, or a page it can't read, takes a copy and a paste; whether a site lets the server in
  can differ from one machine to another, as Cloudflare judges each client for itself.
- A guessed import fetches up to 12 pictures, and the ones not chosen stay on the server as the recipe's
  files.
- The server makes outgoing requests for the first time; the address check keeps them to the internet.
