import { describe, expect, it } from "vitest";
import { initRecipe, newObjectId, objectDocName, readRecipe, recipeIngredients, recipeSteps, type WorkerJob } from "@noterat/core";
import { FetchFailed, fetchPublic, isPublicAddress, type Fetched } from "../src/fetch";
import { account, call, device, sha, startServer, synced, until, worker, WORKER } from "./helpers";

/**
 * Importing recipes (decision 9): the server reads a page's schema.org recipe itself, hands a page
 * without one to the worker, and never fetches anything but the internet. Pages here come from a fake
 * fetcher; the real one is tested on its address checks.
 */

const PAGE = `<html><head><meta charset="utf-8"><script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe","name":"Pannkakor","recipeYield":"4 portioner","totalTime":"PT30M",
"image":"https://bilder.example.se/pannkakor.jpg","recipeIngredient":["3 ägg","6 dl mjölk","2 1/2 dl vetemjöl"],
"recipeInstructions":["Vispa ägg och mjölk.","Stek tunna pannkakor."]}</script></head><body>Pannkakor</body></html>`;
const PLAIN = `<html><head><title>Mormors bullar</title></head><body><h1>Mormors bullar</h1><ul><li>5 dl mjöl</li></ul></body></html>`;
const PHOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
// (pictures big enough to be offered; a tiny one is an icon)
const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, n)]);
const image = (url: string, body: Buffer): [string, Fetched] => [url, { url, type: "image/jpeg", body }];

const pages: Record<string, Fetched> = {
  "https://recept.example.se/pannkakor": { url: "https://recept.example.se/pannkakor", type: "text/html; charset=utf-8", body: Buffer.from(PAGE) },
  "https://bilder.example.se/pannkakor.jpg": { url: "https://bilder.example.se/pannkakor.jpg", type: "image/jpeg", body: PHOTO },
  "https://blogg.example.se/bullar": { url: "https://blogg.example.se/bullar", type: "text/html", body: Buffer.from(PLAIN) },
  ...Object.fromEntries([
    image("https://blogg.example.se/bullar-stor.jpg", jpeg(1)),
    image("https://blogg.example.se/bullar-deg.jpg", jpeg(2)),
    image("https://cdn.example.se/samma-som-stor.jpg", jpeg(1)),
    image("https://blogg.example.se/ikon.jpg", PHOTO),
  ]),
};
const fakeFetch = async (url: string) => {
  if (url.startsWith("http://192.168.")) throw new FetchFailed("that address isn't on the internet", "not_public");
  if (url.startsWith("https://murad.example.com/")) throw new FetchFailed("the page answered 403", "blocked");
  const p = pages[url];
  if (!p) throw new FetchFailed("the page answered 404");
  return p;
};

async function recipeFrom(source: string, o: { workerToken?: string } = {}) {
  const { db, base } = await startServer({ fetchPage: fakeFetch, workerToken: o.workerToken });
  const ada = await account(db, "ada");
  const id = newObjectId();
  const r = device(base, ada.token)(objectDocName("recipe", id));
  initRecipe(r.doc, { source, by: ada.user.id, importing: true });
  await synced(r.provider);
  return { base, ada, id, r };
}

describe("importing a recipe", () => {
  it("reads the page's schema.org recipe, with its photo", async () => {
    const { base, ada, id, r } = await recipeFrom("https://recept.example.se/pannkakor");
    const res = await call<{ from: string }>(base, "POST", `/api/objects/${id}/import`, ada.token);
    expect(res).toMatchObject({ status: 200, json: { from: "page" } });
    await until(() => readRecipe(r.doc).import?.status === "done", "the recipe to be imported");
    expect(readRecipe(r.doc)).toMatchObject({ title: "Pannkakor", servings: 4, minutes: 30 });
    expect(recipeIngredients(r.doc).toString()).toBe("3 ägg\n6 dl mjölk\n2 1/2 dl vetemjöl");
    expect(recipeSteps(r.doc).toString()).toBe("1. Vispa ägg och mjölk.\n2. Stek tunna pannkakor.");
    const photo = readRecipe(r.doc).photos[0]!;
    expect(photo.hash).toBe(sha(new Uint8Array(PHOTO)));
    expect((await fetch(`${base}/api/files/${photo.hash}`, { headers: { Authorization: `Bearer ${ada.token}` } })).status).toBe(200);
  });

  it("hands a page without one to the worker, which reads it with recipe-scrapers", async () => {
    const { base, ada, id, r } = await recipeFrom("https://blogg.example.se/bullar", { workerToken: WORKER });
    expect((await call<{ from: string }>(base, "POST", `/api/objects/${id}/import`, ada.token)).json).toEqual({ from: "worker" });
    await until(() => readRecipe(r.doc).import?.status === "queued", "the import to be queued");
    // (a worker that doesn't do recipes doesn't get it)
    expect((await worker(base, "/next", { worker: "w", kinds: ["transcribe", "ocr"] })).status).toBe(204);
    const job = ((await (await worker(base, "/next", { worker: "w", kinds: ["recipe"] })).json()) as { job: Extract<WorkerJob, { kind: "recipe" }> }).job;
    expect(job).toMatchObject({ kind: "recipe", url: "https://blogg.example.se/bullar" });
    expect(await (await worker(base, `/files/${job.files[0]!.hash}`)).text()).toBe(PLAIN);
    await worker(base, `/jobs/${job.id}/done`, { recipe: { title: "Mormors bullar", ingredients: ["5 dl mjöl"], steps: ["Baka."], servings: 30, minutes: null, image: null } });
    await until(() => readRecipe(r.doc).import?.status === "done", "the recipe to be read");
    expect(readRecipe(r.doc)).toMatchObject({ title: "Mormors bullar", servings: 30 });
    expect(recipeIngredients(r.doc).toString()).toBe("5 dl mjöl");
  });

  it("offers the page's pictures to choose from when the worker guessed, the likeliest already chosen", async () => {
    const { base, ada, id, r } = await recipeFrom("https://blogg.example.se/bullar", { workerToken: WORKER });
    await call(base, "POST", `/api/objects/${id}/import`, ada.token);
    const job = ((await (await worker(base, "/next", { worker: "w", kinds: ["recipe"] })).json()) as { job: { id: string } }).job;
    const images = ["https://blogg.example.se/bullar-stor.jpg", "https://blogg.example.se/ikon.jpg", "https://blogg.example.se/finns-inte.jpg", "https://blogg.example.se/bullar-deg.jpg", "https://cdn.example.se/samma-som-stor.jpg", "file:///etc/passwd"];
    await worker(base, `/jobs/${job.id}/done`, { recipe: { title: "Mormors bullar", ingredients: ["5 dl mjöl", "2 dl mjölk"], steps: [], image: images[0], images, guessed: true } });
    await until(() => readRecipe(r.doc).import?.status === "done", "the recipe to be read");
    const recipe = readRecipe(r.doc);
    expect(recipe.guessed).toBe(true);
    // the two pictures there are (the icon too small, one not found, one the same as another, one not on the web)
    expect(recipe.photoChoices.map((p) => p.hash)).toEqual([sha(new Uint8Array(jpeg(1))), sha(new Uint8Array(jpeg(2)))]);
    expect(recipe.photos.map((p) => p.hash)).toEqual([sha(new Uint8Array(jpeg(1)))]);
    const other = recipe.photoChoices[1]!.hash;
    expect((await fetch(`${base}/api/files/${other}`, { headers: { Authorization: `Bearer ${ada.token}` } })).status).toBe(200);
  });

  it("says why when it can't: no recipe and no worker, a page not found, an address at home", async () => {
    const { base, ada, id, r } = await recipeFrom("https://blogg.example.se/bullar");
    expect((await call<{ error: string }>(base, "POST", `/api/objects/${id}/import`, ada.token)).json.error).toBe("no_recipe");
    await until(() => readRecipe(r.doc).import?.status === "failed", "the import to say it failed");
    expect(readRecipe(r.doc).import).toMatchObject({ error: "no recipe was found on the page", reason: "no_recipe" });

    const missing = await recipeFrom("https://recept.example.se/finns-inte");
    expect((await call<{ error: string }>(missing.base, "POST", `/api/objects/${missing.id}/import`, missing.ada.token)).json.error).toBe("fetch_failed");
    const home = await recipeFrom("http://192.168.1.10/recept");
    expect((await call<{ error: string }>(home.base, "POST", `/api/objects/${home.id}/import`, home.ada.token)).json.error).toBe("not_public");
  });

  it("says so when a site keeps the server out, for the app to offer pasting the recipe instead", async () => {
    const { base, ada, id, r } = await recipeFrom("https://murad.example.com/recipe/1/meatballs");
    expect((await call<{ error: string }>(base, "POST", `/api/objects/${id}/import`, ada.token)).json.error).toBe("blocked");
    await until(() => readRecipe(r.doc).import?.status === "failed", "the import to say it failed");
    expect(readRecipe(r.doc).import).toMatchObject({ error: "the page answered 403", reason: "blocked" });
  });

  it("says the page has no recipe when the worker gives up on it for good", async () => {
    const { base, ada, id, r } = await recipeFrom("https://blogg.example.se/bullar", { workerToken: WORKER });
    await call(base, "POST", `/api/objects/${id}/import`, ada.token);
    const job = ((await (await worker(base, "/next", { worker: "w", kinds: ["recipe"] })).json()) as { job: { id: string } }).job;
    await worker(base, `/jobs/${job.id}/failed`, { error: "no recipe was found on the page", retry: false });
    await until(() => readRecipe(r.doc).import?.status === "failed", "the import to say it failed");
    expect(readRecipe(r.doc).import?.reason).toBe("no_recipe");
  });
});

describe("fetching a page", () => {
  it("only reaches the internet", async () => {
    for (const ip of ["10.0.0.5", "127.0.0.1", "192.168.1.1", "172.20.0.5", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:192.168.1.1"]) expect(isPublicAddress(ip)).toBe(false);
    for (const ip of ["8.8.8.8", "104.21.44.70", "2606:4700::1111"]) expect(isPublicAddress(ip)).toBe(true);
    await expect(fetchPublic("http://127.0.0.1:1/")).rejects.toMatchObject({ reason: "not_public" });
    await expect(fetchPublic("http://localhost:1/")).rejects.toMatchObject({ reason: "not_public" });
    await expect(fetchPublic("file:///etc/passwd")).rejects.toBeInstanceOf(FetchFailed);
  });
});
