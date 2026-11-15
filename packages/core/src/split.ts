import * as Y from "yjs";
import { newObjectId } from "./docs";

/**
 * Splitting costs (decision 13): a trip, a dinner, a shared house, where some paid for everyone and it's
 * time to settle. Its document, split/<id>:
 *
 * - meta: title, createdBy (user id), createdAt
 * - people: id → Y.Map { name, phone (for Swish), email, userId (an account on the server, or 0 for
 *   someone without one), order }
 * - expenses: id → Y.Map { date, text, amount (öre), paidBy (a person's id), mode, parts (JSON: person id
 *   → 1 for "equal", a whole-number weight for "shares", öre for "exact"), scan (a scanned receipt's id,
 *   or ""), createdBy, createdAt }
 * - payments: id → { from, to, amount, date }: money that has changed hands since (a settled transfer)
 * - sends: id → { at, by, to (person ids), lang }: when the summary was mailed out
 *
 * Amounts are integers in öre throughout. A person's balance is what they paid and gave, minus their share
 * and what they got: positive is owed to them. Settling pays the largest debts to the largest claims first,
 * so a group of n settles in at most n − 1 payments.
 */

export type SplitMode = "equal" | "shares" | "exact";

export interface SplitPerson {
  id: string;
  name: string;
  phone: string;
  email: string;
  userId: number;
  order: number;
}

export interface SplitExpense {
  id: string;
  date: string;
  text: string;
  amount: number;
  paidBy: string;
  mode: SplitMode;
  parts: Record<string, number>;
  /** the scanned receipt it came from ("" for none) */
  scan: string;
  createdBy: number;
  createdAt: number;
}

export interface SplitPayment {
  id: string;
  from: string;
  to: string;
  amount: number;
  date: string;
}

export interface SplitSend {
  id: string;
  at: number;
  by: string;
  to: string[];
}

export interface SplitView {
  title: string;
  createdBy: number;
  people: SplitPerson[];
  expenses: SplitExpense[];
  payments: SplitPayment[];
  sends: SplitSend[];
}

export interface Balance {
  person: SplitPerson;
  /** what they paid for everyone */
  paid: number;
  /** their part of it all */
  share: number;
  /** payments they've made (+) and had (−) since */
  settled: number;
  /** paid − share + settled: positive is owed to them, negative they owe */
  net: number;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export const NAME_MAX = 60;
export const TEXT_MAX = 120;
/** (a sane ceiling: 10 million kronor) */
export const AMOUNT_MAX = 1_000_000_000;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

const meta = (doc: Y.Doc) => doc.getMap("meta");
const peopleOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("people");
const expensesOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("expenses");
const paymentsOf = (doc: Y.Doc) => doc.getMap<SplitPayment>("payments");
const sendsOf = (doc: Y.Doc) => doc.getMap<SplitSend>("sends");

// ───────────── people's details ─────────────

/** An e-mail address that could be one (one address, nothing that would make it two). */
export const validEmail = (email: string) => email.length <= 254 && /^[^\s@,;:<>()[\]"\\]+@[^\s@,;:<>()[\]"\\]+\.[^\s@,;:<>()[\]"\\]{2,}$/.test(email);

/**
 * A phone number as Swish takes it, or "" if it isn't one: a Swedish mobile number (07…, also written
 * +46 7… or 0046 7…) or a Swish number of a business or association (123…, 10 digits).
 */
export function swishNumber(phone: string): string {
  let d = phone.replace(/[\s\-().]/g, "");
  if (d.startsWith("+46")) d = `0${d.slice(3)}`;
  else if (d.startsWith("0046")) d = `0${d.slice(4)}`;
  else if (/^467\d{8}$/.test(d)) d = `0${d.slice(2)}`;
  if (/^07\d{8}$/.test(d)) return d;
  if (/^123\d{7}$/.test(d)) return d;
  return "";
}

/** 0701234567 → 070-123 45 67 (as Swedes write a mobile number); others as they are. */
export function formatPhone(phone: string): string {
  const n = swishNumber(phone);
  if (/^07\d{8}$/.test(n)) return `${n.slice(0, 3)}-${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;
  if (/^123\d{7}$/.test(n)) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;
  return phone.trim();
}

/** Swish's message: at most 50 characters, of the ones it allows (letters, digits, and !?(),.-:; and space). */
export function swishMessage(text: string): string {
  return text
    .replace(/[^0-9A-Za-zÅÄÖåäöÉéÜü!?(),.\-:; ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50)
    .trim();
}

/**
 * A Swish QR code's text, payee, amount and message filled in and locked (Swish's own "C" format, which
 * the Swish app's scanner reads, for a private mobile number too): C0701234567;1861,12;Fjallresan;0. The
 * message is in plain letters: a QR code doesn't say which character set its text is in, and a reader
 * guessing wrong turns "ä" into something else.
 */
export function swishQrText(o: { to: string; amount: number; message: string }): string {
  const amount = `${Math.floor(o.amount / 100)},${String(o.amount % 100).padStart(2, "0")}`;
  const plain = swishMessage(o.message)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return `C${swishNumber(o.to)};${amount};${plain};0`;
}

/** A link that opens the Swish app with the payment filled in, for someone reading on their phone. */
export function swishLink(o: { to: string; amount: number; message: string }): string {
  const q = new URLSearchParams({
    sw: swishNumber(o.to),
    amt: (o.amount / 100).toFixed(2),
    cur: "SEK",
    msg: swishMessage(o.message),
    src: "qr",
  });
  return `https://app.swish.nu/1/p/sw/?${q.toString()}`;
}

// ───────────── the document ─────────────

export function initSplit(doc: Y.Doc, o: { title: string; by: number; me: { name: string; phone?: string; email?: string } }) {
  doc.transact(() => {
    meta(doc).set("title", str(o.title, 80));
    meta(doc).set("createdBy", o.by);
    meta(doc).set("createdAt", Date.now());
    addPerson(doc, { name: o.me.name, phone: o.me.phone ?? "", email: o.me.email ?? "", userId: o.by });
  });
}

export function setSplitTitle(doc: Y.Doc, title: string) {
  meta(doc).set("title", str(title, 80));
}

function readPerson(id: string, m: Y.Map<unknown>): SplitPerson {
  return { id, name: str(m.get("name"), NAME_MAX), phone: str(m.get("phone"), 30), email: str(m.get("email"), 254), userId: int(m.get("userId")), order: int(m.get("order")) };
}

export function addPerson(doc: Y.Doc, p: { name: string; phone?: string; email?: string; userId?: number }): string {
  const id = newObjectId();
  const people = peopleOf(doc);
  const order = Math.max(0, ...[...people.values()].map((m) => int(m.get("order")) + 1));
  const m = new Y.Map<unknown>();
  doc.transact(() => {
    people.set(id, m);
    m.set("name", str(p.name, NAME_MAX));
    m.set("phone", str(p.phone, 30));
    m.set("email", str(p.email, 254).toLowerCase());
    m.set("userId", p.userId ?? 0);
    m.set("order", order);
  });
  return id;
}

export function updatePerson(doc: Y.Doc, id: string, patch: Partial<Pick<SplitPerson, "name" | "phone" | "email">>) {
  const m = peopleOf(doc).get(id);
  if (!m) return;
  doc.transact(() => {
    if (patch.name !== undefined) m.set("name", str(patch.name, NAME_MAX));
    if (patch.phone !== undefined) m.set("phone", str(patch.phone, 30));
    if (patch.email !== undefined) m.set("email", str(patch.email, 254).toLowerCase());
  });
}

/** Whether a person is in any expense or payment (and so can't be removed without changing them). */
export function personInUse(v: SplitView, id: string): boolean {
  return v.expenses.some((e) => e.paidBy === id || (e.parts[id] ?? 0) > 0) || v.payments.some((p) => p.from === id || p.to === id);
}

export function removePerson(doc: Y.Doc, id: string) {
  if (personInUse(readSplit(doc), id)) return false;
  peopleOf(doc).delete(id);
  return true;
}

function readParts(v: unknown): Record<string, number> {
  if (typeof v !== "string") return {};
  try {
    const o = JSON.parse(v) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).flatMap(([k, n]) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? [[k, Math.round(n)]] : [])));
  } catch {
    return {};
  }
}

function readExpense(id: string, m: Y.Map<unknown>): SplitExpense {
  const mode = m.get("mode");
  return {
    id,
    date: isDate(m.get("date")) ? (m.get("date") as string) : "",
    text: str(m.get("text"), TEXT_MAX),
    amount: Math.max(0, Math.min(AMOUNT_MAX, int(m.get("amount")))),
    paidBy: str(m.get("paidBy"), 64),
    mode: mode === "shares" || mode === "exact" ? mode : "equal",
    parts: readParts(m.get("parts")),
    scan: str(m.get("scan"), 64),
    createdBy: int(m.get("createdBy")),
    createdAt: int(m.get("createdAt")),
  };
}

export interface ExpenseInput {
  date: string;
  text: string;
  amount: number;
  paidBy: string;
  mode: SplitMode;
  parts: Record<string, number>;
  /** a scanned receipt's id; left as it was when not given */
  scan?: string;
}

function writeExpense(m: Y.Map<unknown>, e: ExpenseInput) {
  m.set("date", isDate(e.date) ? e.date : today());
  m.set("text", str(e.text, TEXT_MAX));
  m.set("amount", Math.max(0, Math.min(AMOUNT_MAX, int(e.amount))));
  m.set("paidBy", e.paidBy);
  m.set("mode", e.mode);
  m.set("parts", JSON.stringify(Object.fromEntries(Object.entries(e.parts).filter(([, n]) => n > 0).map(([k, n]) => [k, Math.round(n)]))));
  if (e.scan !== undefined) m.set("scan", e.scan);
}

/**
 * A scanned receipt as an expense in a split: the shop, the day and the total, paid by `paidBy`, split
 * equally among everyone (changed afterwards like any other expense), tied to the scan.
 */
export function expenseFromReceipt(v: SplitView, scan: string, r: { shop?: string; date?: string; total?: number }, paidBy: string, today: string): ExpenseInput {
  return {
    date: r.date && isDate(r.date) ? r.date : today,
    text: r.shop ?? "",
    amount: r.total ?? 0,
    paidBy,
    mode: "equal",
    parts: Object.fromEntries(v.people.map((p) => [p.id, 1])),
    scan,
  };
}

export function addExpense(doc: Y.Doc, e: ExpenseInput, by: number): string {
  const id = newObjectId();
  const m = new Y.Map<unknown>();
  doc.transact(() => {
    expensesOf(doc).set(id, m);
    writeExpense(m, e);
    m.set("createdBy", by);
    m.set("createdAt", Date.now());
  });
  return id;
}

export function updateExpense(doc: Y.Doc, id: string, e: ExpenseInput) {
  const m = expensesOf(doc).get(id);
  if (m) doc.transact(() => writeExpense(m, e));
}

export function removeExpense(doc: Y.Doc, id: string) {
  expensesOf(doc).delete(id);
}

/** Money that has changed hands: a transfer settled (or part of one). */
export function addPayment(doc: Y.Doc, p: Omit<SplitPayment, "id">): string {
  const id = newObjectId();
  paymentsOf(doc).set(id, { id, from: p.from, to: p.to, amount: Math.max(0, int(p.amount)), date: isDate(p.date) ? p.date : today() });
  return id;
}

export function removePayment(doc: Y.Doc, id: string) {
  paymentsOf(doc).delete(id);
}

export function logSend(doc: Y.Doc, s: Omit<SplitSend, "id">) {
  const id = newObjectId();
  sendsOf(doc).set(id, { id, at: s.at, by: str(s.by, NAME_MAX), to: s.to.slice(0, 100) });
}

export function readSplit(doc: Y.Doc): SplitView {
  const people = [...peopleOf(doc).entries()].map(([id, m]) => readPerson(id, m)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const expenses = [...expensesOf(doc).entries()]
    .map(([id, m]) => readExpense(id, m))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const payments = [...paymentsOf(doc).values()]
    .filter((p) => p && typeof p.from === "string" && typeof p.to === "string")
    .map((p) => ({ id: str(p.id, 64), from: p.from, to: p.to, amount: Math.max(0, int(p.amount)), date: isDate(p.date) ? p.date : "" }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const sends = [...sendsOf(doc).values()]
    .filter((s) => s && typeof s.at === "number")
    .map((s) => ({ id: str(s.id, 64), at: s.at, by: str(s.by, NAME_MAX), to: Array.isArray(s.to) ? s.to.filter((x): x is string => typeof x === "string") : [] }))
    .sort((a, b) => a.at - b.at);
  return { title: str(meta(doc).get("title"), 80), createdBy: int(meta(doc).get("createdBy")), people, expenses, payments, sends };
}

// ───────────── the sums ─────────────

/**
 * Who pays how much of one expense, in öre, summing to its amount exactly. Equal and shares split by
 * weight, the öre left over going one each to the largest remainders (then in the people's order); exact
 * takes the amounts as written, and what they leave over (or take too much) is split equally among them.
 */
export function sharesOf(e: Pick<SplitExpense, "amount" | "mode" | "parts">, order: string[]): Map<string, number> {
  const ids = order.filter((id) => (e.parts[id] ?? 0) > 0);
  const out = new Map<string, number>();
  if (ids.length === 0 || e.amount <= 0) return out;
  if (e.mode === "exact") {
    const written = ids.reduce((s, id) => s + e.parts[id]!, 0);
    for (const id of ids) out.set(id, e.parts[id]!);
    const left = e.amount - written;
    if (left !== 0) for (const [id, n] of byWeight(left, ids, () => 1)) out.set(id, out.get(id)! + n);
    return out;
  }
  return byWeight(e.amount, ids, (id) => (e.mode === "shares" ? e.parts[id]! : 1));
}

/** amount split by weight, exactly (amount may be negative: what an exact split took too much). */
function byWeight(amount: number, ids: string[], weight: (id: string) => number): Map<string, number> {
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const total = ids.reduce((s, id) => s + weight(id), 0);
  const rows = ids.map((id, i) => {
    const exact = (abs * weight(id)) / total;
    return { id, i, n: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = abs - rows.reduce((s, r) => s + r.n, 0);
  for (const r of [...rows].sort((a, b) => b.rest - a.rest || a.i - b.i)) {
    if (left <= 0) break;
    r.n++;
    left--;
  }
  return new Map(rows.map((r) => [r.id, sign * r.n]));
}

/** Everyone's balance, in the people's order. */
export function balances(v: SplitView): Balance[] {
  const order = v.people.map((p) => p.id);
  const paid = new Map<string, number>();
  const share = new Map<string, number>();
  const settled = new Map<string, number>();
  const add = (m: Map<string, number>, id: string, n: number) => m.set(id, (m.get(id) ?? 0) + n);
  for (const e of v.expenses) {
    if (!order.includes(e.paidBy)) continue;
    const shares = sharesOf(e, order);
    if (shares.size === 0) continue;
    add(paid, e.paidBy, e.amount);
    for (const [id, n] of shares) add(share, id, n);
  }
  for (const p of v.payments) {
    if (!order.includes(p.from) || !order.includes(p.to)) continue;
    add(settled, p.from, p.amount);
    add(settled, p.to, -p.amount);
  }
  return v.people.map((person) => {
    const pd = paid.get(person.id) ?? 0;
    const sh = share.get(person.id) ?? 0;
    const st = settled.get(person.id) ?? 0;
    return { person, paid: pd, share: sh, settled: st, net: pd - sh + st };
  });
}

/** Who pays whom to settle everything: the largest debt to the largest claim, until all are even. */
export function settle(v: SplitView): Transfer[] {
  const rank = new Map(v.people.map((p, i) => [p.id, i]));
  const bs = balances(v);
  const owed = bs.filter((b) => b.net > 0).map((b) => ({ id: b.person.id, n: b.net }));
  const owing = bs.filter((b) => b.net < 0).map((b) => ({ id: b.person.id, n: -b.net }));
  const out: Transfer[] = [];
  const byBiggest = (a: { id: string; n: number }, b: { id: string; n: number }) => b.n - a.n || rank.get(a.id)! - rank.get(b.id)!;
  while (owed.length && owing.length) {
    owed.sort(byBiggest);
    owing.sort(byBiggest);
    const to = owed[0]!;
    const from = owing[0]!;
    const n = Math.min(to.n, from.n);
    out.push({ from: from.id, to: to.id, amount: n });
    to.n -= n;
    from.n -= n;
    if (to.n === 0) owed.shift();
    if (from.n === 0) owing.shift();
  }
  return out;
}

/** The total of all expenses. */
export const splitTotal = (v: SplitView) => v.expenses.reduce((s, e) => s + e.amount, 0);

/** The first and last day of the expenses ("" when there are none). */
export function splitDates(v: SplitView): { from: string; to: string } {
  const ds = v.expenses.map((e) => e.date).filter(Boolean).sort();
  return { from: ds[0] ?? "", to: ds[ds.length - 1] ?? "" };
}
