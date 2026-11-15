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
- **Scaling happens on the device**: core's `ingredients.ts` reads a line's amount ("1 1/2 dl", "½ tsk",
  "2–3", "1,5 kg") and writes it scaled, in Swedish ("3 dl", "¾ tsk"); a line without an amount stays.
- **To the shopping list**: the scaled lines, as rows in a list picked (core's `addTextRows`).
- **The PDF is made on the device** (pdf-lib), offline too, and saved or shared: a download on the web,
  the phone's share sheet in the app (`@capacitor/filesystem` and `@capacitor/share`), which also gives a
  scan's PDF a way out of the app.

## Consequences

- Recipes from most Swedish sites (they publish schema.org data) import at once; others wait for the
  worker, and without a worker they say so.
- The server makes outgoing requests for the first time; the address check keeps them to the internet.
