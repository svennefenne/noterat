import { describe, expect, it } from "vitest";
import { initRecipe, newObjectId, objectDocName, readRecipe, recipeIngredients, recipeSteps, showRecipeVersion, type WorkerJob } from "@noterat/core";
import { account, call, device, startServer, synced, until, worker, WORKER } from "./helpers";

/**
 * Translating a recipe (decision 9): the app asks, the worker translates the pieces core picks out, and
 * the server puts them in their places in the recipe, keeping the words it came with.
 */

const INGREDIENTS = "1 pound ground beef\n2 cloves garlic, minced\n1 (15-ounce) can black beans, rinsed and drained";
const STEPS = "1. Brown the ground beef in a large pot over medium heat.\n2. Add the beans and simmer for 20 minutes.";

async function recipe(o: { workerToken?: string } = {}) {
  const { db, base } = await startServer({ workerToken: o.workerToken, workerWait: 100 });
  const ada = await account(db, "ada");
  const id = newObjectId();
  const r = device(base, ada.token)(objectDocName("recipe", id));
  initRecipe(r.doc, { title: "Taco Soup", ingredients: INGREDIENTS, steps: STEPS, by: ada.user.id });
  await synced(r.provider);
  return { base, ada, id, r };
}

const next = async (base: string, kinds: string[]) => {
  const res = await worker(base, "/next", { worker: "w", kinds });
  return res.status === 204 ? null : (((await res.json()) as { job: WorkerJob }).job ?? null);
};

describe("translating a recipe", () => {
  it("has the worker translate what the glossary hasn't got, and puts it in the recipe", async () => {
    const { base, ada, id, r } = await recipe({ workerToken: WORKER });
    expect(await next(base, ["recipe", "translate"])).toBeNull();

    expect((await call(base, "POST", `/api/objects/${id}/translate`, ada.token, { to: "sv" })).status).toBe(202);
    await until(() => readRecipe(r.doc).translation?.job?.status === "queued", "the translating to be queued");

    const job = (await next(base, ["recipe", "translate"]))!;
    expect(job).toEqual({
      id: job.id,
      kind: "translate",
      from: "en",
      to: "sv",
      texts: ["Fry the minced beef in a large saucepan on medium heat.", "Add the beans and simmer for 20 minutes."],
    });
    // (the wrong number of pieces isn't taken)
    expect((await worker(base, `/jobs/${job.id}/done`, { texts: ["Stek."] })).status).toBe(400);
    expect((await worker(base, `/jobs/${job.id}/done`, { texts: ["Stek nötfärsen i en stor kastrull på medelvärme.", "Tillsätt bönorna och sjud i 20 minuter."] })).status).toBe(204);

    await until(() => readRecipe(r.doc).translation?.shown === "translated", "the translation to be shown");
    expect(readRecipe(r.doc).title).toBe("Taco Soup");
    expect(recipeIngredients(r.doc).toString()).toBe("450 g nötfärs\n2 klyftor vitlök, finhackade\n1 (430 g) burk svarta bönor, sköljda och avrunna");
    expect(recipeSteps(r.doc).toString()).toBe("1. Stek nötfärsen i en stor kastrull på medelvärme.\n2. Tillsätt bönorna och sjud i 20 minuter.");

    // (the words it came with are kept, to go back to)
    showRecipeVersion(r.doc, "original");
    expect(recipeIngredients(r.doc).toString()).toBe(INGREDIENTS);
  });

  it("says when there's no worker to translate, or one from before translating", async () => {
    const none = await recipe();
    expect(await call(none.base, "POST", `/api/objects/${none.id}/translate`, none.ada.token, { to: "sv" })).toMatchObject({ status: 409, json: { error: "no_translator" } });

    const old = await recipe({ workerToken: WORKER });
    await next(old.base, ["transcribe", "ocr", "recipe"]);
    expect(await call(old.base, "POST", `/api/objects/${old.id}/translate`, old.ada.token, { to: "sv" })).toMatchObject({ status: 409, json: { error: "no_translator" } });
  });

  it("says when the worker couldn't", async () => {
    const { base, ada, id, r } = await recipe({ workerToken: WORKER });
    await next(base, ["translate"]);
    await call(base, "POST", `/api/objects/${id}/translate`, ada.token, { to: "sv" });
    const job = (await next(base, ["translate"]))!;
    await worker(base, `/jobs/${job.id}/failed`, { error: "the model couldn't be loaded", retry: false });
    await until(() => readRecipe(r.doc).translation?.job?.status === "failed", "the translating to have failed");
    expect(readRecipe(r.doc).translation).toMatchObject({ from: "en", to: "sv", shown: null, job: { error: "the model couldn't be loaded" } });
    expect(recipeIngredients(r.doc).toString()).toBe(INGREDIENTS);
  });
});
