/**
 * A bank's CSV export, read (decision 11). Swedish banks write it in their own ways: semicolons or
 * commas, a decimal comma, "1 234,50", dates as 2026-11-14 or 14.11.2026, sometimes a line or two
 * before the header. The columns are found by their names; what isn't found is asked for.
 */

/** Rows of cells, quotes and all ("a;b", "say ""hi"""), separated by what the file uses. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const firstLines = t.split("\n").slice(0, 5).join("\n");
  const sep = [";", "\t", ","].map((s) => [s, firstLines.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      if (row.some((c) => c)) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c)) rows.push(row);
  return rows;
}

/** "-1 234,50", "1.234,50", "−12.5", "1 234,50 kr" → öre, or null. */
export function readAmount(s: string): number | null {
  let t = s.replace(/\s|kr|sek|\u00a0/gi, "").replace(/−/g, "-");
  if (!t) return null;
  // (with both, the last one is the decimal mark: "1.234,50" or "1,234.50")
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** "2026-11-14", "26-11-14", "14.11.2026", "14/11/2026", "20261114" → "2026-11-14", or null. */
export function readDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return `20${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

export interface Columns {
  date: number;
  amount: number;
  text: number;
}

const DATE_NAMES = ["transaktionsdag", "transaktionsdatum", "bokföringsdag", "bokföringsdatum", "bokförd", "datum", "reskontradatum", "date"];
const AMOUNT_NAMES = ["belopp", "summa", "amount"];
const TEXT_NAMES = ["beskrivning", "text", "rubrik", "meddelande", "mottagare", "namn", "transaktion", "description", "specifikation", "referens"];

const find = (header: string[], names: string[]) => {
  const h = header.map((c) => c.toLowerCase().trim());
  for (const n of names) {
    const i = h.findIndex((c) => c === n || c.startsWith(n));
    if (i >= 0) return i;
  }
  return -1;
};

/** Where the header is (the first row naming a date and an amount), and which columns are which. */
export function findColumns(rows: string[][]): { headerRow: number; columns: Columns | null } {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const date = find(rows[r]!, DATE_NAMES);
    const amount = find(rows[r]!, AMOUNT_NAMES);
    if (date >= 0 && amount >= 0) return { headerRow: r, columns: { date, amount, text: find(rows[r]!, TEXT_NAMES) } };
  }
  return { headerRow: -1, columns: null };
}

export interface ImportedRow {
  date: string;
  /** öre; negative is money out */
  amount: number;
  text: string;
  /** the same row from another export of an overlapping period gets the same key */
  key: string;
}

/** The rows below the header as transactions (rows that aren't, such as a sum at the end, left out). */
export function toTransactions(rows: string[][], headerRow: number, c: Columns): ImportedRow[] {
  const seen = new Map<string, number>();
  const out: ImportedRow[] = [];
  for (const row of rows.slice(headerRow + 1)) {
    const date = readDate(row[c.date] ?? "");
    const amount = readAmount(row[c.amount] ?? "");
    if (!date || amount === null) continue;
    const text = c.text >= 0 ? (row[c.text] ?? "").replace(/\s+/g, " ").trim() : "";
    const base = `${date}|${amount}|${text.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ date, amount, text, key: `${base}|${n}` });
  }
  return out;
}
