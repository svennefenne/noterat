import { fold } from "./docs";

/**
 * What a receipt says, read from its text (decision 8): the shop, the day, and the total. The same on
 * the phone (ML Kit's text) and on the server (Tesseract's), and only ever a suggestion: people correct
 * what's wrong. Amounts are integers in öre.
 */

export interface ReceiptGuess {
  shop?: string;
  /** "YYYY-MM-DD" */
  date?: string;
  /** öre */
  total?: number;
}

// a word for the total, best first ("att betala" is what's left to pay; "totalt" may come before a discount)
const TOTAL_WORDS = ["att betala", "totalt", "total", "summa", "belopp", "betalt", "kortbetalning", "amount due", "to pay"];
// lines that aren't a shop's name
const NOT_SHOP = /(kvitto|receipt|org\.?\s*nr|orgnr|tel|telefon|www\.|http|@|moms|vat|kassa|kassör|datum|tid|\d{3}\s?\d{2}\s?[a-zåäö]|^\W*$)/i;

/** "1 234,50", "76.80", "-12,00 kr" → öre (positive), or null. */
function amount(s: string): number | null {
  const m = /(\d{1,3}(?:[ .]\d{3})+|\d+)[,.](\d{2})(?!\d)/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]!.replace(/[ .]/g, ""));
  return Number.isFinite(whole) ? whole * 100 + Number(m[2]) : null;
}

function amounts(line: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:[ .]\d{3})+|\d+)[,.](\d{2})(?!\d)/g;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const a = amount(m[0]);
    if (a !== null) out.push(a);
  }
  return out;
}

const valid = (y: number, m: number, d: number) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate();
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The first date in the text, in the ways receipts write them (a four-digit year preferred). */
function findDate(text: string): string | undefined {
  const tries: [RegExp, (m: RegExpExecArray) => [number, number, number]][] = [
    [/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/, (m) => [+m[1]!, +m[2]!, +m[3]!]],
    [/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/, (m) => [+m[3]!, +m[2]!, +m[1]!]],
    [/\b(20\d{2})(\d{2})(\d{2})\b/, (m) => [+m[1]!, +m[2]!, +m[3]!]],
    // a two-digit year: Swedish receipts write YY-MM-DD
    [/\b(\d{2})-(\d{2})-(\d{2})\b/, (m) => [2000 + +m[1]!, +m[2]!, +m[3]!]],
  ];
  for (const [re, parts] of tries) {
    const g = new RegExp(re.source, "g");
    for (let m = g.exec(text); m; m = g.exec(text)) {
      const [y, mo, d] = parts(m);
      if (valid(y, mo, d)) return iso(y, mo, d);
    }
  }
  return undefined;
}

function findTotal(lines: string[]): number | undefined {
  const folded = lines.map(fold);
  for (const word of TOTAL_WORDS) {
    const w = fold(word);
    for (let i = 0; i < lines.length; i++) {
      // ("delsumma", "momsbelopp" and the like aren't the total)
      if (!new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(folded[i]!) || /delsumma|moms|rabatt|vat/.test(folded[i]!)) continue;
      const here = amounts(lines[i]!);
      if (here.length) return here[here.length - 1];
      const next = lines[i + 1] ? amounts(lines[i + 1]!) : [];
      if (next.length) return next[0];
    }
  }
  return undefined;
}

function findShop(lines: string[]): string | undefined {
  for (const raw of lines.slice(0, 6)) {
    const line = raw.replace(/\s+/g, " ").trim();
    const letters = line.replace(/[^\p{L}]/gu, "").length;
    if (letters < 3 || NOT_SHOP.test(line) || amounts(line).length) continue;
    return line.slice(0, 60);
  }
  return undefined;
}

export function readReceipt(text: string): ReceiptGuess {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const guess: ReceiptGuess = {};
  const shop = findShop(lines);
  const date = findDate(text);
  const total = findTotal(lines);
  if (shop) guess.shop = shop;
  if (date) guess.date = date;
  if (total !== undefined) guess.total = total;
  return guess;
}

/** 7680 → "76,80" (Swedish) or "76.80". */
export function formatAmount(ore: number, lang: "sv" | "en" = "sv"): string {
  return new Intl.NumberFormat(lang === "sv" ? "sv-SE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ore / 100);
}

/** What someone typed as an amount ("76,80", "76.8", "1 234") → öre, or null. */
export function parseAmount(s: string): number | null {
  const t = s.replace(/\s|kr|sek/gi, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
