/**
 * An ingredient line's amount, read and scaled (decision 9): "1 1/2 dl mjölk" for twice the servings is
 * "3 dl mjölk", "½ tsk salt" for half is "¼ tsk salt", "2–3 morötter" becomes "4–6 morötter". A line
 * without an amount ("salt", "smör till stekning") stays as it is.
 */

const FRACTIONS: Record<string, number> = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅕": 0.2, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };
const NICE: [number, string][] = [
  [0.125, "⅛"],
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
];

// a number: "1", "1,5", "1.5", "1 1/2", "1½", "½", "3/4" (as a regular expression's source: units.ts too)
export const NUM = String.raw`(?:\d+(?:[.,]\d+)?(?:\s*[½⅓⅔¼¾⅕⅛⅜⅝⅞]|\s+\d+\/\d+)?|\d+\/\d+|[½⅓⅔¼¾⅕⅛⅜⅝⅞])`;
const AMOUNT = new RegExp(String.raw`^(\s*(?:ca\.?\s+|cirka\s+|about\s+)?)(${NUM})(?:\s*[-–]\s*(${NUM}))?(?=\s|[a-zåäöA-ZÅÄÖ]|$)`, "i");

export function readNumber(s: string): number | null {
  const t = s.trim().replace(",", ".");
  let m = /^(\d+(?:\.\d+)?)\s*([½⅓⅔¼¾⅕⅛⅜⅝⅞])$/.exec(t);
  if (m) return Number(m[1]) + FRACTIONS[m[2]!]!;
  m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  if (t in FRACTIONS) return FRACTIONS[t]!;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** A number as a recipe writes it: "3", "1 ½", "0,4" (Swedish decimal comma where a fraction won't do). */
export function writeNumber(n: number): string {
  if (n <= 0) return "0";
  // (big amounts read better rounded: 467 g, not 466 ⅔ g)
  if (n >= 20) return String(Math.round(n));
  const whole = Math.floor(n + 1e-9);
  const rest = n - whole;
  if (rest < 0.02) return String(whole);
  for (const [v, ch] of NICE) if (Math.abs(rest - v) < 0.02) return whole ? `${whole} ${ch}` : ch;
  const r = n >= 2 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
  return String(r).replace(".", ",");
}

export interface Ingredient {
  /** the line as written */
  line: string;
  amount: number | null;
  /** "2–3": the upper end */
  upTo: number | null;
  /** what's after the amount ("dl mjölk") */
  rest: string;
}

export function readIngredient(line: string): Ingredient {
  const m = AMOUNT.exec(line);
  if (!m) return { line, amount: null, upTo: null, rest: line.trim() };
  const amount = readNumber(m[2]!);
  const upTo = m[3] ? readNumber(m[3]) : null;
  if (amount === null) return { line, amount: null, upTo: null, rest: line.trim() };
  return { line, amount, upTo, rest: line.slice(m[0].length).trim() };
}

/** A line for factor times the servings (2: twice as many). */
export function scaleLine(line: string, factor: number): string {
  if (factor === 1) return line;
  const i = readIngredient(line);
  if (i.amount === null) return line;
  const lead = AMOUNT.exec(line)![1]!;
  const amount = writeNumber(i.amount * factor);
  const upTo = i.upTo !== null ? `–${writeNumber(i.upTo * factor)}` : "";
  return `${lead}${amount}${upTo}${i.rest ? ` ${i.rest}` : ""}`;
}

/** The lines of an ingredient list worth keeping (no blanks; a heading "Sås:" stays as it is). */
export const ingredientLines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** "4 portioner", "4-6 servings", "6" → the first number, or null. */
export function readServings(s: string | number | null | undefined): number | null {
  if (typeof s === "number") return s > 0 && s < 1000 ? Math.round(s) : null;
  const m = /(\d+)/.exec(s ?? "");
  const n = m ? Number(m[1]) : NaN;
  return n > 0 && n < 1000 ? n : null;
}

/** schema.org's "PT1H30M" → 90 (minutes), or null. */
export function readDuration(iso: string | null | undefined): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec((iso ?? "").trim());
  if (!m || iso === "P" || iso === "PT") return null;
  const min = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Math.round(Number(m[4] ?? 0) / 60);
  return min > 0 ? min : null;
}
