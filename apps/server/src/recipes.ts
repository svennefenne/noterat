import type { Hono } from "hono";
import { cleanUrl, putImportedRecipe, readRecipe, readSchemaRecipe, setImportState, type ImportedRecipe } from "@noterat/core";
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
 * file for recipe-scrapers. Either way the recipe goes into its document, with its photo, fetched the
 * same careful way, and nothing someone already wrote is overwritten.
 */

export type FetchPage = (url: string, o?: FetchOptions) => Promise<Fetched>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strings = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export function recipeImport(o: { db: DB; sync: Sync; store: FileStore; fetchPage?: FetchPage }) {
  const { db, sync, store } = o;
  const fetchPage = o.fetchPage ?? fetchPublic;

  /** The recipe's photo from its page, kept as a file of the recipe's (none if it can't be had). */
  async function photoFrom(url: string, objectId: string) {
    try {
      const f = await fetchPage(url, { maxBytes: 10 * 1024 * 1024, accept: "image/*" });
      const type = f.type.split(";")[0]!.trim();
      if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) return undefined;
      const kept = keepFile(db, store, new Uint8Array(f.body), type, objectId);
      return { hash: kept.hash, type: kept.type, size: kept.size, width: 0, height: 0 };
    } catch {
      return undefined;
    }
  }

  /** What was found, into the recipe. */
  async function put(objectId: string, found: ImportedRecipe) {
    const photo = found.image ? await photoFrom(found.image, objectId) : undefined;
    await sync.changeObject("recipe", objectId, (d) => putImportedRecipe(d, found, photo));
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
