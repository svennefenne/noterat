import { NUM } from "./ingredients";

/**
 * A recipe someone copied from its page and pasted (decision 9): for a page that won't let the server in
 * (a site behind a wall against programs) or that has no recipe a program can see. It's read as the
 * worker reads a page by its headings, but from text: the lines under a heading such as "Ingredienser"
 * or "Ingredients", the ones under "Gör så här" or "Directions", and the title, servings and time where
 * the text says. What's around the recipe is left out: the page's story (and a blog's "what you'll need"
 * in prose), scale buttons, photo credits, notes, nutrition and reviews. A whole page pasted works too.
 */

export interface PastedRecipe {
  title?: string;
  /** a sub-heading ("Till såsen:") ends with ":" */
  ingredients: string[];
  /** a sub-heading ("For the sauce:") ends with ":" */
  steps: string[];
  servings: number | null;
  minutes: number | null;
}

// (up to three words before the word that says what a heading is: "Meatball Ingredients", "Cook's Note")
const LEAD = String.raw`^(?:[\p{L}’'´-]+\s+){0,3}`;
const INGREDIENTS = new RegExp(String.raw`${LEAD}(?:ingredien\p{L}*|zutaten|ainekset)\b|du behöver|behöver du|you(?:'|’| wi)ll need|what you need`, "iu");
const METHOD = new RegExp(
  String.raw`${LEAD}(?:instructions?|directions|method|preparation|steps|instruktion\p{L}*|tillagning|tillvägagångssätt|zubereitung|préparation)\b|^(?:gör så här|så här gör du|gör så|steg för steg|how to make)\b`,
  "iu",
);
// what comes after the recipe, or beside it: where a part ends
const AFTER = new RegExp(
  String.raw`${LEAD}(?:tips|notes?|anteckning\p{L}*|nutrition|näring\p{L}*|reviews?|recensioner|comments?|kommentarer|ratings?|betyg|video|related|liknande|substitut\p{L}*|ersättning\p{L}*|variation\p{L}*|storage|förvaring|equipment|utrustning|faq|vanliga frågor|serving suggestions?)\b|^(?:you might also|more recipes|fler recept|did you make|i made it|frequently asked|frågor och svar)`,
  "iu",
);
const STEP_MARK = /^(?:step|steg|schritt|étape)\s*\d+\s*[:.]?$|^\d{1,2}[.)]?$/i;
const STEP_NUMBER = /^(?:(?:step|steg|schritt|étape)\s*\d+\s*[:.)–-]?\s*|\d{1,2}\s*[.)]\s+)/i;
const BULLET = /^[•·▪▢☐□◦‣⁃∙*–—-]\s*/;
const AMOUNT = new RegExp(String.raw`^(?:ca\.?\s+|cirka\s+|about\s+)?${NUM}`, "i");
// an amount on a line of its own, for the ingredient on the next ("600 g" / "kycklingfilé")
const UNIT = String.raw`(?:g|kg|hg|mg|dl|cl|ml|l|msk|tsk|krm|st|cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|pinch|nypa|klyftor|klyfta|cloves?|burkar|burk|cans?|paket|förp)`;
const AMOUNT_ALONE = new RegExp(String.raw`^${NUM}(?:\s*[-–]\s*${NUM})?(?:\s*${UNIT}\.?)?$`, "iu");
// (a page's buttons, ratings and ads, between the lines)
const JUNK =
  /^(?:\d+(?:\/\d+)?\s*x|us|metric|imperial|us customary|cups|units:?|enheter:?|[−+–-]|advertisement|annons|reklam|\d[\d,. ]*\s*(?:ratings?|reviews?|photos?|comments?|betyg|recensioner|kommentarer|omdömen|röster))$/i;
// a link to a part of the page ("Skip to ingredients"), not its heading
const NAV = /^(?:skip|jump|go|hoppa|gå)\s+(?:to|till)\b/i;
// what's done to an ingredient, on a line of its own on some pages ("2 carrots" / "finely chopped")
const NOTE = /^(?:\p{Ll}[\p{L}-]*(?:ed|ly)\b|(?:to|plus|leaves|cut|at|about|or|optional|for)\b)/u;
// a part of the ingredients: "For the sauce", "Till såsen"
const PART = /^(?:for|to|till|för)\s/i;
const SERVINGS_LINE = /^(?:\d{1,3}\s*(?:portioner|servings|personer|portions|port\.?)|(?:servings|portioner|serves|yield)\s*:?\s*\d{1,3}|original recipe.*yields?\s+\d+.*)$/i;
const SERVINGS = [
  /(?:serves|servings|portioner|portions|yields?|makes|räcker till|antal portioner)\s*:?\s*(\d{1,3})\b/i,
  /\b(\d{1,3})\s*(?:portioner|servings|personer|portions|port\b)/i,
];
const SERVINGS_LABEL = /^(?:servings|serves|yield|portioner|antal portioner)\s*:?$/i;
const TIME_LABEL = /^(?:total time|total tid|totaltid|tid totalt|tidsåtgång|tid|ready in)\b\s*:?\s*(.*)$/i;
const PART_TIME_LABEL = /^(?:prep(?:aration)?(?: time)?|cook(?:ing)?(?: time)?|förberedelse(?:r|tid)?|tillagningstid)\b\s*:?\s*(.*)$/i;
const MAX_INGREDIENTS = 80;
const MAX_STEPS = 40;
const HEADING_MAX = 60;

type Kind = "ingredients" | "method" | "after" | null;

const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
const sentenceEnd = (s: string) => /[.!?]$/.test(s);
const words = (s: string) => s.split(/\s+/).length;

/** Whether a line can be a heading (short, no sentence) and which kind. */
function kindOf(line: string): Kind {
  if (line.length > HEADING_MAX || AMOUNT.test(line) || /[.!?]$/.test(line) || line.split(/\s+/).length > 8) return null;
  if (STEP_MARK.test(line) || NAV.test(line)) return null;
  const s = line.replace(/:$/, "");
  if (AFTER.test(s)) return "after";
  if (INGREDIENTS.test(s)) return "ingredients";
  if (METHOD.test(s)) return "method";
  return null;
}

/** The pasted text's lines: whitespace made plain, bullets off, and an amount alone joined to its ingredient. */
function linesOf(text: string): string[] {
  const raw = text
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .split(/\r?\n|\r/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i]!.replace(BULLET, "");
    const next = raw[i + 1];
    if (next && AMOUNT_ALONE.test(l) && !AMOUNT.test(next) && letters(next) > 1 && !kindOf(next) && !next.endsWith(":")) {
      out.push(`${l} ${next.replace(BULLET, "")}`);
      i++;
    } else if (l) out.push(l);
  }
  return out;
}

/** How much a part looks like an ingredient list: lines with an amount count twice, short ones once. */
function ingredientScore(lines: string[]): number {
  let score = 0;
  let found = 0;
  // (each line once: a carousel of other recipes says the same things again and again)
  for (const l of new Set(lines.filter((x) => !JUNK.test(x) && !SERVINGS_LINE.test(x)))) {
    if (l.length > 100) continue;
    if (AMOUNT.test(l)) {
      score += 2;
      found++;
    } else if (l.split(/\s+/).length <= 8 && !sentenceEnd(l) && !l.endsWith(":")) {
      score += 1;
      found++;
    }
  }
  return found >= 2 ? score : 0;
}

function ingredientsOf(part: string[]): string[] {
  const lines = part.filter((l) => !JUNK.test(l) && !SERVINGS_LINE.test(l) && letters(l) >= 2 && l.length <= 160 && !(sentenceEnd(l) && words(l) >= 7));
  // (a page that puts what's done to an ingredient on a line of its own does it all through)
  const notes = lines.filter((l, i) => i > 0 && NOTE.test(l) && AMOUNT.test(lines[i - 1]!)).length;
  const out: string[] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (notes >= 3 && last && !last.endsWith(":") && NOTE.test(l)) out[out.length - 1] = `${last}, ${l}`;
    else if (PART.test(l) && /^\p{Lu}/u.test(l) && !AMOUNT.test(l) && !l.includes(":") && l.length <= 40) out.push(`${l}:`);
    else out.push(l);
  }
  return out.slice(0, MAX_INGREDIENTS);
}

function stepsOf(lines: string[]): string[] {
  // (a short line that comes back, as a photo credit after each step does, isn't one)
  const seen = new Map<string, number>();
  for (const l of lines) seen.set(l, (seen.get(l) ?? 0) + 1);
  return lines
    .filter((l) => !STEP_MARK.test(l) && !JUNK.test(l) && !(l.length <= HEADING_MAX && (seen.get(l) ?? 0) > 1))
    .map((l) => l.replace(STEP_NUMBER, "").trim())
    .filter((l) => letters(l) >= 3)
    .slice(0, MAX_STEPS);
}

/** "1 hr 15 mins", "45 min", "1 timme" → minutes, or null. */
function readTime(s: string): number | null {
  const h = /(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?|tim|timmar|timme|t)\b/i.exec(s);
  const m = /(\d+)\s*(?:m|min|mins|minutes?|minuter)\b/i.exec(s);
  const min = (h ? Math.round(Number(h[1]!.replace(",", ".")) * 60) : 0) + (m ? Number(m[1]) : 0);
  return min > 0 && min < 10_000 ? min : null;
}

function servingsIn(lines: string[]): number | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (SERVINGS_LABEL.test(l) && /^\d{1,3}$/.test(lines[i + 1] ?? "")) return Number(lines[i + 1]) || null;
    for (const re of SERVINGS) {
      const n = Number(re.exec(l)?.[1]);
      if (n > 0 && n < 1000) return n;
    }
  }
  return null;
}

/** The total time, else the time to prepare and to cook added up. */
function minutesIn(lines: string[]): number | null {
  const parts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const total = TIME_LABEL.exec(lines[i]!);
    const part = PART_TIME_LABEL.exec(lines[i]!);
    const min = total || part ? readTime((total ?? part)![1] || lines[i + 1] || "") : null;
    if (min && total) return min;
    if (min && part && parts.length < 2) parts.push(min);
  }
  return parts.length === 2 ? parts[0]! + parts[1]! : null;
}

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

// (a word, by its first five letters: "kycklinggryta" and "kycklingfilé" are about the same thing)
const stems = (s: string) => new Set(plain(s).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));

/**
 * The recipe's title among the lines before it: the one its link names, else the one that talks about
 * what's in the recipe (not the site's own links and buttons), else the first that can be one.
 */
function titleIn(lines: string[], recipe: string[], source?: string): string | undefined {
  const can = lines.filter(
    (l) =>
      l.length >= 2 &&
      l.length <= 100 &&
      letters(l) >= 2 &&
      // (a site's breadcrumbs and buttons are in capitals; a rating, a count or a date starts with a number)
      l !== l.toUpperCase() &&
      !/^[\d(]/.test(l) &&
      !/[.:!?,]$/.test(l) &&
      !kindOf(l) &&
      !NAV.test(l) &&
      !TIME_LABEL.test(l) &&
      !SERVINGS_LINE.test(l),
  );
  if (!can.length) return undefined;
  if (source) {
    let words: string[] = [];
    try {
      words = plain(new URL(source).pathname).filter((w) => !/^\d+$/.test(w) && !["recipe", "recipes", "recept"].includes(w));
    } catch {
      /* (no link to go by) */
    }
    if (words.length) {
      let best: string | undefined;
      let most = 0;
      for (const l of can) {
        const w = plain(l);
        const n = words.filter((x) => w.includes(x)).length;
        if (n > most) [best, most] = [l, n];
      }
      if (best && most * 2 >= words.length) return best;
    }
  }
  const inRecipe = stems(recipe.join(" "));
  let best = can[0];
  let most = 0;
  for (const l of can) {
    const n = [...stems(l)].filter((w) => inRecipe.has(w)).length;
    if (n > most) [best, most] = [l, n];
  }
  return best;
}

/** A pasted recipe's parts, or null when there's no ingredient or step to be found. */
export function readRecipeText(text: string, o: { source?: string } = {}): PastedRecipe | null {
  const lines = linesOf(text);
  const kinds = lines.map(kindOf);
  // (a part starts after its heading, and after any heading right after it: a row of tabs)
  const partFrom = (i: number) => {
    let from = i + 1;
    while (from < lines.length && kinds[from]) from++;
    let end = from;
    while (end < lines.length && !kinds[end]) end++;
    return { from, to: end };
  };

  // the ingredients: the part under an ingredients heading that looks most like a list of them
  let best: { at: number; from: number; to: number; score: number } | null = null;
  kinds.forEach((k, i) => {
    if (k !== "ingredients") return;
    const part = partFrom(i);
    const score = ingredientScore(lines.slice(part.from, part.to));
    if (score && (!best || score > best.score)) best = { at: i, ...part, score };
  });
  const found = best as { at: number; from: number; to: number; score: number } | null;

  let ingredients: string[] = [];
  let steps: string[] = [];
  let before: string[];
  let head: string[];
  if (found) {
    ingredients = ingredientsOf(lines.slice(found.from, found.to));
    // the method: under a method heading after the ingredients, else any
    const methods = kinds.map((k, i) => (k === "method" ? i : -1)).filter((i) => i >= 0);
    for (const at of [...methods.filter((i) => i > found.at), ...methods.filter((i) => i < found.at)]) {
      const part = partFrom(at);
      steps = stepsOf(lines.slice(part.from, part.to));
      if (steps.length) break;
    }
    // (no method heading: the sentences after the ingredients, up to whatever comes after the recipe)
    if (!methods.length) {
      let end = found.to;
      while (end < lines.length && kinds[end] !== "after") end++;
      steps = stepsOf(lines.slice(found.to, end).filter((l) => STEP_NUMBER.test(l) || (l.length >= 25 && sentenceEnd(l))));
    }
    before = lines.slice(0, found.at);
    head = lines.slice(0, Math.max(found.to, ...methods.filter((i) => i > found.at).slice(0, 1)));
  } else {
    // no heading to go by: lines with an amount (or a bullet) are ingredients, sentences after them steps
    const first = lines.findIndex((l) => AMOUNT.test(l) && !STEP_NUMBER.test(l) && l.length <= 100);
    if (first < 0) {
      steps = stepsOf(lines.filter((l) => STEP_NUMBER.test(l) && !kindOf(l)));
      before = [];
    } else {
      const rest = lines.slice(first).filter((l) => !kindOf(l));
      ingredients = ingredientsOf(rest.filter((l) => AMOUNT.test(l) && !STEP_NUMBER.test(l) && l.length <= 100));
      steps = stepsOf(rest.filter((l) => STEP_NUMBER.test(l) || (!AMOUNT.test(l) && l.length >= 25 && sentenceEnd(l))));
      before = lines.slice(0, first);
    }
    head = lines;
  }
  if (!ingredients.length && !steps.length) return null;
  return {
    title: titleIn(before, [...ingredients, ...steps], o.source),
    ingredients,
    steps,
    servings: servingsIn(head),
    minutes: minutesIn(head),
  };
}

/** Steps as the recipe keeps them (Markdown): numbered, a sub-heading in bold between. */
export function writeSteps(steps: string[]): string {
  const out: string[] = [];
  let n = 0;
  for (const s of steps) {
    if (s.endsWith(":") && s.length <= HEADING_MAX) out.push("", `**${s.slice(0, -1).trim()}**`, "");
    else out.push(`${++n}. ${s}`);
  }
  return out.join("\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n").trim();
}
