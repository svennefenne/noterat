import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, Clock, ExternalLink, Eye, ImagePlus, Minus, MoreVertical, PenLine, Plus, Share2, ShoppingCart, X } from "lucide-react";
import { Link } from "wouter";
import type * as Y from "yjs";
import {
  addRecipePhoto,
  addTextRows,
  canAddRows,
  ingredientLines,
  objectDocName,
  readList,
  readRecipe,
  recipeIngredients,
  recipeSteps,
  recipeTitle,
  removeRecipePhoto,
  scaleLine,
  setRecipeMeta,
  setRecipeTags,
  writeMinutes,
  type MemberRole,
} from "@noterat/core";
import { ApiError, isApp } from "../lib/api";
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
  const { away, problem, setProblem } = useAway("recipe", id);
  const awareness = sync.awareness(name);
  usePresence(awareness);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const base = recipe.servings;
  const want = servings ?? base;
  const factor = base && want ? want / base : 1;
  const lines = ingredientLines(ingredients).map((l) => scaleLine(l, factor));
  const title = recipeTitle(recipe, ingredients) || t("untitled.recipe");

  const [retry, setRetry] = useState(0);
  async function importNow() {
    setProblem("");
    try {
      await api.importRecipe(id);
    } catch (err) {
      // (made a moment ago: the server hasn't got it yet; asked again in a little while)
      if (err instanceof ApiError && err.code === "not_synced") return void setTimeout(() => setRetry((n) => n + 1), 2000);
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
        steps,
        photo: first ? { bytes: new Uint8Array(await first.arrayBuffer()), type: first.type } : undefined,
        footer: `Noterat · ${new Date().toLocaleDateString(t("locale"))}`,
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
                {t(isApp ? "recipe.pdfShare" : "recipe.pdf")}
              </MenuItem>
              {!readOnly && recipe.source && <MenuItem onSelect={() => void importNow()}>{t("recipe.importAgain")}</MenuItem>}
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
        {im && im.status !== "done" && (
          <p className={im.status === "failed" ? "problem" : "notice"}>
            {im.status === "failed" ? `${t("recipe.importFailed")}${im.error ? `: ${im.error}` : ""}` : t(im.status === "queued" ? "recipe.importQueued" : "recipe.importing")}
            {im.status === "failed" && !readOnly && (
              <button type="button" className="link-button" onClick={() => void importNow()}>
                {" "}
                {t("recipe.tryAgain")}
              </button>
            )}
          </p>
        )}
        {problem && <Problem>{problem}</Problem>}
      </div>

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
              {(isApp || matchMedia("(pointer: coarse)").matches) && (
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

      <div className="recipe-body">
        <section className="recipe-ingredients" aria-label={t("recipe.ingredients")}>
          <div className="entry-section-head">
            <h2>{t("recipe.ingredients")}</h2>
            <span className="servings" role="group" aria-label={t("recipe.servings")}>
              <button type="button" className="icon-button" onClick={() => setServings(Math.max(1, (want ?? 4) - 1))} aria-label={t("recipe.fewer")} disabled={!base && mode === "read"}>
                <Minus aria-hidden size={16} />
              </button>
              {mode === "write" && !readOnly ? (
                <input type="number" min={1} value={base ?? ""} onChange={(e) => setRecipeMeta(doc, { servings: Number(e.target.value) || null })} aria-label={t("recipe.servings")} />
              ) : (
                <span>{want ? t("recipe.servingsN", { n: want }) : t("recipe.noServings")}</span>
              )}
              <button type="button" className="icon-button" onClick={() => setServings((want ?? 4) + 1)} aria-label={t("recipe.more")} disabled={!base && mode === "read"}>
                <Plus aria-hidden size={16} />
              </button>
            </span>
          </div>
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
            <Preview markdown={steps} empty={t("recipe.noSteps")} />
          )}
        </section>
      </div>

      <Dialog open={sharing} onClose={() => setSharing(false)} title={t("share.title", { title })}>
        <ShareDialog id={id} />
      </Dialog>
      <Dialog open={shopping} onClose={() => setShopping(false)} title={t("recipe.toList")}>
        <ToList lines={lines.filter((l) => !/:$/.test(l))} onDone={() => setShopping(false)} />
      </Dialog>
    </div>
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
