import { readDuration, readServings } from "./ingredients";
import type { ImportedRecipe } from "./recipes";

/**
 * A web page's schema.org Recipe (JSON-LD), as most recipe sites publish it (decision 9): read on the
 * server from the page it fetched. Null when the page has none.
 */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", deg: "°",
  frac12: "½", frac14: "¼", frac34: "¾", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  aring: "å", auml: "ä", ouml: "ö", Aring: "Å", Auml: "Ä", Ouml: "Ö", eacute: "é", Eacute: "É", uuml: "ü", Uuml: "Ü", aelig: "æ", oslash: "ø",
};

/** Text from what may be HTML: tags gone, entities read, spaces tidied. */
export function plainText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const isRecipe = (o: unknown): o is Record<string, unknown> => {
  const t = (o as { "@type"?: unknown } | null)?.["@type"];
  return Array.isArray(t) ? t.includes("Recipe") : t === "Recipe";
};

function findRecipe(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (isRecipe(node)) return node;
  const list = Array.isArray(node) ? node : [(node as Record<string, unknown>)["@graph"], (node as Record<string, unknown>).mainEntity].filter(Boolean);
  for (const n of list.flat()) {
    const r = findRecipe(n, depth + 1);
    if (r) return r;
  }
  return null;
}

const str = (v: unknown): string => (typeof v === "string" ? plainText(v) : typeof v === "number" ? String(v) : "");

function steps(v: unknown): string[] {
  if (typeof v === "string") return plainText(v).split("\n").filter(Boolean);
  if (!Array.isArray(v)) return v && typeof v === "object" ? steps([v]) : [];
  return v.flatMap((s): string[] => {
    if (typeof s === "string") return [plainText(s)];
    const o = (s ?? {}) as Record<string, unknown>;
    // a section ("Sås") with its own steps
    if (o["@type"] === "HowToSection" || Array.isArray(o.itemListElement)) return steps(o.itemListElement);
    return [str(o.text) || str(o.name)];
  });
}

function image(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length ? image(v[0]) : null;
  const o = (v ?? {}) as Record<string, unknown>;
  return typeof o.url === "string" ? o.url : typeof o.contentUrl === "string" ? o.contentUrl : null;
}

export function readSchemaRecipe(html: string, pageUrl: string): ImportedRecipe | null {
  // (some sites write the + as an entity: type="application/ld&#x2B;json")
  const re = /<script[^>]*type\s*=\s*["']application\/ld(?:\+|&#x2b;|&#43;|&plus;)json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    const r = findRecipe(data);
    if (!r) continue;
    const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : Array.isArray(r.ingredients) ? r.ingredients : []).map(str).filter(Boolean);
    const yields = Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield;
    const total = readDuration(str(r.totalTime)) ?? ((readDuration(str(r.prepTime)) ?? 0) + (readDuration(str(r.cookTime)) ?? 0) || null);
    let img = image(r.image);
    if (img) {
      try {
        img = new URL(img, pageUrl).toString();
      } catch {
        img = null;
      }
    }
    const recipe: ImportedRecipe = {
      title: str(r.name) || undefined,
      ingredients,
      steps: steps(r.recipeInstructions).filter(Boolean),
      servings: readServings(typeof yields === "number" ? yields : str(yields)),
      minutes: total,
      description: str(r.description) || null,
      image: img,
    };
    if (recipe.title || ingredients.length) return recipe;
  }
  return null;
}
