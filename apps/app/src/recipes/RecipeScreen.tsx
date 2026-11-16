import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Camera, Check, ClipboardPaste, Clock, ExternalLink, Eye, ImagePlus, Languages, Minus, MoreVertical, PenLine, Plus, Share2, ShoppingCart, X } from "lucide-react";
import { Link } from "wouter";
import type * as Y from "yjs";
import {
  addRecipePhoto,
  addTextRows,
  canAddRows,
  canTranslate,
  doneChoosing,
  foreignMeasures,
  ingredientLines,
  objectDocName,
  putPastedRecipe,
  readList,
  readRecipe,
  readRecipeText,
  recipeIngredients,
  recipeLanguage,
  recipeSteps,
  recipeTitle,
  removeRecipePhoto,
  scaleLine,
  setRecipeMeta,
  setRecipeTags,
  showRecipeVersion,
  toMetric,
  translationFits,
  writeMinutes,
  type MemberRole,
  type RecipeView,
} from "@noterat/core";
import { ApiError, isNative } from "../lib/api";
import { useDates } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { shrinkPhoto } from "../lib/images";
import { recipePdf } from "../lib/recipePdf";
import { saveOrShare } from "../lib/save";
import { useDocsValues, useDocValue, useHomeItems, useSession, useSyncState } from "../lib/sync-react";
import { MarkdownEditor } from "../notes/LazyEditor";
import { TitleInput } from "../notes/NoteScreen";
import { Preview } from "../notes/Preview";
import { Back, NotHere, useAway, usePresence, useThing } from "../things/parts";
import { ShareDialog } from "../things/ShareDialog";
import { Dialog, Menu, MenuItem, Problem, useStored } from "../ui";
import { Photo } from "./RecipesScreen";

const readIngredients = (doc: Y.Doc) => recipeIngredients(doc).toString();
const readSteps = (doc: Y.Doc) => recipeSteps(doc).toString();

export function RecipeScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { loading, role } = useThing("recipe", id);
  if (loading) return <p className="muted">{t("lists.loading")}</p>;
  if (!role) return <NotHere type="recipe" />;
  return <RecipePage id={id} role={role} />;
}

function RecipePage({ id, role }: { id: string; role: MemberRole }) {
  const { t, lang, errorText } = useI18n();
  const dates = useDates();
  const { sync, api } = useSession();
  const { connection } = useSyncState();
  const name = objectDocName("recipe", id);
  const doc = sync.doc(name);
  const recipe = useDocValue(doc, readRecipe);
  const ingredients = useDocValue(doc, readIngredients);
  const steps = useDocValue(doc, readSteps);
  const readOnly = role === "viewer";
  const [mode, setMode] = useStored<"read" | "write">(`noterat.recipe.${id}`, "read");
  const [servings, setServings] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const { away, problem, setProblem } = useAway("recipe", id);
  const awareness = sync.awareness(name);
  usePresence(awareness);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const base = recipe.servings;
  const want = servings ?? base;
  const factor = base && want ? want / base : 1;
  // American measures shown in metric ones, when that's asked for (on this device, for every recipe)
  const [measures, setMeasures] = useStored<"own" | "metric">("noterat.recipe.measures", "own");
  const foreign = foreignMeasures(`${ingredients}\n${steps}`, lang);
  const metric = measures === "metric" && foreign.length > 0;
  const lines = ingredientLines(ingredients).map((l) => (metric ? toMetric(scaleLine(l, factor), lang) : scaleLine(l, factor)));
  const shownSteps = metric ? toMetric(steps, lang) : steps;
  const title = recipeTitle(recipe, ingredients) || t("untitled.recipe");

  const [retry, setRetry] = useState(0);
  async function importNow() {
    setProblem("");
    try {
      await api.importRecipe(id);
    } catch (err) {
      // (made a moment ago: the server hasn't got it yet; asked again in a little while)
      if (err instanceof ApiError && err.code === "not_synced") return void setTimeout(() => setRetry((n) => n + 1), 2000);
      // (why the page couldn't be read, the recipe says itself)
      if (err instanceof ApiError && ["blocked", "fetch_failed", "not_public", "no_recipe"].includes(err.code)) return;
      setProblem(err instanceof ApiError && err.code === "network" ? t("list.needsOnline") : errorText(err));
    }
  }

  // translating (decision 9): a recipe in another language than the app's, into the app's; the
  // translation takes the place of its words for everyone, which are kept to go back to
  const written = useMemo(() => recipeLanguage(`${ingredients}\n${steps}`), [ingredients, steps]);
  const tr = recipe.translation;
  const translating = tr?.job?.status === "queued" || tr?.job?.status === "working";
  const translation = readOnly || mode !== "read" ? null : tr?.shown === "translated" ? "original" : written && written !== lang && canTranslate(written, lang) ? "translate" : null;
  async function translate() {
    setProblem("");
    if (translation === "original") return void showRecipeVersion(doc, "original");
    // (translated before, and the words it came with as they were: no need to ask the worker again)
    if (tr?.to === lang && translationFits(doc)) return void showRecipeVersion(doc, "translated");
    try {
      await api.translateRecipe(id, { from: written!, to: lang });
    } catch (err) {
      setProblem(err instanceof ApiError && err.code === "network" ? t("list.needsOnline") : errorText(err));
    }
  }

  // a recipe made from a link: the server is asked to read the page once there's a connection
  const status = recipe.import?.status;
  useEffect(() => {
    if (readOnly || status !== "wanted" || connection !== "online") return;
    const timer = setTimeout(() => void importNow(), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- (importNow is the same call each time)
  }, [readOnly, status, connection, retry]);

  async function photos(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    for (const f of files) {
      const s = await shrinkPhoto(f);
      if (!s) continue;
      const { hash } = await sync.files.add(s.blob, id);
      addRecipePhoto(doc, { hash, type: "image/jpeg", size: s.blob.size, width: s.width, height: s.height });
    }
  }

  async function pdf() {
    setBusy(true);
    try {
      const kept = recipe.photos[0] ? await sync.files.get(recipe.photos[0].hash) : null;
      // (the PDF takes JPEG and PNG: a page's WebP or AVIF photo is drawn anew as a JPEG)
      const first = kept && !/jpe?g|png/.test(kept.type) ? ((await shrinkPhoto(kept, 1600))?.blob ?? null) : kept;
      const meta = [want ? t("recipe.servingsN", { n: want }) : "", recipe.minutes ? writeMinutes(recipe.minutes, lang) : "", recipe.source ? new URL(recipe.source).host : ""].filter(Boolean).join("  ·  ");
      const blob = await recipePdf({
        title,
        meta,
        ingredients: lines,
        steps: shownSteps,
        photo: first ? { bytes: new Uint8Array(await first.arrayBuffer()), type: first.type } : undefined,
        footer: `Noterat · ${dates.day(new Date(), { year: true })}`,
      });
      await saveOrShare(blob, `${title}.pdf`, title);
    } catch {
      setProblem(t("recipe.pdfFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!sync.isLoaded(name)) return <p className="muted">{t("lists.loading")}</p>;
  const im = recipe.import;
  const host = recipe.source ? new URL(recipe.source).host : "";
  const failed =
    im?.reason === "blocked"
      ? t("recipe.blocked", { host })
      : im?.reason === "no_recipe"
        ? t("recipe.noRecipe")
        : im?.reason === "not_public"
          ? t("error.not_public")
          : `${t("recipe.importFailed")}${im?.error ? `: ${im.error}` : ""}`;

  return (
    <div className="screen recipe-screen">
      <div className="list-head">
        <Back type="recipe" />
        <div className="list-title-row">
          <TitleInput value={recipe.title} placeholder={title} readOnly={readOnly} onCommit={(v) => setRecipeMeta(doc, { title: v })} />
          <div className="list-actions">
            {!readOnly && (
              <div className="segmented" role="group" aria-label={t("note.mode")}>
                <button type="button" aria-pressed={mode === "write"} onClick={() => setMode("write")} title={t("note.write")}>
                  <PenLine aria-hidden size={16} />
                  <span>{t("note.write")}</span>
                </button>
                <button type="button" aria-pressed={mode === "read"} onClick={() => setMode("read")} title={t("note.read")}>
                  <Eye aria-hidden size={16} />
                  <span>{t("note.read")}</span>
                </button>
              </div>
            )}
            <button type="button" className="secondary small" onClick={() => setSharing(true)}>
              <Share2 aria-hidden size={16} /> {t("list.share")}
            </button>
            <Menu label={t("list.more")} icon={<MoreVertical aria-hidden size={20} />}>
              <MenuItem onSelect={() => void pdf()} disabled={busy}>
                {t(isNative ? "recipe.pdfShare" : "recipe.pdf")}
              </MenuItem>
              {!readOnly && recipe.source && <MenuItem onSelect={() => void importNow()}>{t("recipe.importAgain")}</MenuItem>}
              {!readOnly && <MenuItem onSelect={() => setPasting(true)}>{t("recipe.pasteMenu")}</MenuItem>}
              {role === "owner" ? (
                <MenuItem danger onSelect={() => void away("delete", t("recipe.deleteConfirm"))}>
                  {t("recipe.delete")}
                </MenuItem>
              ) : (
                <MenuItem danger onSelect={() => void away("leave", t("recipe.leaveConfirm"))}>
                  {t("recipe.leave")}
                </MenuItem>
              )}
            </Menu>
          </div>
        </div>
        <div className="recipe-meta">
          {recipe.source && (
            <a href={recipe.source} target="_blank" rel="noopener noreferrer" className="muted small-text">
              <ExternalLink aria-hidden size={14} /> {new URL(recipe.source).host}
            </a>
          )}
          {mode === "write" && !readOnly ? (
            <label className="small-text recipe-minutes">
              <Clock aria-hidden size={14} />
              <input type="number" min={0} inputMode="numeric" value={recipe.minutes ?? ""} onChange={(e) => setRecipeMeta(doc, { minutes: Number(e.target.value) || null })} aria-label={t("recipe.minutes")} /> min
            </label>
          ) : (
            recipe.minutes && (
              <span className="muted small-text">
                <Clock aria-hidden size={14} /> {writeMinutes(recipe.minutes, lang)}
              </span>
            )
          )}
          {mode === "write" && !readOnly && <TagsInput doc={doc} tags={recipe.tags} />}
          {mode === "read" && recipe.tags.map((x) => <span key={x} className="badge tag">#{x}</span>)}
        </div>
        {im && im.status !== "done" && im.status !== "failed" && <p className="notice">{t(im.status === "queued" ? "recipe.importQueued" : "recipe.importing")}</p>}
        {im?.status === "failed" && (
          <div className="recipe-failed" role="status">
            <p>{failed}</p>
            {!readOnly && (
              <div className="recipe-failed-actions">
                <button type="button" className="secondary small" onClick={() => setPasting(true)}>
                  <ClipboardPaste aria-hidden size={16} /> {t("recipe.paste")}
                </button>
                {im.reason !== "not_public" && (
                  <button type="button" className="link-button" onClick={() => void importNow()}>
                    {t("recipe.tryAgain")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {problem && <Problem>{problem}</Problem>}
      </div>

      {!readOnly && (recipe.guessed || recipe.photoChoices.length > 0) && <ToCheck doc={doc} recipe={recipe} />}

      {(recipe.photos.length > 0 || !readOnly) && (
        <div className="recipe-photos">
          {recipe.photos.map((p) => (
            <span key={p.hash} className="recipe-photo-wrap">
              <Photo hash={p.hash} className="recipe-photo big" />
              {mode === "write" && !readOnly && (
                <button type="button" className="photo-remove" onClick={() => removeRecipePhoto(doc, p.hash)} aria-label={t("entry.removePhoto")}>
                  <X aria-hidden size={14} />
                </button>
              )}
            </span>
          ))}
          {mode === "write" && !readOnly && (
            <span className="recipe-photo-add">
              {(isNative || matchMedia("(pointer: coarse)").matches) && (
                <button type="button" className="secondary small" onClick={() => camera.current?.click()}>
                  <Camera aria-hidden size={16} /> {t("entry.takePhoto")}
                </button>
              )}
              <button type="button" className="secondary small" onClick={() => picker.current?.click()}>
                <ImagePlus aria-hidden size={16} /> {t("entry.addPhotos")}
              </button>
              <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void photos(e)} />
              <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => void photos(e)} />
            </span>
          )}
        </div>
      )}

      <div className="recipe-servings-row">
        <span className="recipe-servings-label" id={`servings-${id}`}>
          {t("recipe.servings")}
        </span>
        {mode === "read" && !base ? (
          <span className="muted">{t("recipe.noServings")}</span>
        ) : (
          <span className="servings" role="group" aria-labelledby={`servings-${id}`}>
            <button type="button" className="icon-button" onClick={() => setServings(Math.max(1, (want ?? 4) - 1))} aria-label={t("recipe.fewer")}>
              <Minus aria-hidden size={16} />
            </button>
            {mode === "write" && !readOnly ? (
              <input type="number" min={1} value={base ?? ""} onChange={(e) => setRecipeMeta(doc, { servings: Number(e.target.value) || null })} aria-label={t("recipe.servings")} />
            ) : (
              <ServingsField value={want!} onChange={setServings} />
            )}
            <button type="button" className="icon-button" onClick={() => setServings((want ?? 4) + 1)} aria-label={t("recipe.more")}>
              <Plus aria-hidden size={16} />
            </button>
          </span>
        )}
        {translation && (
          <button type="button" className="secondary small recipe-translate" onClick={() => void translate()} disabled={translating}>
            <Languages aria-hidden size={16} /> {translating ? t("recipe.translating") : t(translation === "original" ? "recipe.showOriginal" : "recipe.translate")}
          </button>
        )}
      </div>
      {translation === "original" && <p className="muted small-text recipe-note">{t("recipe.translatedFrom", { lang: t(`recipe.lang.${tr!.from}`) })}</p>}
      {translation === "translate" && tr?.job?.status === "failed" && <Problem>{t("recipe.translateFailed", { error: tr.job.error ?? "" })}</Problem>}
      <div className="recipe-body">
        <section className="recipe-ingredients" aria-label={t("recipe.ingredients")}>
          <div className="entry-section-head">
            <h2>{t("recipe.ingredients")}</h2>
          </div>
          {foreign.length > 0 && (mode === "read" || readOnly) && (
            <p className="recipe-measures small-text">
              <span className="muted">{metric ? t("recipe.inMetric") : t("recipe.measuresIn", { units: new Intl.ListFormat(lang, { type: "conjunction" }).format(foreign) })}</span>{" "}
              <button type="button" className="link-button" onClick={() => setMeasures(metric ? "own" : "metric")}>
                {t(metric ? "recipe.ownMeasures" : "recipe.toMetric")}
              </button>
            </p>
          )}
          {mode === "write" && !readOnly ? (
            <>
              <p className="muted small-text">{t("recipe.ingredientsHint")}</p>
              <MarkdownEditor text={recipeIngredients(doc)} awareness={awareness} toolbar={false} placeholder={t("recipe.ingredientsPlaceholder")} label={t("recipe.ingredients")} />
            </>
          ) : lines.length ? (
            <ul className="ingredient-list">
              {lines.map((l, i) => (
                <li key={i} className={/:$/.test(l) ? "heading" : undefined}>
                  {l}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("recipe.noIngredients")}</p>
          )}
          {factor !== 1 && <p className="muted small-text">{t("recipe.scaled", { n: want!, base: base! })}</p>}
          {lines.length > 0 && (
            <button type="button" className="secondary small" onClick={() => setShopping(true)}>
              <ShoppingCart aria-hidden size={16} /> {t("recipe.toList")}
            </button>
          )}
        </section>
        <section className="recipe-steps" aria-label={t("recipe.steps")}>
          <div className="entry-section-head">
            <h2>{t("recipe.steps")}</h2>
          </div>
          {mode === "write" && !readOnly ? (
            <MarkdownEditor text={recipeSteps(doc)} awareness={awareness} placeholder={t("recipe.stepsPlaceholder")} label={t("recipe.steps")} />
          ) : (
            <Preview markdown={shownSteps} empty={t("recipe.noSteps")} />
          )}
        </section>
      </div>

      <Dialog open={sharing} onClose={() => setSharing(false)} title={t("share.title", { title })}>
        <ShareDialog id={id} />
      </Dialog>
      <Dialog open={shopping} onClose={() => setShopping(false)} title={t("recipe.toList")}>
        <ToList lines={lines.filter((l) => !/:$/.test(l))} onDone={() => setShopping(false)} />
      </Dialog>
      <Dialog open={pasting} onClose={() => setPasting(false)} title={t("recipe.paste")} wide>
        {pasting && <PasteForm doc={doc} recipe={recipe} filled={Boolean(ingredients.trim() || steps.trim())} onDone={() => setPasting(false)} />}
      </Dialog>
    </div>
  );
}

/**
 * A recipe the worker read from its page's headings, to be looked over; and the page's pictures, when
 * it wasn't clear which is the recipe's, to choose among (the likeliest already chosen). Done, and
 * both go.
 */
function ToCheck({ doc, recipe }: { doc: Y.Doc; recipe: RecipeView }) {
  const { t } = useI18n();
  const chosen = new Set(recipe.photos.map((p) => p.hash));
  return (
    <section className="recipe-check" aria-label={t("recipe.check")}>
      {recipe.guessed && <p>{t("recipe.guessed")}</p>}
      {recipe.photoChoices.length > 0 && (
        <>
          <p className="muted small-text">{t("recipe.pickPhotos")}</p>
          <ul className="photo-choices">
            {recipe.photoChoices.map((p, i) => {
              const on = chosen.has(p.hash);
              return (
                <li key={p.hash}>
                  <button type="button" className="photo-choice" aria-pressed={on} aria-label={t("recipe.photoN", { n: i + 1 })} onClick={() => (on ? removeRecipePhoto(doc, p.hash) : addRecipePhoto(doc, p))}>
                    <Photo hash={p.hash} className="photo-choice-img" />
                    <span className="photo-choice-mark" aria-hidden>
                      {on && <Check size={16} strokeWidth={3} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button type="button" className="secondary small" onClick={() => doneChoosing(doc)}>
        <Check aria-hidden size={16} /> {t("recipe.checked")}
      </button>
    </section>
  );
}

/**
 * A recipe copied from its page (or a whole page) and pasted: read on the device as it's pasted, what
 * was found said before it's put in. For a site that won't let the server in, or a page it can't read.
 */
function PasteForm({ doc, recipe, filled, onDone }: { doc: Y.Doc; recipe: RecipeView; filled: boolean; onDone: () => void }) {
  const { t, lang } = useI18n();
  const [text, setText] = useState("");
  const read = useMemo(() => (text.trim() ? readRecipeText(text, { source: recipe.source || undefined }) : null), [text, recipe.source]);
  const count = (lines: string[]) => lines.filter((l) => !l.endsWith(":")).length;
  const found = read
    ? [
        !recipe.title && read.title ? `”${read.title}”` : "",
        count(read.ingredients) ? t(count(read.ingredients) === 1 ? "recipe.pasteIngredientsOne" : "recipe.pasteIngredients", { n: count(read.ingredients) }) : "",
        count(read.steps) ? t(count(read.steps) === 1 ? "recipe.pasteStepsOne" : "recipe.pasteSteps", { n: count(read.steps) }) : "",
        read.servings ? t("recipe.servingsN", { n: read.servings }) : "",
        read.minutes ? writeMinutes(read.minutes, lang) : "",
      ].filter(Boolean)
    : [];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!read) return;
    putPastedRecipe(doc, read);
    onDone();
  }

  return (
    <form onSubmit={submit} className="stack">
      <p className="muted small-text">{t("recipe.pasteHint")}</p>
      <label className="field">
        <span>{t("recipe.pasteLabel")}</span>
        <textarea className="paste-recipe" rows={9} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-autofocus />
      </label>
      {text.trim() && (
        <p className={read ? "small-text" : "muted small-text"} aria-live="polite">
          {read ? t("recipe.pasteFound", { parts: new Intl.ListFormat(lang, { type: "conjunction" }).format(found) }) : t("recipe.pasteNothing")}
        </p>
      )}
      {read && filled && <p className="muted small-text">{t("recipe.pasteReplaces")}</p>}
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onDone}>
          {t("editor.cancel")}
        </button>
        <button type="submit" className="primary" disabled={!read}>
          {t("recipe.pasteGo")}
        </button>
      </div>
    </form>
  );
}

/**
 * How many servings to see the recipe for: typed (the field can be emptied on the way to "12"; what
 * isn't a number of servings is let go of when leaving it), or a step at a time with the buttons.
 */
function ServingsField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="servings-field">
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={999}
        value={draft ?? String(value)}
        onFocus={(e) => {
          setDraft(String(value));
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Math.round(Number(e.target.value));
          if (n >= 1 && n <= 999) onChange(n);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label={t("recipe.servings")}
      />
    </label>
  );
}

function TagsInput({ doc, tags }: { doc: Y.Doc; tags: string[] }) {
  const { t } = useI18n();
  return (
    <input
      className="tag-input recipe-tags"
      defaultValue={tags.map((x) => `#${x}`).join(" ")}
      key={tags.join(",")}
      placeholder={t("recipe.tags")}
      aria-label={t("recipe.tags")}
      onBlur={(e) => setRecipeTags(doc, e.target.value.split(/[\s,]+/))}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

const readListInfo = (doc: Y.Doc) => {
  const l = readList(doc);
  return { title: l.title, settings: l.settings, text: l.columns.some((c) => c.type === "text") };
};

/** The ingredients (as scaled) as rows in a list: a shopping list, most often. */
function ToList({ lines, onDone }: { lines: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const { sync, user } = useSession();
  const lists = useHomeItems().filter(([, i]) => i.type === "list" && i.role !== "viewer");
  const docs = sync.docsOf("list", lists.map(([id]) => id));
  const info = useDocsValues(docs, readListInfo);
  const usable = lists.map(([id, i], n) => ({ id, role: i.role, ...info[n]! })).filter((l) => l.text && canAddRows(l.role, l.settings));
  const [listId, setListId] = useState(usable.find((l) => /ink(ö|o)p|shopping|handla/i.test(l.title))?.id ?? usable[0]?.id ?? "");
  const [picked, setPicked] = useState(() => lines.map(() => true));
  const [done, setDone] = useState<{ id: string; n: number } | null>(null);

  if (done)
    return (
      <div className="stack">
        <p>{t("recipe.added", { n: done.n })}</p>
        <div className="dialog-actions">
          <Link href={`/lists/${done.id}`} className="primary" onClick={onDone}>
            {t("recipe.openList")}
          </Link>
        </div>
      </div>
    );
  if (!usable.length) return <p className="muted">{t("recipe.noLists")}</p>;
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const n = addTextRows(sync.doc(objectDocName("list", listId)), lines.filter((_, i) => picked[i]), user.id);
        setDone({ id: listId, n });
      }}
    >
      <select value={listId} onChange={(e) => setListId(e.target.value)} aria-label={t("move.pickList")}>
        {usable.map((l) => (
          <option key={l.id} value={l.id}>
            {l.title || t("lists.untitled")}
          </option>
        ))}
      </select>
      <ul className="pick-lines">
        {lines.map((l, i) => (
          <li key={i}>
            <label className="check">
              <input type="checkbox" checked={picked[i]} onChange={(e) => setPicked((p) => p.map((v, j) => (j === i ? e.target.checked : v)))} />
              {l}
            </label>
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <button type="submit" className="primary" disabled={!listId || !picked.some(Boolean)}>
          {t("recipe.addN", { n: picked.filter(Boolean).length })}
        </button>
      </div>
    </form>
  );
}
