import * as Y from "yjs";
import { firstLine } from "./docs";
import type { Photo } from "./journal";
import type { Transcription, TranscriptionStatus } from "./memos";

/**
 * A recipe (decision 9). Its document:
 *
 * - meta: title, source (the page it came from), servings, minutes, createdBy, createdAt
 * - ingredients: a Y.Text, one ingredient per line (headings such as "Sås:" too)
 * - steps: a Y.Text of Markdown
 * - tags: a Y.Array of strings; photos: a Y.Array of photos by their file's hash
 * - import: how importing from the source is coming along (wanted, queued, working, done, failed)
 * - photoChoices: the page's pictures, when it wasn't clear which is the recipe's, to choose from
 *   (meta's guessed: the recipe was read from the page's headings, to be looked over); both go when
 *   the choosing is done
 */

export interface RecipeView {
  title: string;
  source: string;
  servings: number | null;
  minutes: number | null;
  description: string;
  createdBy: number | null;
  createdAt: number;
  tags: string[];
  photos: Photo[];
  import: Transcription | null;
  /** read from the page's headings, not from a recipe on it: worth looking over */
  guessed: boolean;
  photoChoices: PhotoChoice[];
}

/** A picture on the recipe's page, kept as a file of the recipe's, to choose among its photos. */
export type PhotoChoice = Omit<Photo, "at">;

/** What an import found: the server's own reading (schema.org) or the worker's (recipe-scrapers). */
export interface ImportedRecipe {
  title?: string;
  ingredients?: string[];
  steps?: string[];
  servings?: number | null;
  minutes?: number | null;
  description?: string | null;
  image?: string | null;
  /** the page's pictures to choose from (image, the likeliest, among them): when it's unclear */
  images?: string[];
  /** read from the page's headings (the worker's guess) */
  guessed?: boolean;
}

export const RECIPE_TITLE_MAX = 200;

const meta = (doc: Y.Doc) => doc.getMap<unknown>("meta");
export const recipeIngredients = (doc: Y.Doc) => doc.getText("ingredients");
export const recipeSteps = (doc: Y.Doc) => doc.getText("steps");
const tagsArray = (doc: Y.Doc) => doc.getArray<string>("tags");
const photosArray = (doc: Y.Doc) => doc.getArray<Photo>("photos");
const importMap = (doc: Y.Doc) => doc.getMap<unknown>("import");
const choicesArray = (doc: Y.Doc) => doc.getArray<PhotoChoice>("photoChoices");

const STATUSES: TranscriptionStatus[] = ["wanted", "queued", "working", "done", "failed"];
const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** A link someone pasted, as an http(s) address, or null. */
export function cleanUrl(raw: string): string | null {
  const s = raw.trim();
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

export function initRecipe(doc: Y.Doc, o: { title?: string; source?: string; servings?: number | null; ingredients?: string; steps?: string; by: number; importing?: boolean }) {
  doc.transact(() => {
    const m = meta(doc);
    m.set("title", oneLine(o.title ?? "", RECIPE_TITLE_MAX));
    m.set("source", o.source ?? "");
    if (o.servings) m.set("servings", o.servings);
    m.set("createdBy", o.by);
    m.set("createdAt", Date.now());
    if (o.ingredients) recipeIngredients(doc).insert(0, o.ingredients);
    if (o.steps) recipeSteps(doc).insert(0, o.steps);
    if (o.importing) setImportState(doc, { status: "wanted", at: Date.now() });
  });
}

export function readRecipe(doc: Y.Doc): RecipeView {
  const m = meta(doc);
  const im = importMap(doc);
  const status = im.get("status") as TranscriptionStatus;
  const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const tags: string[] = [];
  for (const t of tagsArray(doc).toArray()) if (typeof t === "string" && !tags.includes(t)) tags.push(t);
  return {
    title: str(m.get("title")),
    source: str(m.get("source")),
    servings: num(m.get("servings")),
    minutes: num(m.get("minutes")),
    description: str(m.get("description")),
    createdBy: typeof m.get("createdBy") === "number" ? (m.get("createdBy") as number) : null,
    createdAt: num(m.get("createdAt")) ?? 0,
    tags,
    photos: photosArray(doc)
      .toArray()
      .filter((p) => p && typeof p.hash === "string"),
    import: STATUSES.includes(status) ? { status, error: str(im.get("error")) || undefined, at: Number(im.get("at")) || 0 } : null,
    guessed: m.get("guessed") === true,
    photoChoices: choicesArray(doc)
      .toArray()
      .filter((p) => p && typeof p.hash === "string"),
  };
}

export function setRecipeMeta(doc: Y.Doc, patch: { title?: string; source?: string; servings?: number | null; minutes?: number | null }) {
  const m = meta(doc);
  doc.transact(() => {
    if (patch.title !== undefined) m.set("title", oneLine(patch.title, RECIPE_TITLE_MAX));
    if (patch.source !== undefined) m.set("source", patch.source);
    for (const k of ["servings", "minutes"] as const) {
      if (patch[k] === undefined) continue;
      if (patch[k]) m.set(k, Math.round(patch[k]!));
      else m.delete(k);
    }
  });
}

export function setRecipeTags(doc: Y.Doc, tags: string[]) {
  const arr = tagsArray(doc);
  doc.transact(() => {
    arr.delete(0, arr.length);
    arr.push([...new Set(tags.map((t) => oneLine(t.replace(/^#+/, ""), 40)).filter(Boolean))].slice(0, 20));
  });
}

export function addRecipePhoto(doc: Y.Doc, photo: Omit<Photo, "at">) {
  const arr = photosArray(doc);
  if (!arr.toArray().some((p) => p.hash === photo.hash)) arr.push([{ ...photo, at: Date.now() }]);
}

export function removeRecipePhoto(doc: Y.Doc, hash: string) {
  const arr = photosArray(doc);
  doc.transact(() => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr.get(i)?.hash === hash) arr.delete(i, 1);
  });
}

export function setImportState(doc: Y.Doc, t: Transcription) {
  const map = importMap(doc);
  doc.transact(() => {
    for (const k of [...map.keys()]) if (!(k in t)) map.delete(k);
    for (const [k, v] of Object.entries(t)) if (v !== undefined) map.set(k, v);
  });
}

/** The choosing's done: the pictures not chosen, and the word that it was a guess, go. */
export function doneChoosing(doc: Y.Doc) {
  doc.transact(() => {
    const arr = choicesArray(doc);
    arr.delete(0, arr.length);
    meta(doc).delete("guessed");
  });
}

/**
 * What an import found, into the recipe: its title (if it has none), servings and time, description,
 * ingredients and steps (only into what's still empty: nothing someone wrote is overwritten), its
 * photo, the pictures to choose from (in place of any from before) and whether it's a guess, and done.
 */
export function putImportedRecipe(doc: Y.Doc, r: ImportedRecipe, photo?: Omit<Photo, "at">, choices: PhotoChoice[] = []) {
  doc.transact(() => {
    const m = meta(doc);
    const now = readRecipe(doc);
    if (!now.title && r.title) m.set("title", oneLine(r.title, RECIPE_TITLE_MAX));
    if (!now.servings && r.servings) m.set("servings", Math.round(r.servings));
    if (!now.minutes && r.minutes) m.set("minutes", Math.round(r.minutes));
    if (!now.description && r.description) m.set("description", r.description.trim().slice(0, 2000));
    const ing = recipeIngredients(doc);
    if (!ing.toString().trim() && r.ingredients?.length) ing.insert(0, r.ingredients.map((l) => oneLine(l, 500)).filter(Boolean).join("\n"));
    const steps = recipeSteps(doc);
    if (!steps.toString().trim() && r.steps?.length)
      steps.insert(
        0,
        r.steps
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s, i) => `${i + 1}. ${s.replace(/\s*\n\s*/g, " ")}`)
          .join("\n"),
      );
    // (a guess among the page's pictures only when the recipe has none: one let go of stays gone)
    if (photo && (choices.length < 2 || !now.photos.length)) addRecipePhoto(doc, photo);
    const arr = choicesArray(doc);
    arr.delete(0, arr.length);
    if (choices.length > 1) arr.push(choices.map(({ hash, type, size, width, height }) => ({ hash, type, size, width, height })));
    if (r.guessed) m.set("guessed", true);
    else m.delete("guessed");
    setImportState(doc, { status: "done", at: Date.now() });
  });
}

/** What a recipe is called: its title, else its ingredients' first line. */
export const recipeTitle = (r: RecipeView, ingredients: string) => r.title || firstLine(ingredients, 80);

/** "1 tim 30 min", "45 min" (or in English). */
export function writeMinutes(min: number, lang: "sv" | "en" = "sv"): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const hu = lang === "sv" ? "tim" : "h";
  return h ? (m ? `${h} ${hu} ${m} min` : `${h} ${hu}`) : `${m} min`;
}
