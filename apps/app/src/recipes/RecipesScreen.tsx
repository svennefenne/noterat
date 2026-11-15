import { useState, type FormEvent } from "react";
import { Clock, Link2, Plus, Search, Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import type * as Y from "yjs";
import { cleanUrl, initRecipe, readRecipe, recipeIngredients, recipeTitle, writeMinutes, type RecipeView } from "@noterat/core";
import { useLinkedAction } from "../lib/deepLinks";
import { useI18n } from "../lib/i18n";
import { useDocsValues, useHomeItems, useSession, useSyncState } from "../lib/sync-react";
import { useFileUrl } from "../things/useFileUrl";
import { Dialog, Problem, useStored } from "../ui";

const readCard = (doc: Y.Doc) => ({ recipe: readRecipe(doc), ingredients: recipeIngredients(doc).toString() });

/** Recipes: imported from a page or written by hand, found by words or a tag. */
export function RecipesScreen() {
  const { t, lang } = useI18n();
  const { sync, user } = useSession();
  const { homeLoaded } = useSyncState();
  const [, navigate] = useLocation();
  const items = useHomeItems().filter(([, i]) => i.type === "recipe");
  const docs = sync.docsOf("recipe", items.map(([id]) => id));
  const cards = useDocsValues(docs, readCard);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useStored<string>("noterat.recipes.tag", "");
  const [importing, setImporting] = useState(false);

  const all = items.map(([id, item], i) => ({ id, shared: item.role !== "owner", ...cards[i]! }));
  const tags = [...new Set(all.flatMap((r) => r.recipe.tags))].sort((a, b) => a.localeCompare(b, lang));
  const active = tags.includes(tag) ? tag : "";
  const words = query.toLocaleLowerCase(lang).split(/\s+/).filter(Boolean);
  const shown = all
    .filter((r) => !active || r.recipe.tags.includes(active))
    .filter((r) => words.every((w) => `${r.recipe.title}\n${r.ingredients}\n${r.recipe.tags.join(" ")}`.toLocaleLowerCase(lang).includes(w)))
    .sort((a, b) => recipeTitle(a.recipe, a.ingredients).localeCompare(recipeTitle(b.recipe, b.ingredients), lang));

  function write() {
    const id = sync.create("recipe", (doc) => initRecipe(doc, { by: user.id }));
    navigate(`/recipes/${id}`);
  }

  // "Recipe" from the plus button (?new=1): from a link, or written by hand, as the dialog offers
  useLinkedAction("new", () => setImporting(true));

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t("recipes.title")}</h1>
        <div className="list-actions">
          <button type="button" className="secondary small" onClick={write}>
            <Plus aria-hidden size={18} /> {t("recipes.new")}
          </button>
          <button type="button" className="primary small" onClick={() => setImporting(true)}>
            <Link2 aria-hidden size={18} /> {t("recipes.import")}
          </button>
        </div>
      </div>
      {!homeLoaded ? (
        <p className="muted">{t("lists.loading")}</p>
      ) : all.length === 0 ? (
        <div className="empty">
          <p>{t("recipes.empty")}</p>
          <button type="button" className="primary" onClick={() => setImporting(true)}>
            <Link2 aria-hidden size={18} /> {t("recipes.import")}
          </button>
        </div>
      ) : (
        <>
          <label className="search">
            <Search aria-hidden size={18} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("recipes.search")} aria-label={t("recipes.search")} />
          </label>
          {tags.length > 0 && (
            <div className="chips" role="group" aria-label={t("notes.filter")}>
              <button type="button" className="chip" aria-pressed={!active} onClick={() => setTag("")}>
                {t("notes.all")}
              </button>
              {tags.map((x) => (
                <button key={x} type="button" className="chip" aria-pressed={active === x} onClick={() => setTag(active === x ? "" : x)}>
                  #{x}
                </button>
              ))}
            </div>
          )}
          <ul className="cards recipe-cards">
            {shown.map((r) => (
              <RecipeCard key={r.id} id={r.id} recipe={r.recipe} ingredients={r.ingredients} shared={r.shared} />
            ))}
          </ul>
        </>
      )}
      <Dialog open={importing} onClose={() => setImporting(false)} title={t("recipes.import")}>
        <ImportForm
          onDone={() => setImporting(false)}
          onWrite={() => {
            setImporting(false);
            write();
          }}
        />
      </Dialog>
    </div>
  );
}

function RecipeCard({ id, recipe, ingredients, shared }: { id: string; recipe: RecipeView; ingredients: string; shared: boolean }) {
  const { t, lang } = useI18n();
  return (
    <li>
      <Link href={`/recipes/${id}`} className="card recipe-card">
        {recipe.photos[0] ? <Photo hash={recipe.photos[0].hash} /> : <span className="recipe-photo empty" aria-hidden />}
        <span className="card-title">{recipeTitle(recipe, ingredients) || t("untitled.recipe")}</span>
        <span className="card-meta">
          {recipe.minutes && (
            <span>
              <Clock aria-hidden size={14} /> {writeMinutes(recipe.minutes, lang)}
            </span>
          )}
          {recipe.servings && <span>{t("recipe.servingsN", { n: recipe.servings })}</span>}
          {recipe.import && recipe.import.status !== "done" && <span>{t(recipe.import.status === "failed" ? "recipe.importFailed" : "recipe.importing")}</span>}
          {shared && (
            <span className="badge">
              <Users aria-hidden size={14} /> {t("lists.sharedWithYou")}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function Photo({ hash, className = "recipe-photo" }: { hash: string; className?: string }) {
  const url = useFileUrl(hash);
  return url ? <img className={className} src={url} alt="" loading="lazy" /> : <span className={`${className} empty`} aria-hidden />;
}

/** A link to a recipe's page: the recipe is made at once, and the server fills it in. */
/** A recipe from a link (read from the page on the server), or one written by hand instead. */
function ImportForm({ onDone, onWrite }: { onDone: () => void; onWrite: () => void }) {
  const { t } = useI18n();
  const { sync, user } = useSession();
  const [, navigate] = useLocation();
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = cleanUrl(url);
    if (!clean) return setProblem(t("recipes.badLink"));
    const id = sync.create("recipe", (doc) => initRecipe(doc, { source: clean, by: user.id, importing: true }));
    onDone();
    navigate(`/recipes/${id}`);
  }
  return (
    <form onSubmit={submit} className="stack">
      <p className="muted small-text">{t("recipes.importHint")}</p>
      <label className="field">
        <span>{t("recipes.link")}</span>
        <input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.ica.se/recept/…" data-autofocus />
      </label>
      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onWrite}>
          {t("recipes.writeOwn")}
        </button>
        <button type="submit" className="primary">
          {t("recipes.importGo")}
        </button>
      </div>
    </form>
  );
}
