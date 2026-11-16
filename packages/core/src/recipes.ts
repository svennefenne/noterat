import * as Y from "yjs";
import { firstLine } from "./docs";
import type { Photo } from "./journal";
import type { Transcription, TranscriptionStatus } from "./memos";
import { writeSteps, type PastedRecipe } from "./recipeText";
import type { RecipeLanguage, RecipeTexts } from "./recipeTranslate";

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
 * - translation: the recipe in another language (recipeTranslate.ts): from, to, which it shows
 *   (shown), the words it came with (original) and the translation (translated), and how the worker's
 *   translating is coming along (status, error, at)
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
  translation: RecipeTranslation | null;
}

/** A recipe's translation: into what, which the recipe shows, and how translating it is coming along. */
export interface RecipeTranslation {
  from: RecipeLanguage;
  to: RecipeLanguage;
  /** what the recipe shows: the translation, the words it came with, or neither yet (it's being translated the first time) */
  shown: "translated" | "original" | null;
  /** the worker's job: none, or queued, working, done or failed */
  job: Transcription | null;
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
const translationMap = (doc: Y.Doc) => doc.getMap<unknown>("translation");
const LANGUAGES: RecipeLanguage[] = ["sv", "en"];

const STATUSES: TranscriptionStatus[] = ["wanted", "queued", "working", "done", "failed"];
/**
 * Why an import failed, when the app can say it plainly: the site won't let the server in (a wall
 * against programs), the link goes to the home network, or the page has no recipe to be read.
 */
export const IMPORT_FAILURES = ["blocked", "not_public", "no_recipe"] as const;
export type ImportFailure = (typeof IMPORT_FAILURES)[number];
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
    import: STATUSES.includes(status)
      ? { status, error: str(im.get("error")) || undefined, reason: IMPORT_FAILURES.find((r) => r === im.get("reason")), at: Number(im.get("at")) || 0 }
      : null,
    guessed: m.get("guessed") === true,
    photoChoices: choicesArray(doc)
      .toArray()
      .filter((p) => p && typeof p.hash === "string"),
    translation: readTranslation(doc),
  };
}

function readTranslation(doc: Y.Doc): RecipeTranslation | null {
  const tr = translationMap(doc);
  const from = LANGUAGES.find((l) => l === tr.get("from"));
  const to = LANGUAGES.find((l) => l === tr.get("to"));
  if (!from || !to) return null;
  const shown = tr.get("shown");
  const status = tr.get("status") as TranscriptionStatus;
  return {
    from,
    to,
    shown: shown === "translated" || shown === "original" ? shown : null,
    job: STATUSES.includes(status) ? { status, error: typeof tr.get("error") === "string" ? (tr.get("error") as string) : undefined, at: Number(tr.get("at")) || 0 } : null,
  };
}

/** What a translation takes the place of, as the recipe reads now. */
export function recipeTexts(doc: Y.Doc): RecipeTexts {
  const m = meta(doc);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return { title: str(m.get("title")), description: str(m.get("description")), ingredients: recipeIngredients(doc).toString(), steps: recipeSteps(doc).toString() };
}

const textsOf = (v: unknown): RecipeTexts | null => {
  const o = v as Partial<RecipeTexts> | null;
  return o && typeof o === "object" && (["title", "description", "ingredients", "steps"] as const).every((k) => typeof o[k] === "string") ? (o as RecipeTexts) : null;
};
const sameTexts = (a: RecipeTexts, b: RecipeTexts) => a.title === b.title && a.description === b.description && a.ingredients === b.ingredients && a.steps === b.steps;

function writeTexts(doc: Y.Doc, t: RecipeTexts) {
  const m = meta(doc);
  if (m.get("title") !== t.title) m.set("title", oneLine(t.title, RECIPE_TITLE_MAX));
  if ((m.get("description") ?? "") !== t.description) {
    if (t.description) m.set("description", t.description);
    else m.delete("description");
  }
  for (const [y, s] of [
    [recipeIngredients(doc), t.ingredients],
    [recipeSteps(doc), t.steps],
  ] as const) {
    if (y.toString() === s) continue;
    y.delete(0, y.length);
    y.insert(0, s);
  }
}

/** How translating the recipe is coming along (the server's, as the worker goes); from and to when it's asked for. */
export function setTranslateState(doc: Y.Doc, t: Transcription, langs?: { from: RecipeLanguage; to: RecipeLanguage }) {
  const tr = translationMap(doc);
  doc.transact(() => {
    for (const k of ["status", "error", "progress", "at"]) if (!(k in t) || (t as unknown as Record<string, unknown>)[k] === undefined) tr.delete(k);
    for (const [k, v] of Object.entries(t)) if (v !== undefined && k !== "reason") tr.set(k, v);
    if (langs && (tr.get("from") !== langs.from || tr.get("to") !== langs.to)) {
      tr.set("from", langs.from);
      tr.set("to", langs.to);
      tr.delete("translated");
      if (tr.get("shown") === "translated") tr.delete("shown");
    }
  });
}

/** The worker's translation, into the recipe: it shows it, and keeps the words it came with to go back to. */
export function putRecipeTranslation(doc: Y.Doc, o: { from: RecipeLanguage; to: RecipeLanguage; original: RecipeTexts; translated: RecipeTexts }) {
  const tr = translationMap(doc);
  doc.transact(() => {
    tr.set("from", o.from);
    tr.set("to", o.to);
    tr.set("original", { ...o.original });
    tr.set("translated", { ...o.translated });
    writeTexts(doc, o.translated);
    tr.set("shown", "translated");
    for (const k of ["error", "progress"]) tr.delete(k);
    tr.set("status", "done");
    tr.set("at", Date.now());
  });
}

/**
 * Show the recipe's translation, or the words it came with: what it shows now is kept (with whatever
 * someone changed in it) in place of the one it goes to. False when there's nothing to show.
 */
export function showRecipeVersion(doc: Y.Doc, which: "translated" | "original"): boolean {
  const tr = translationMap(doc);
  const to = textsOf(tr.get(which));
  const now = tr.get("shown");
  if (!to || now === which || (now !== "translated" && now !== "original")) return false;
  doc.transact(() => {
    tr.set(now, recipeTexts(doc));
    writeTexts(doc, to);
    tr.set("shown", which);
  });
  return true;
}

/** Whether the recipe's translation can be shown as it is: it shows the words it came with, and they're as they were translated. */
export function translationFits(doc: Y.Doc): boolean {
  const tr = translationMap(doc);
  const original = textsOf(tr.get("original"));
  return tr.get("shown") === "original" && !!textsOf(tr.get("translated")) && !!original && sameTexts(original, recipeTexts(doc));
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

/**
 * A recipe someone pasted (recipeText.ts) into the recipe: its ingredients and steps take the place of
 * what's there (it's what was asked for), servings and time with them; the title only if there's none.
 * An import that failed, or is still on its way, is done with: what was pasted is the recipe.
 */
export function putPastedRecipe(doc: Y.Doc, r: PastedRecipe) {
  doc.transact(() => {
    const m = meta(doc);
    if (!readRecipe(doc).title && r.title) m.set("title", oneLine(r.title, RECIPE_TITLE_MAX));
    if (r.servings) m.set("servings", Math.round(r.servings));
    if (r.minutes) m.set("minutes", Math.round(r.minutes));
    const replace = (t: Y.Text, s: string) => {
      t.delete(0, t.length);
      t.insert(0, s);
    };
    if (r.ingredients.length) replace(recipeIngredients(doc), r.ingredients.map((l) => oneLine(l, 500)).filter(Boolean).join("\n"));
    if (r.steps.length) replace(recipeSteps(doc), writeSteps(r.steps));
    if (importMap(doc).get("status") !== undefined) setImportState(doc, { status: "done", at: Date.now() });
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
