import { useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Copy, MoreVertical, Plus, Receipt, Share2, Trash2, Upload } from "lucide-react";
import { Link } from "wouter";
import type * as Y from "yjs";
import {
  addTransaction,
  copyPlan,
  formatAmount,
  monthSummary,
  objectDocName,
  readAmount,
  readBudget,
  recurringIn,
  removeCategory,
  removeGoal,
  removeRecurring,
  removeTransaction,
  setBudgetMeta,
  setCategory,
  setGoal,
  setPlan,
  setRecurring,
  spendingReport,
  updateTransaction,
  wallOf,
  type BudgetView,
  type Category,
  type MemberRole,
} from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useDocValue, useSession } from "../lib/sync-react";
import { TitleInput } from "../notes/NoteScreen";
import { Back, NotHere, useAway, useThing } from "../things/parts";
import { ShareDialog } from "../things/ShareDialog";
import { Dialog, Menu, MenuItem, useStored } from "../ui";
import { ImportDialog } from "./ImportDialog";

const monthName = (m: string, locale: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(locale, { month: "long", year: "numeric" });
const shift = (m: string, n: number) => {
  const d = new Date(`${m}-15T12:00:00`);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 7);
};

export function BudgetScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { loading, role } = useThing("budget", id);
  if (loading) return <p className="muted">{t("lists.loading")}</p>;
  if (!role) return <NotHere type="budget" />;
  return <BudgetPage id={id} role={role} />;
}

/** A budget's page: the month (planned, spent, what's left), its transactions, recurring items and goals, and a report. */
function BudgetPage({ id, role }: { id: string; role: MemberRole }) {
  const { t, lang } = useI18n();
  const { sync } = useSession();
  const name = objectDocName("budget", id);
  const doc = sync.doc(name);
  const view = useDocValue(doc, readBudget);
  const [month, setMonth] = useState(() => wallOf(new Date(), true).slice(0, 7));
  const [tab, setTab] = useStored<"month" | "transactions" | "plans" | "report">(`noterat.budget.${id}`, "month");
  const [sharing, setSharing] = useState(false);
  const [importing, setImporting] = useState(false);
  const { away, problem } = useAway("budget", id);
  const readOnly = role === "viewer";
  const sum = monthSummary(view, month);
  const kr = (n: number) => `${formatAmount(n, lang)} kr`;

  if (!sync.isLoaded(name)) return <p className="muted">{t("lists.loading")}</p>;

  return (
    <div className="screen budget-screen">
      <div className="list-head">
        <Back type="budget" />
        <div className="list-title-row">
          <TitleInput value={view.title} placeholder={t("untitled.budget")} readOnly={readOnly} onCommit={(v) => setBudgetMeta(doc, { title: v })} />
          <div className="list-actions">
            {!readOnly && (
              <button type="button" className="secondary small" onClick={() => setImporting(true)}>
                <Upload aria-hidden size={16} /> {t("budget.import")}
              </button>
            )}
            <button type="button" className="secondary small" onClick={() => setSharing(true)}>
              <Share2 aria-hidden size={16} /> {t("list.share")}
            </button>
            <Menu label={t("list.more")} icon={<MoreVertical aria-hidden size={20} />}>
              {!readOnly && (
                <MenuItem onSelect={() => setBudgetMeta(doc, { method: view.method === "envelope" ? "zero" : "envelope" })}>
                  {t(view.method === "envelope" ? "budget.toZero" : "budget.toEnvelope")}
                </MenuItem>
              )}
              {role === "owner" ? (
                <MenuItem danger onSelect={() => void away("delete", t("budget.deleteConfirm"))}>
                  {t("budget.delete")}
                </MenuItem>
              ) : (
                <MenuItem danger onSelect={() => void away("leave", t("budget.leaveConfirm"))}>
                  {t("budget.leave")}
                </MenuItem>
              )}
            </Menu>
          </div>
        </div>
        {problem && <p className="problem">{problem}</p>}
      </div>

      <div className="calendar-head">
        <button type="button" className="icon-button" onClick={() => setMonth(shift(month, -1))} aria-label={t("journal.prevMonth")}>
          <ChevronLeft aria-hidden size={20} />
        </button>
        <h2>{monthName(month, t("locale"))}</h2>
        <button type="button" className="icon-button" onClick={() => setMonth(shift(month, 1))} aria-label={t("journal.nextMonth")}>
          <ChevronRight aria-hidden size={20} />
        </button>
      </div>

      <div className="budget-totals">
        <div>
          <span className="muted small-text">{t("budget.income")}</span>
          <strong>{kr(sum.income)}</strong>
        </div>
        <div>
          <span className="muted small-text">{t("budget.spending")}</span>
          <strong>{kr(sum.spending)}</strong>
        </div>
        <div>
          <span className="muted small-text">{t("budget.planned")}</span>
          <strong>{kr(sum.planned)}</strong>
        </div>
        {view.method === "zero" && (
          <div className={sum.toAssign < 0 ? "bad" : ""}>
            <span className="muted small-text">{t("budget.toAssign")}</span>
            <strong>{kr(sum.toAssign)}</strong>
          </div>
        )}
      </div>

      <div className="segmented budget-tabs" role="tablist">
        {(["month", "transactions", "plans", "report"] as const).map((x) => (
          <button key={x} type="button" role="tab" aria-pressed={tab === x} onClick={() => setTab(x)}>
            {t(`budget.tab.${x}`)}
            {x === "transactions" && sum.uncategorized > 0 && <span className="badge">{sum.uncategorized}</span>}
          </button>
        ))}
      </div>

      {tab === "month" && <MonthTab doc={doc} view={view} month={month} readOnly={readOnly} />}
      {tab === "transactions" && <TransactionsTab doc={doc} view={view} month={month} readOnly={readOnly} />}
      {tab === "plans" && <PlansTab doc={doc} view={view} month={month} readOnly={readOnly} />}
      {tab === "report" && <Report view={view} month={month} />}

      <Dialog open={sharing} onClose={() => setSharing(false)} title={t("share.title", { title: view.title })}>
        <ShareDialog id={id} />
      </Dialog>
      <Dialog open={importing} onClose={() => setImporting(false)} title={t("budget.import")} wide>
        {importing && <ImportDialog doc={doc} onDone={() => setImporting(false)} />}
      </Dialog>
    </div>
  );
}

function AmountInput({ value, onCommit, readOnly, label }: { value: number; onCommit: (ore: number) => void; readOnly: boolean; label: string }) {
  const { lang } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value ? formatAmount(value, lang) : "");
  return (
    <input
      className="amount-input"
      inputMode="decimal"
      value={shown}
      placeholder="0"
      readOnly={readOnly}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) onCommit(draft.trim() === "" ? 0 : (readAmount(draft) ?? value));
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

/** The month: each category's plan (written in place), what's been spent, and what's left. */
function MonthTab({ doc, view, month, readOnly }: { doc: Y.Doc; view: BudgetView; month: string; readOnly: boolean }) {
  const { t, lang } = useI18n();
  const sum = monthSummary(view, month);
  const groups = [...new Set(sum.categories.map((c) => c.category.group))];
  const due = recurringIn(view, month);
  return (
    <div className="budget-month">
      {!readOnly && Object.keys(view.plans[month] ?? {}).length === 0 && view.plans[shift(month, -1)] && (
        <button type="button" className="secondary small" onClick={() => copyPlan(doc, shift(month, -1), month)}>
          <Copy aria-hidden size={16} /> {t("budget.copyPlan")}
        </button>
      )}
      {groups.map((g) => (
        <section key={g} className="budget-group">
          <h3>{g}</h3>
          <table className="budget-table">
            <thead>
              <tr>
                <th scope="col">{t("budget.category")}</th>
                <th scope="col">{t("budget.planned")}</th>
                <th scope="col">{t(sum.categories.find((c) => c.category.group === g)?.category.kind === "income" ? "budget.received" : "budget.spent")}</th>
                <th scope="col">{t("budget.left")}</th>
              </tr>
            </thead>
            <tbody>
              {sum.categories
                .filter((c) => c.category.group === g)
                .map((c) => {
                  const income = c.category.kind === "income";
                  const got = (income ? -c.spent : c.spent) || 0;
                  const pct = c.planned ? Math.min(100, (got / c.planned) * 100) : 0;
                  return (
                    <tr key={c.category.id}>
                      <th scope="row">
                        {c.category.name}
                        {!income && c.planned > 0 && (
                          <span className={`progress${c.available < 0 ? " over" : ""}`} aria-hidden>
                            <span style={{ width: `${pct}%` }} />
                          </span>
                        )}
                      </th>
                      <td>
                        <AmountInput value={c.planned} readOnly={readOnly} label={`${c.category.name}, ${t("budget.planned")}`} onCommit={(v) => setPlan(doc, month, c.category.id, v)} />
                      </td>
                      <td className="num">{formatAmount(got, lang)}</td>
                      <td className={`num${!income && c.available < 0 ? " bad" : ""}`}>{income ? "" : formatAmount(c.available, lang)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      ))}
      {due.length > 0 && (
        <section className="budget-group">
          <h3>{t("budget.dueThisMonth")}</h3>
          <ul className="plain-list">
            {due.map((r) => (
              <li key={r.id}>
                {r.day}: {r.name} · {formatAmount(r.amount, lang)} kr
                {!readOnly && !view.transactions.some((x) => x.text === r.name && x.date.startsWith(month)) && (
                  <button type="button" className="link-button small-text" onClick={() => addTransaction(doc, { date: `${month}-${String(Math.min(r.day, 28)).padStart(2, "0")}`, amount: -r.amount, text: r.name, category: r.category })}>
                    {" "}
                    {t("budget.book")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The month's transactions: each one's category (picked in place, and remembered for its text), a receipt, a note. */
function TransactionsTab({ doc, view, month, readOnly }: { doc: Y.Doc; view: BudgetView; month: string; readOnly: boolean }) {
  const { t, lang } = useI18n();
  const [only, setOnly] = useState<"all" | "none">("all");
  const [adding, setAdding] = useState(false);
  const list = view.transactions.filter((x) => x.date.startsWith(month)).filter((x) => only === "all" || !x.category);
  return (
    <div>
      <div className="budget-tx-head">
        <div className="segmented" role="group">
          <button type="button" aria-pressed={only === "all"} onClick={() => setOnly("all")}>
            {t("notes.all")}
          </button>
          <button type="button" aria-pressed={only === "none"} onClick={() => setOnly("none")}>
            {t("budget.uncategorized")}
          </button>
        </div>
        {!readOnly && (
          <button type="button" className="secondary small" onClick={() => setAdding(true)}>
            <Plus aria-hidden size={16} /> {t("budget.addTransaction")}
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="muted">{t("budget.noTransactions")}</p>
      ) : (
        <ul className="tx-list">
          {list.map((x) => (
            <li key={x.id} className="tx">
              <span className="tx-date">{x.date.slice(5)}</span>
              <span className="tx-text">
                {x.text || "–"}
                {x.scan && (
                  <Link href={`/scans/${x.scan}`} className="tx-receipt" title={t("budget.receipt")}>
                    <Receipt aria-hidden size={14} />
                  </Link>
                )}
              </span>
              <span className={`tx-amount${x.amount > 0 ? " in" : ""}`}>{formatAmount(x.amount, lang)}</span>
              <CategorySelect categories={view.categories} value={x.category} disabled={readOnly} onChange={(c) => updateTransaction(doc, x.id, { category: c })} />
              {!readOnly && (
                <button type="button" className="icon-button" onClick={() => confirm(t("budget.removeTx")) && removeTransaction(doc, x.id)} aria-label={t("budget.removeTx")}>
                  <Trash2 aria-hidden size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={adding} onClose={() => setAdding(false)} title={t("budget.addTransaction")}>
        {adding && <NewTransaction doc={doc} view={view} month={month} onDone={() => setAdding(false)} />}
      </Dialog>
    </div>
  );
}

export function CategorySelect({ categories, value, onChange, disabled }: { categories: Category[]; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const groups = [...new Set(categories.map((c) => c.group))];
  return (
    <select className="tx-category" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={t("budget.category")}>
      <option value="">{t("budget.noCategory")}</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {categories
            .filter((c) => c.group === g)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

function NewTransaction({ doc, view, month, onDone }: { doc: Y.Doc; view: BudgetView; month: string; onDone: () => void }) {
  const { t } = useI18n();
  const today = wallOf(new Date(), true);
  const [date, setDate] = useState(today.startsWith(month) ? today : `${month}-01`);
  const [text, setText] = useState("");
  const [amount, setAmount] = useState("");
  const [out, setOut] = useState(true);
  const [category, setCat] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const ore = Math.abs(readAmount(amount) ?? 0);
    if (!ore) return;
    addTransaction(doc, { date, text: text.trim(), amount: out ? -ore : ore, category });
    onDone();
  };
  return (
    <form onSubmit={submit} className="stack">
      <div className="segmented" role="group">
        <button type="button" aria-pressed={out} onClick={() => setOut(true)}>
          {t("budget.out")}
        </button>
        <button type="button" aria-pressed={!out} onClick={() => setOut(false)}>
          {t("budget.in")}
        </button>
      </div>
      <label className="field">
        <span>{t("receipt.total")}</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required data-autofocus />
      </label>
      <label className="field">
        <span>{t("budget.what")}</span>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={120} />
      </label>
      <label className="field">
        <span>{t("receipt.date")}</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label className="field">
        <span>{t("budget.category")}</span>
        <CategorySelect categories={view.categories} value={category} onChange={setCat} />
      </label>
      <div className="dialog-actions">
        <button type="submit" className="primary">
          {t("note.save")}
        </button>
      </div>
    </form>
  );
}

/** Categories, recurring items and savings goals. */
function PlansTab({ doc, view, readOnly }: { doc: Y.Doc; view: BudgetView; month: string; readOnly: boolean }) {
  const { t, lang } = useI18n();
  const [newCat, setNewCat] = useState("");
  return (
    <div className="budget-plans">
      <section className="budget-group">
        <h3>{t("budget.goals")}</h3>
        <ul className="plain-list">
          {view.goals.map((g) => (
            <li key={g.id} className="goal">
              <span className="goal-name">{g.name}</span>
              <span className="progress" aria-hidden>
                <span style={{ width: `${g.target ? Math.min(100, (g.saved / g.target) * 100) : 0}%` }} />
              </span>
              <span className="muted small-text">
                {formatAmount(g.saved, lang)} / {formatAmount(g.target, lang)} kr
              </span>
              {!readOnly && (
                <>
                  <AmountInput value={g.saved} readOnly={false} label={t("budget.saved")} onCommit={(v) => setGoal(doc, g.id, { ...g, saved: v })} />
                  <button type="button" className="icon-button" onClick={() => removeGoal(doc, g.id)} aria-label={t("budget.remove")}>
                    <Trash2 aria-hidden size={16} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && <QuickAdd fields={["name", "amount"]} label={t("budget.addGoal")} onAdd={(name, amount) => setGoal(doc, null, { name, target: amount, saved: 0 })} />}
      </section>
      <section className="budget-group">
        <h3>{t("budget.recurring")}</h3>
        <ul className="plain-list">
          {view.recurring.map((r) => (
            <li key={r.id}>
              {r.name} · {formatAmount(r.amount, lang)} kr · {t(r.every === "month" ? "budget.monthlyOn" : "budget.yearlyOn", { day: r.day, month: r.month })}
              {!readOnly && (
                <button type="button" className="icon-button" onClick={() => removeRecurring(doc, r.id)} aria-label={t("budget.remove")}>
                  <Trash2 aria-hidden size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && <QuickAdd fields={["name", "amount", "day"]} label={t("budget.addRecurring")} onAdd={(name, amount, day) => setRecurring(doc, null, { name, amount, day: day || 25, category: "", every: "month", month: 1 })} />}
      </section>
      <section className="budget-group">
        <h3>{t("budget.categories")}</h3>
        <ul className="plain-list">
          {view.categories.map((c) => (
            <li key={c.id}>
              <span className="muted small-text">{c.group} ·</span> {c.name}
              {!readOnly && (
                <button type="button" className="icon-button" onClick={() => confirm(t("budget.removeCategory")) && removeCategory(doc, c.id)} aria-label={t("budget.remove")}>
                  <Trash2 aria-hidden size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <form
            className="quick-add"
            onSubmit={(e) => {
              e.preventDefault();
              const [group, name] = newCat.includes(":") ? newCat.split(":").map((x) => x.trim()) : ["Övrigt", newCat.trim()];
              if (name) setCategory(doc, null, { name, group: group || "Övrigt", kind: "expense" });
              setNewCat("");
            }}
          >
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder={t("budget.newCategory")} aria-label={t("budget.newCategory")} />
            <button type="submit" className="secondary small">
              {t("list.add")}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function QuickAdd({ fields, label, onAdd }: { fields: ("name" | "amount" | "day")[]; label: string; onAdd: (name: string, amount: number, day: number) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");
  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        const a = Math.abs(readAmount(amount) ?? 0);
        if (!name.trim() || !a) return;
        onAdd(name.trim(), a, Number(day) || 0);
        setName("");
        setAmount("");
        setDay("");
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={label} aria-label={label} />
      <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="kr" aria-label={t("receipt.total")} className="amount-input" />
      {fields.includes("day") && <input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} placeholder={t("budget.day")} aria-label={t("budget.day")} className="day-input" />}
      <button type="submit" className="secondary small">
        {t("list.add")}
      </button>
    </form>
  );
}

/** Spending per category for the last six months, as bars. */
function Report({ view, month }: { view: BudgetView; month: string }) {
  const { t, lang } = useI18n();
  const r = spendingReport(view, month, 6);
  const max = Math.max(1, ...r.rows.flatMap((x) => x.perMonth));
  if (!r.rows.length) return <p className="muted">{t("budget.noReport")}</p>;
  return (
    <table className="report">
      <thead>
        <tr>
          <th scope="col">{t("budget.category")}</th>
          {r.months.map((m) => (
            <th key={m} scope="col">
              {new Date(`${m}-15T12:00:00`).toLocaleDateString(t("locale"), { month: "short" })}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {r.rows.map((row) => (
          <tr key={row.category.id}>
            <th scope="row">{row.category.name}</th>
            {row.perMonth.map((n, i) => (
              <td key={i} title={`${formatAmount(n, lang)} kr`}>
                <span className="bar" style={{ height: `${Math.round((n / max) * 60) + 2}px` }} />
                <span className="bar-label">{n ? Math.round(n / 100).toLocaleString(t("locale")) : ""}</span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
