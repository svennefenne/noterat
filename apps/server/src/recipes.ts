import type { Hono } from "hono";
import { cleanUrl, putImportedRecipe, readRecipe, readSchemaRecipe, setImportState, type ImportedRecipe, type PhotoChoice } from "@noterat/core";
import type { DB } from "./db";
import { decodePage, fetchPublic, FetchFailed, type Fetched, type FetchOptions } from "./fetch";
import { keepFile, type FileStore } from "./files";
import { Fail, signedIn, type Env } from "./http";
import type { Jobs } from "./jobs";
import { objectRow, roleOf } from "./objects";
import type { Sync } from "./sync";

/**
 * Importing a recipe from its page (decision 9). The server fetches the page itself (only from the
 * internet: fetch.ts) and reads its schema.org Recipe; without one, the page goes to the worker as a
 * file for recipe-scrapers (or, without one there either, its headings). Either way the recipe goes
 * into its document, with its photo, fetched the same careful way, and nothing someone already wrote
 * is overwritten. When the worker isn't sure which of the page's pictures is the recipe's, they're
 * all fetched, for the app to offer to choose from.
 */

export type FetchPage = (url: string, o?: FetchOptions) => Promise<Fetched>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strings = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
/** How many of a page's pictures are offered, and the least a picture's file can be (less is an icon). */
const MAX_CHOICES = 12;
const MIN_CHOICE_BYTES = 2048;
const imageUrls = (v: unknown) => [...new Set(strings(v).filter((u) => /^https?:\/\//i.test(u) && u.length <= 2000))].slice(0, MAX_CHOICES);

export function recipeImport(o: { db: DB; sync: Sync; store: FileStore; fetchPage?: FetchPage }) {
  const { db, sync, store } = o;
  const fetchPage = o.fetchPage ?? fetchPublic;

  /** The recipe's photo from its page, kept as a file of the recipe's (none if it can't be had). */
  async function photoFrom(url: string, objectId: string, minBytes = 0): Promise<PhotoChoice | undefined> {
    try {
      const f = await fetchPage(url, { maxBytes: 10 * 1024 * 1024, accept: "image/*" });
      const type = f.type.split(";")[0]!.trim();
      if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type) || f.body.length < minBytes) return undefined;
      const kept = keepFile(db, store, new Uint8Array(f.body), type, objectId);
      return { hash: kept.hash, type: kept.type, size: kept.size, width: 0, height: 0 };
    } catch {
      return undefined;
    }
  }

  /** The page's pictures, four at a time, in their order: the ones that could be had, each once. */
  async function choicesFrom(urls: string[], objectId: string) {
    const got: (PhotoChoice | undefined)[] = new Array(urls.length);
    let next = 0;
    const one = async () => {
      for (let i = next++; i < urls.length; i = next++) got[i] = await photoFrom(urls[i]!, objectId, MIN_CHOICE_BYTES);
    };
    await Promise.all([one(), one(), one(), one()]);
    const byUrl = new Map(urls.map((u, i) => [u, got[i]]));
    const choices = [...new Map(got.filter((p) => p !== undefined).map((p) => [p.hash, p])).values()];
    return { byUrl, choices };
  }

  /** What was found, into the recipe: with its photo, or the pictures to choose from and the likeliest. */
  async function put(objectId: string, found: ImportedRecipe) {
    let photo: PhotoChoice | undefined;
    let choices: PhotoChoice[] = [];
    if (found.images && found.images.length > 1) {
      const got = await choicesFrom(found.images, objectId);
      choices = got.choices;
      photo = (found.image ? got.byUrl.get(found.image) : undefined) ?? choices[0];
    } else if (found.image) photo = await photoFrom(found.image, objectId);
    await sync.changeObject("recipe", objectId, (d) => putImportedRecipe(d, found, photo, choices));
  }

  return {
    /** What the worker read with recipe-scrapers (jobs.ts hands it on). */
    async fromWorker(objectId: string, r: Record<string, unknown>) {
      await put(objectId, {
        title: str(r.title) || undefined,
        ingredients: strings(r.ingredients),
        steps: strings(r.steps),
        servings: num(r.servings),
        minutes: num(r.minutes),
        description: str(r.description) || null,
        image: str(r.image) || null,
        images: imageUrls(r.images),
        guessed: r.guessed === true,
      });
    },

    routes(app: Hono<Env>, jobs: Jobs) {
      const auth = signedIn(db);

      /** Import (again) from the recipe's source: its owner or an editor. */
      app.post("/api/objects/:id/import", auth, async (c) => {
        const obj = objectRow(db, c.req.param("id"));
        if (!obj) throw new Fail("not_synced", 404);
        if (obj.deleted_at) throw new Fail("not_found", 404);
        const role = roleOf(db, obj.id, c.get("user").id);
        if (!role || role === "viewer") throw new Fail("forbidden", 403);
        if (obj.type !== "recipe") throw new Fail("wrong_type", 400);
        const source = cleanUrl(await sync.readObject("recipe", obj.id, (d) => readRecipe(d).source));
        if (!source) throw new Fail("bad_request", 400);
        const state = (t: Parameters<typeof setImportState>[1]) => sync.changeObject("recipe", obj.id, (d) => setImportState(d, t));

        await state({ status: "working", at: Date.now() });
        let page: Fetched;
        try {
          page = await fetchPage(source);
        } catch (err) {
          const notPublic = err instanceof FetchFailed && err.reason === "not_public";
          await state({ status: "failed", error: err instanceof Error ? err.message : "the page couldn't be fetched", at: Date.now() });
          throw new Fail(notPublic ? "not_public" : "fetch_failed", notPublic ? 400 : 502);
        }
        const html = decodePage(page);
        const found = readSchemaRecipe(html, page.url);
        if (found) {
          await put(obj.id, found);
          return c.json({ from: "page" });
        }
        if (jobs.hasWorker()) {
          // (the page's own bytes, so its <meta charset> still tells the truth about them)
          const file = keepFile(db, store, new Uint8Array(page.body), "text/html", obj.id);
          await jobs.enqueueRecipe(obj.id, file.hash, page.url);
          return c.json({ from: "worker" }, 202);
        }
        await state({ status: "failed", error: "no recipe was found on the page", at: Date.now() });
        throw new Fail("no_recipe", 422);
      });
    },
  };
}
