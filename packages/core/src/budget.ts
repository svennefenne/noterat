import * as Y from "yjs";
import type { ImportedRow } from "./csv";
import { newObjectId } from "./docs";

/**
 * A budget (decision 11): a household's money, month by month. Its document:
 *
 * - meta: title, method ("envelope": what's left of a category carries over; "zero": every krona of
 *   income is given a job), createdBy, createdAt
 * - categories: id → { name, group, kind ("income" | "expense"), order }
 * - plans: "YYYY-MM" → a Y.Map of category id → planned öre
 * - transactions: id → a Y.Map { date, amount (öre, negative is money out), text, category, note,
 *   scan (a receipt's scan id), key (an imported row's, so a second import doesn't double it) }
 * - rules: a transaction's text (lower case) → the category it was last put in, to suggest it next time
 * - recurring: id → { name, amount, category, day, every ("month" | "year"), month (for "year") }
 * - goals: id → { name, target, saved }
 *
 * Amounts are integers in öre throughout.
 */

export type BudgetMethod = "envelope" | "zero";

export interface Category {
  id: string;
  name: string;
  group: string;
  kind: "income" | "expense";
  order: number;
}

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  text: string;
  category: string;
  note: string;
  scan: string;
  key: string;
}

export interface Recurring {
  id: string;
  name: string;
  amount: number;
  category: string;
  day: number;
  every: "month" | "year";
  month: number;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
}

export interface BudgetView {
  title: string;
  method: BudgetMethod;
  categories: Category[];
  transactions: Transaction[];
  plans: Record<string, Record<string, number>>;
  rules: Record<string, string>;
  recurring: Recurring[];
  goals: Goal[];
}

const meta = (doc: Y.Doc) => doc.getMap<unknown>("meta");
const categoriesMap = (doc: Y.Doc) => doc.getMap<Omit<Category, "id">>("categories");
const plansMap = (doc: Y.Doc) => doc.getMap<Y.Map<number>>("plans");
const txMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("transactions");
const rulesMap = (doc: Y.Doc) => doc.getMap<string>("rules");
const recurringMap = (doc: Y.Doc) => doc.getMap<Omit<Recurring, "id">>("recurring");
const goalsMap = (doc: Y.Doc) => doc.getMap<Omit<Goal, "id">>("goals");

/** A household's categories to start from (renamed, removed or added to as they like). */
export const DEFAULT_CATEGORIES: [group: string, kind: Category["kind"], names: string[]][] = [
  ["Inkomster", "income", ["Lön", "Barnbidrag", "Övriga inkomster"]],
  ["Boende", "expense", ["Hyra/avgift", "El", "Bredband & mobil", "Hemförsäkring"]],
  ["Vardag", "expense", ["Mat & hushåll", "Restaurang & fika", "Transport", "Kläder", "Hälsa"]],
  ["Barn", "expense", ["Barn"]],
  ["Fritid", "expense", ["Nöje & hobby", "Resor", "Prenumerationer"]],
  ["Sparande", "expense", ["Sparande", "Buffert"]],
  ["Övrigt", "expense", ["Övrigt"]],
];

export function initBudget(doc: Y.Doc, o: { title: string; method: BudgetMethod; by: number; categories?: typeof DEFAULT_CATEGORIES }) {
  doc.transact(() => {
    meta(doc).set("title", o.title.trim().slice(0, 80));
    meta(doc).set("method", o.method);
    meta(doc).set("createdBy", o.by);
    meta(doc).set("createdAt", Date.now());
    let order = 0;
    for (const [group, kind, names] of o.categories ?? DEFAULT_CATEGORIES) for (const name of names) categoriesMap(doc).set(newObjectId(), { name, group, kind, order: order++ });
  });
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);

export function readBudget(doc: Y.Doc): BudgetView {
  const plans: BudgetView["plans"] = {};
  for (const [month, m] of plansMap(doc)) if (m instanceof Y.Map) plans[month] = Object.fromEntries([...m.entries()].map(([k, v]) => [k, num(v)]));
  const transactions: Transaction[] = [];
  for (const [id, m] of txMap(doc)) {
    if (!(m instanceof Y.Map)) continue;
    const date = str(m.get("date"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    transactions.push({ id, date, amount: num(m.get("amount")), text: str(m.get("text")), category: str(m.get("category")), note: str(m.get("note")), scan: str(m.get("scan")), key: str(m.get("key")) });
  }
  return {
    title: str(meta(doc).get("title")),
    method: meta(doc).get("method") === "zero" ? "zero" : "envelope",
    categories: [...categoriesMap(doc).entries()].map(([id, c]) => ({ id, ...c })).sort((a, b) => a.order - b.order),
    transactions: transactions.sort((a, b) => b.date.localeCompare(a.date) || a.text.localeCompare(b.text)),
    plans,
    rules: Object.fromEntries(rulesMap(doc).entries()),
    recurring: [...recurringMap(doc).entries()].map(([id, r]) => ({ id, ...r })),
    goals: [...goalsMap(doc).entries()].map(([id, g]) => ({ id, ...g })),
  };
}

// ───────────── changing it ─────────────

export function setBudgetMeta(doc: Y.Doc, patch: { title?: string; method?: BudgetMethod }) {
  doc.transact(() => {
    if (patch.title !== undefined) meta(doc).set("title", patch.title.trim().slice(0, 80));
    if (patch.method) meta(doc).set("method", patch.method);
  });
}

export function setCategory(doc: Y.Doc, id: string | null, c: Omit<Category, "id" | "order"> & { order?: number }): string {
  const key = id ?? newObjectId();
  const was = categoriesMap(doc).get(key);
  categoriesMap(doc).set(key, { name: c.name.trim().slice(0, 60), group: c.group.trim().slice(0, 60), kind: c.kind, order: c.order ?? was?.order ?? categoriesMap(doc).size });
  return key;
}

export function removeCategory(doc: Y.Doc, id: string) {
  categoriesMap(doc).delete(id);
}

/** A category's plan for a month (0 or less: none). */
export function setPlan(doc: Y.Doc, month: string, category: string, amount: number) {
  doc.transact(() => {
    let m = plansMap(doc).get(month);
    if (!m) {
      m = new Y.Map<number>();
      plansMap(doc).set(month, m);
    }
    if (amount) m.set(category, Math.round(amount));
    else m.delete(category);
  });
}

/** Last month's plan copied into a month (for the categories it has nothing planned for yet). */
export function copyPlan(doc: Y.Doc, from: string, to: string) {
  const src = readBudget(doc).plans[from] ?? {};
  doc.transact(() => {
    for (const [cat, amount] of Object.entries(src)) if (!(readBudget(doc).plans[to] ?? {})[cat]) setPlan(doc, to, cat, amount);
  });
}

const normalize = (text: string) => text.toLowerCase().replace(/\d{3,}/g, "").replace(/\s+/g, " ").trim();

/** The category a transaction's text was put in last time, if any. */
export const suggestCategory = (view: BudgetView, text: string) => view.rules[normalize(text)] ?? "";

export function addTransaction(doc: Y.Doc, t: Partial<Omit<Transaction, "id">> & { date: string; amount: number }): string {
  const id = newObjectId();
  const m = new Y.Map<unknown>();
  doc.transact(() => {
    txMap(doc).set(id, m);
    for (const [k, v] of Object.entries({ text: "", category: "", note: "", scan: "", key: "", ...t })) m.set(k, v);
  });
  return id;
}

export function updateTransaction(doc: Y.Doc, id: string, patch: Partial<Omit<Transaction, "id">>) {
  const m = txMap(doc).get(id);
  if (!m) return;
  doc.transact(() => {
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) m.set(k, v);
    // (the text's category is remembered, to suggest it for the next one)
    if (patch.category !== undefined) {
      const text = normalize(str(m.get("text")));
      if (text && patch.category) rulesMap(doc).set(text, patch.category);
    }
  });
}

export function removeTransaction(doc: Y.Doc, id: string) {
  txMap(doc).delete(id);
}

/**
 * A bank's rows into the budget: those not imported before (by their key), each in the category its
 * text was put in before. Returns how many were added and how many were there already.
 */
export function importRows(doc: Y.Doc, rows: ImportedRow[]): { added: number; skipped: number } {
  const view = readBudget(doc);
  const have = new Set(view.transactions.map((t) => t.key).filter(Boolean));
  let added = 0;
  doc.transact(() => {
    for (const r of rows) {
      if (have.has(r.key)) continue;
      have.add(r.key);
      addTransaction(doc, { date: r.date, amount: r.amount, text: r.text, key: r.key, category: suggestCategory(view, r.text) });
      added++;
    }
  });
  return { added, skipped: rows.length - added };
}

// ───────────── receipts ─────────────

/** Transactions a receipt could be (same amount out, within three days, without a receipt yet). */
export function receiptMatches(view: BudgetView, r: { date?: string; total?: number }): Transaction[] {
  if (!r.total) return [];
  const day = r.date ? Date.parse(`${r.date}T12:00:00Z`) : NaN;
  return view.transactions.filter((t) => !t.scan && t.amount === -r.total! && (Number.isNaN(day) || Math.abs(Date.parse(`${t.date}T12:00:00Z`) - day) <= 3 * 86_400_000));
}

/** A receipt as a transaction of its own (none matched): money out, its shop as the text. */
export const transactionFromReceipt = (scanId: string, r: { shop?: string; date?: string; total?: number }, today: string) => ({ date: r.date ?? today, amount: -(r.total ?? 0), text: r.shop ?? "", scan: scanId });

// ───────────── recurring items and goals ─────────────

export function setRecurring(doc: Y.Doc, id: string | null, r: Omit<Recurring, "id">): string {
  const key = id ?? newObjectId();
  recurringMap(doc).set(key, { ...r, name: r.name.trim().slice(0, 80), day: Math.min(31, Math.max(1, Math.round(r.day))) });
  return key;
}

export const removeRecurring = (doc: Y.Doc, id: string) => recurringMap(doc).delete(id);

/** The recurring items due in a month (a yearly one only in its month). */
export const recurringIn = (view: BudgetView, month: string) => view.recurring.filter((r) => r.every === "month" || r.month === Number(month.slice(5)));

export function setGoal(doc: Y.Doc, id: string | null, g: Omit<Goal, "id">): string {
  const key = id ?? newObjectId();
  goalsMap(doc).set(key, { name: g.name.trim().slice(0, 80), target: Math.max(0, Math.round(g.target)), saved: Math.max(0, Math.round(g.saved)) });
  return key;
}

export const removeGoal = (doc: Y.Doc, id: string) => goalsMap(doc).delete(id);

// ───────────── a month, summed up ─────────────

export interface CategoryMonth {
  category: Category;
  planned: number;
  /** money out (positive) or in, in the month */
  spent: number;
  /** envelope: what's left, with what earlier months left over; zero-based: planned − spent */
  available: number;
}

export interface MonthSummary {
  month: string;
  income: number;
  spending: number;
  planned: number;
  /** zero-based: income not yet given a job (income − planned) */
  toAssign: number;
  /** transactions without a category */
  uncategorized: number;
  categories: CategoryMonth[];
}

const monthOf = (date: string) => date.slice(0, 7);

export function monthSummary(view: BudgetView, month: string): MonthSummary {
  const months = [...new Set([...Object.keys(view.plans), ...view.transactions.map((t) => monthOf(t.date))])].filter((m) => m <= month).sort();
  const spentIn = (cat: string, m: string) => view.transactions.filter((t) => t.category === cat && monthOf(t.date) === m).reduce((n, t) => n - t.amount, 0);
  const inMonth = view.transactions.filter((t) => monthOf(t.date) === month);
  const categories = view.categories.map((category) => {
    const planned = view.plans[month]?.[category.id] ?? 0;
    const spent = spentIn(category.id, month);
    const before = view.method === "envelope" && category.kind === "expense" ? months.filter((m) => m < month).reduce((n, m) => n + (view.plans[m]?.[category.id] ?? 0) - spentIn(category.id, m), 0) : 0;
    return { category, planned, spent, available: before + planned - spent };
  });
  const income = inMonth.filter((t) => t.amount > 0).reduce((n, t) => n + t.amount, 0);
  const spending = inMonth.filter((t) => t.amount < 0).reduce((n, t) => n - t.amount, 0);
  const planned = categories.filter((c) => c.category.kind === "expense").reduce((n, c) => n + c.planned, 0);
  return { month, income, spending, planned, toAssign: income - planned, uncategorized: inMonth.filter((t) => !t.category).length, categories };
}

/** Money out per category per month, for the last `count` months up to `month`. */
export function spendingReport(view: BudgetView, month: string, count = 6): { months: string[]; rows: { category: Category; perMonth: number[] }[] } {
  const months: string[] = [];
  const d = new Date(`${month}-15T12:00:00Z`);
  for (let i = count - 1; i >= 0; i--) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 15));
    months.push(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const rows = view.categories
    .filter((c) => c.kind === "expense")
    .map((category) => ({ category, perMonth: months.map((m) => view.transactions.filter((t) => t.category === category.id && monthOf(t.date) === m).reduce((n, t) => n - t.amount, 0)) }))
    .filter((r) => r.perMonth.some((n) => n));
  return { months, rows };
}
