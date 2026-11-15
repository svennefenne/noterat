import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Receipt, Trash2, X } from "lucide-react";
import { Link } from "wouter";
import type * as Y from "yjs";
import {
  addExpense,
  addPerson,
  formatAmount,
  formatPhone,
  personInUse,
  readAmount,
  readScan,
  removeExpense,
  removePerson,
  sharesOf,
  swishNumber,
  updateExpense,
  updatePerson,
  validEmail,
  wallOf,
  type Person,
  type SplitExpense,
  type SplitMode,
  type SplitView,
} from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useDocsValues, useHomeItems, useSession } from "../lib/sync-react";
import { Problem } from "../ui";

/** Someone in the split: a name, a phone number for Swish, an e-mail address for the summary. */
export function PersonForm({ doc, view, id, onDone }: { doc: Y.Doc; view: SplitView; id: string | null; onDone: () => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const had = view.people.find((p) => p.id === id);
  const [name, setName] = useState(had?.name ?? "");
  const [phone, setPhone] = useState(had ? formatPhone(had.phone) : "");
  const [email, setEmail] = useState(had?.email ?? "");
  const [userId, setUserId] = useState(had?.userId ?? 0);
  const [accounts, setAccounts] = useState<Person[]>([]);
  const [problem, setProblem] = useState("");

  // (the server's other accounts, to pick from: offline there are none, and that's fine)
  useEffect(() => {
    if (had) return;
    api.people().then(setAccounts, () => {});
  }, [api, had]);
  const taken = new Set(view.people.map((p) => p.userId).filter(Boolean));
  const pickable = accounts.filter((a) => !taken.has(a.id));

  function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setProblem(t("split.person.nameMissing"));
    if (phone.trim() && !swishNumber(phone)) return setProblem(t("split.person.phoneBad"));
    if (email.trim() && !validEmail(email.trim().toLowerCase())) return setProblem(t("split.person.emailBad"));
    const p = { name: name.trim(), phone: phone.trim() ? swishNumber(phone) : "", email: email.trim().toLowerCase() };
    if (had) updatePerson(doc, had.id, p);
    else addPerson(doc, { ...p, userId });
    onDone();
  }

  const inUse = had ? personInUse(view, had.id) : false;
  return (
    <form onSubmit={save} className="stack">
      {!had && pickable.length > 0 && (
        <div className="split-accounts">
          <span className="muted small-text">{t("split.person.fromAccounts")}</span>
          <div className="chips">
            {pickable.map((a) => (
              <button
                key={a.id}
                type="button"
                className={userId === a.id ? "chip chosen" : "chip"}
                aria-pressed={userId === a.id}
                onClick={() => {
                  setUserId(userId === a.id ? 0 : a.id);
                  if (userId !== a.id) setName(a.displayName);
                }}
              >
                {a.displayName}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="field">
        <span>{t("split.person.name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" data-autofocus />
      </label>
      <label className="field">
        <span>{t("split.person.phone")}</span>
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="070-123 45 67" autoComplete="off" />
        <span className="muted small-text">{t("split.person.phoneHint")}</span>
      </label>
      <label className="field">
        <span>{t("split.person.email")}</span>
        <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="namn@example.com" autoComplete="off" />
        <span className="muted small-text">{t("split.person.emailHint")}</span>
      </label>
      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        {had && (
          <button
            type="button"
            className="secondary danger-text"
            disabled={inUse}
            title={inUse ? t("split.person.inUse") : undefined}
            onClick={() => {
              if (confirm(t("split.person.removeConfirm", { name: had.name }))) {
                removePerson(doc, had.id);
                onDone();
              }
            }}
          >
            <Trash2 aria-hidden size={16} /> {t("split.person.remove")}
          </button>
        )}
        <button type="submit" className="primary">
          {t(had ? "note.save" : "split.person.add")}
        </button>
      </div>
      {had && inUse && <p className="muted small-text">{t("split.person.inUse")}</p>}
    </form>
  );
}

const MODES: SplitMode[] = ["equal", "shares", "exact"];

/**
 * An expense: what, how much, who paid, and who it's for, equally, in shares (a couple as two) or in
 * exact amounts (someone had the expensive dish). The split is shown as it will be counted.
 */
export function ExpenseForm({ doc, view, id, onDone }: { doc: Y.Doc; view: SplitView; id: string | null; onDone: () => void }) {
  const { t, lang } = useI18n();
  const { user } = useSession();
  const had = view.expenses.find((e) => e.id === id);
  const me = view.people.find((p) => p.userId === user.id)?.id ?? view.people[0]?.id ?? "";
  const everyone = Object.fromEntries(view.people.map((p) => [p.id, 1]));
  const [text, setText] = useState(had?.text ?? "");
  const [amount, setAmount] = useState(had ? formatAmount(had.amount, lang) : "");
  const [date, setDate] = useState(had?.date || wallOf(new Date(), true).slice(0, 10));
  const [paidBy, setPaidBy] = useState(had?.paidBy ?? me);
  const [mode, setMode] = useState<SplitMode>(had?.mode ?? "equal");
  const [scan, setScan] = useState(had?.scan ?? "");
  /** equal: who's in (1); shares: their weight; exact: what they wrote, in kronor as typed */
  const [parts, setParts] = useState<Record<string, string>>(() => {
    const from = had?.parts ?? everyone;
    return Object.fromEntries(view.people.map((p) => [p.id, had?.mode === "exact" ? (from[p.id] ? formatAmount(from[p.id]!, lang) : "") : String(from[p.id] ?? 0)]));
  });
  const [problem, setProblem] = useState("");

  const ore = readAmount(amount) ?? 0;
  const numeric = useMemo(
    () =>
      Object.fromEntries(
        view.people.map((p) => {
          const raw = parts[p.id] ?? "";
          return [p.id, mode === "exact" ? (readAmount(raw) ?? 0) : Math.max(0, Math.round(Number(raw) || 0))];
        }),
      ),
    [parts, mode, view.people],
  );
  const order = view.people.map((p) => p.id);
  const shares = sharesOf({ amount: ore, mode, parts: numeric }, order);
  const written = mode === "exact" ? Object.values(numeric).reduce((s, n) => s + n, 0) : 0;
  const left = ore - written;

  function switchMode(next: SplitMode) {
    // (keep who's in: equal and shares as 1 each, exact as their equal share for a start)
    const inIds = order.filter((pid) => (numeric[pid] ?? 0) > 0);
    const ids = inIds.length ? inIds : order;
    const start = next === "exact" ? sharesOf({ amount: ore, mode: "equal", parts: Object.fromEntries(ids.map((pid) => [pid, 1])) }, order) : null;
    setParts(Object.fromEntries(order.map((pid) => [pid, !ids.includes(pid) ? (next === "exact" ? "" : "0") : next === "exact" ? formatAmount(start!.get(pid) ?? 0, lang) : "1"])));
    setMode(next);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (!ore) return setProblem(t("split.expense.amountMissing"));
    if (!paidBy) return setProblem(t("split.expense.payerMissing"));
    if (shares.size === 0) return setProblem(t("split.expense.nobody"));
    if (mode === "exact" && left !== 0) return setProblem(t("split.expense.exactOff", { left: formatAmount(left, lang) }));
    const input = { date, text: text.trim(), amount: ore, paidBy, mode, parts: numeric, scan };
    if (had) updateExpense(doc, had.id, input);
    else addExpense(doc, input, user.id);
    onDone();
  }

  return (
    <form onSubmit={save} className="stack split-expense-form">
      <ReceiptPick
        view={view}
        expenseId={had?.id ?? null}
        scan={scan}
        onPick={(id, r) => {
          setScan(id);
          if (r.shop) setText(r.shop);
          if (r.total !== undefined) setAmount(formatAmount(r.total, lang));
          if (r.date) setDate(r.date);
        }}
        onClear={() => setScan("")}
      />
      <label className="field">
        <span>{t("split.expense.what")}</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("split.expense.whatHint")} maxLength={120} data-autofocus />
      </label>
      <div className="pin-fields">
        <label className="field">
          <span>{t("split.expense.amount")}</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </label>
        <label className="field">
          <span>{t("split.expense.date")}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>{t("split.expense.paidBy")}</span>
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {view.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="split-for">
        <legend>{t("split.expense.for")}</legend>
        <div className="segmented" role="group" aria-label={t("split.expense.how")}>
          {MODES.map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)}>
              {t(`split.mode.${m}`)}
            </button>
          ))}
        </div>
        <ul className="split-parts">
          {view.people.map((p) => {
            const share = shares.get(p.id) ?? 0;
            return (
              <li key={p.id}>
                {mode === "equal" ? (
                  <label className="check">
                    <input type="checkbox" checked={(numeric[p.id] ?? 0) > 0} onChange={(e) => setParts({ ...parts, [p.id]: e.target.checked ? "1" : "0" })} /> {p.name}
                  </label>
                ) : (
                  <span className="split-part-name">{p.name}</span>
                )}
                {mode === "shares" && (
                  <span className="stepper">
                    <button type="button" aria-label={t("split.expense.fewer", { name: p.name })} onClick={() => setParts({ ...parts, [p.id]: String(Math.max(0, (numeric[p.id] ?? 0) - 1)) })}>
                      −
                    </button>
                    <span aria-live="polite">{numeric[p.id] ?? 0}</span>
                    <button type="button" aria-label={t("split.expense.more", { name: p.name })} onClick={() => setParts({ ...parts, [p.id]: String(Math.min(20, (numeric[p.id] ?? 0) + 1)) })}>
                      +
                    </button>
                  </span>
                )}
                {mode === "exact" ? (
                  <input className="amount-input" inputMode="decimal" value={parts[p.id] ?? ""} placeholder="0,00" aria-label={t("split.expense.exactFor", { name: p.name })} onChange={(e) => setParts({ ...parts, [p.id]: e.target.value })} />
                ) : (
                  <span className={share ? "split-part-share" : "split-part-share muted"}>{share ? formatAmount(share, lang) : "–"}</span>
                )}
              </li>
            );
          })}
        </ul>
        {mode === "exact" && ore > 0 && <p className={left === 0 ? "muted small-text" : "problem small-text"}>{left === 0 ? t("split.expense.exactOk") : t("split.expense.exactLeft", { left: formatAmount(left, lang) })}</p>}
      </fieldset>
      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        {had && (
          <button
            type="button"
            className="secondary danger-text"
            onClick={() => {
              if (confirm(t("split.expense.removeConfirm"))) {
                removeExpense(doc, had.id);
                onDone();
              }
            }}
          >
            <Trash2 aria-hidden size={16} /> {t("split.expense.remove")}
          </button>
        )}
        <button type="submit" className="primary">
          {t(had ? "note.save" : "split.expense.add")}
        </button>
      </div>
    </form>
  );
}

interface ReceiptRow {
  id: string;
  shop: string;
  date: string;
  total: number | undefined;
  at: number;
}

const readReceiptRow = (doc: Y.Doc) => {
  const s = readScan(doc);
  return s.kind === "receipt" ? { shop: s.receipt?.shop ?? s.title, date: s.receipt?.date ?? "", total: s.receipt?.total, at: s.createdAt } : null;
};

/**
 * An expense from a scanned receipt (decision 13): its shop, day and total filled in, and the expense tied
 * to the scan. Receipts already in this split aren't offered again.
 */
function ReceiptPick({
  view,
  expenseId,
  scan,
  onPick,
  onClear,
}: {
  view: SplitView;
  expenseId: string | null;
  scan: string;
  onPick: (id: string, r: { shop?: string; date?: string; total?: number }) => void;
  onClear: () => void;
}) {
  const { t, lang } = useI18n();
  const { sync } = useSession();
  const items = useHomeItems().filter(([, i]) => i.type === "scan");
  const docs = sync.docsOf("scan", items.map(([id]) => id));
  const rows = useDocsValues(docs, readReceiptRow);
  const [open, setOpen] = useState(false);
  const used = new Set(view.expenses.filter((e) => e.id !== expenseId && e.scan).map((e) => e.scan));
  const receipts: ReceiptRow[] = items
    .map(([id], i) => (rows[i] ? { id, ...rows[i]! } : null))
    .filter((r): r is ReceiptRow => !!r && r.total !== undefined && !used.has(r.id))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.at - a.at)
    .slice(0, 12);
  const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(t("locale"), { day: "numeric", month: "short" }).replace(/\.$/, "");
  const label = (r: { shop: string; date: string; total?: number }) =>
    [r.shop || t("split.receipt.noShop"), r.date && day(r.date), r.total !== undefined && `${formatAmount(r.total, lang)} kr`].filter(Boolean).join(" · ");

  if (scan) {
    const items0 = items.findIndex(([id]) => id === scan);
    const r = items0 >= 0 ? rows[items0] : null;
    return (
      <p className="split-receipt">
        <Receipt aria-hidden size={16} />
        <span>
          {t("split.receipt.linked")} <Link href={`/scans/${scan}`}>{r ? label(r) : t("split.receipt.open")}</Link>
        </span>
        <button type="button" className="icon-button" onClick={onClear} aria-label={t("split.receipt.unlink")} title={t("split.receipt.unlink")}>
          <X aria-hidden size={16} />
        </button>
      </p>
    );
  }
  if (receipts.length === 0) return null;
  return (
    <div className="split-receipts">
      <button type="button" className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Receipt aria-hidden size={16} /> {t("split.receipt.from")}
      </button>
      {open && (
        <ul>
          {receipts.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(r.id, { shop: r.shop, date: r.date, total: r.total });
                  setOpen(false);
                }}
              >
                {label(r)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Ada betalade · alla fyra" / "Bo · Ada och Bo" / "Cilla · 2 personer, exakta belopp" */
export function useExpenseLine() {
  const { t } = useI18n();
  return (e: SplitExpense, v: SplitView) => {
    const name = (id: string) => v.people.find((p) => p.id === id)?.name.split(" ")[0] ?? "?";
    const order = v.people.map((p) => p.id);
    const ids = [...sharesOf(e, order).keys()];
    const who =
      ids.length === v.people.length && v.people.length > 2
        ? t("split.forAll", { n: ids.length })
        : ids.length <= 2
          ? ids.map(name).join(t("split.and"))
          : t("split.forSome", { n: ids.length });
    const how = e.mode === "shares" ? ` · ${t("split.mode.shares").toLowerCase()}` : e.mode === "exact" ? ` · ${t("split.mode.exact").toLowerCase()}` : "";
    return t("split.paidLine", { name: name(e.paidBy), who }) + how;
  };
}
