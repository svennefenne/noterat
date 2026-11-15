import { useCallback, useState, type FormEvent } from "react";
import { HandCoins, Plus, Users, Wallet } from "lucide-react";
import { Link, useLocation } from "wouter";
import type * as Y from "yjs";
import { balances, formatAmount, initBudget, initSplit, monthSummary, readBudget, readSplit, splitTotal, type BudgetMethod } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useDocsValues, useHomeItems, useSession, useSyncState } from "../lib/sync-react";
import { Dialog } from "../ui";

const thisMonth = () => new Date().toISOString().slice(0, 7);
const readCard = (doc: Y.Doc) => monthSummaryOf(readBudget(doc));
const monthSummaryOf = (v: ReturnType<typeof readBudget>) => ({ title: v.title, method: v.method, sum: monthSummary(v, thisMonth()) });

/** Budgets: usually one, the household's (shared with everyone in it); a page each. */
export function BudgetsScreen() {
  const { t, lang } = useI18n();
  const { sync } = useSession();
  const { homeLoaded } = useSyncState();
  const items = useHomeItems().filter(([, i]) => i.type === "budget");
  const docs = sync.docsOf("budget", items.map(([id]) => id));
  const cards = useDocsValues(docs, readCard);
  const [making, setMaking] = useState(false);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t("budget.title")}</h1>
        <button type="button" className="primary small" onClick={() => setMaking(true)}>
          <Plus aria-hidden size={18} /> {t("budget.new")}
        </button>
      </div>
      {items.length > 0 && <h2 className="section-title">{t("budget.budgets")}</h2>}
      {!homeLoaded ? (
        <p className="muted">{t("lists.loading")}</p>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>{t("budget.empty")}</p>
          <button type="button" className="primary" onClick={() => setMaking(true)}>
            <Wallet aria-hidden size={18} /> {t("budget.new")}
          </button>
        </div>
      ) : (
        <ul className="cards">
          {items.map(([id, item], i) => {
            const c = cards[i]!;
            return (
              <li key={id}>
                <Link href={`/budget/${id}`} className="card">
                  <span className="card-title">{c.title || t("untitled.budget")}</span>
                  <span className="card-meta">
                    <span>{t("budget.spentThisMonth", { amount: formatAmount(c.sum.spending, lang) })}</span>
                    {c.sum.planned > 0 && <span>{t("budget.ofPlanned", { amount: formatAmount(c.sum.planned, lang) })}</span>}
                    {item.role !== "owner" && (
                      <span className="badge">
                        <Users aria-hidden size={14} /> {t("lists.sharedWithYou")}
                      </span>
                    )}
                  </span>
                  {c.sum.planned > 0 && (
                    <span className="progress" aria-hidden>
                      <span style={{ width: `${Math.min(100, (c.sum.spending / c.sum.planned) * 100)}%` }} />
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={making} onClose={() => setMaking(false)} title={t("budget.new")}>
        <NewBudget onDone={() => setMaking(false)} />
      </Dialog>
      {homeLoaded && <Splits />}
    </div>
  );
}

/** Shared costs: a trip, a dinner, a shared house, each its own split; what's in it and where you stand. */
function Splits() {
  const { t, lang } = useI18n();
  const { sync, user } = useSession();
  const items = useHomeItems().filter(([, i]) => i.type === "split");
  const docs = sync.docsOf("split", items.map(([id]) => id));
  const readCard = useCallback(
    (doc: Y.Doc) => {
      const v = readSplit(doc);
      const mine = balances(v).find((b) => b.person.userId === user.id);
      return { title: v.title, total: splitTotal(v), people: v.people.length, net: mine?.net ?? 0 };
    },
    [user.id],
  );
  const cards = useDocsValues(docs, readCard);
  const [making, setMaking] = useState(false);
  return (
    <section className="splits-section" aria-labelledby="splits-title">
      <div className="section-head">
        <h2 id="splits-title" className="section-title">
          {t("split.title")}
        </h2>
        <button type="button" className="secondary small" onClick={() => setMaking(true)}>
          <Plus aria-hidden size={16} /> {t("split.new")}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted split-empty">{t("split.empty")}</p>
      ) : (
        <ul className="cards">
          {items.map(([id, item], i) => {
            const c = cards[i]!;
            return (
              <li key={id}>
                <Link href={`/budget/splits/${id}`} className="card">
                  <span className="card-title">{c.title || t("untitled.split")}</span>
                  <span className="card-meta">
                    <span>{t("split.cardMeta", { total: formatAmount(c.total, lang), n: c.people })}</span>
                    {c.net !== 0 && <span className={c.net > 0 ? "split-net plus" : "split-net minus"}>{t(c.net > 0 ? "split.youGet" : "split.youPay", { amount: formatAmount(Math.abs(c.net), lang) })}</span>}
                    {item.role !== "owner" && (
                      <span className="badge">
                        <Users aria-hidden size={14} /> {t("lists.sharedWithYou")}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={making} onClose={() => setMaking(false)} title={t("split.new")}>
        {making && <NewSplit onDone={() => setMaking(false)} />}
      </Dialog>
    </section>
  );
}

/** A new split, with this person in it, their Swish number and address taken from their last split. */
function NewSplit({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { sync, user } = useSession();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState("");
  const items = useHomeItems().filter(([, i]) => i.type === "split");
  const readMe = useCallback((doc: Y.Doc) => readSplit(doc).people.find((p) => p.userId === user.id) ?? null, [user.id]);
  const earlier = useDocsValues(sync.docsOf("split", items.map(([id]) => id)), readMe);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const me = earlier.findLast((p) => p && (p.phone || p.email));
    const id = sync.create("split", (doc) => initSplit(doc, { title: title.trim() || t("untitled.split"), by: user.id, me: { name: user.displayName, phone: me?.phone, email: me?.email } }));
    onDone();
    navigate(`/budget/splits/${id}`);
  };
  return (
    <form onSubmit={submit} className="stack">
      <label className="field">
        <span>{t("split.name")}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("split.namePlaceholder")} maxLength={80} data-autofocus />
      </label>
      <p className="muted small-text">{t("split.newHint")}</p>
      <div className="dialog-actions">
        <button type="submit" className="primary">
          <HandCoins aria-hidden size={18} /> {t("calendar.create")}
        </button>
      </div>
    </form>
  );
}

function NewBudget({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { sync, user } = useSession();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState("");
  const [method, setMethod] = useState<BudgetMethod>("envelope");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = sync.create("budget", (doc) => initBudget(doc, { title: title.trim() || t("budget.household"), method, by: user.id }));
    onDone();
    navigate(`/budget/${id}`);
  };
  return (
    <form onSubmit={submit} className="stack">
      <label className="field">
        <span>{t("budget.name")}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("budget.household")} maxLength={80} data-autofocus />
      </label>
      <fieldset className="templates">
        <legend>{t("budget.method")}</legend>
        {(["envelope", "zero"] as const).map((m) => (
          <label key={m} className={method === m ? "template chosen" : "template"}>
            <input type="radio" name="method" checked={method === m} onChange={() => setMethod(m)} />
            <span className="template-name">{t(`budget.method.${m}`)}</span>
            <span className="template-hint">{t(`budget.method.${m}.hint`)}</span>
          </label>
        ))}
      </fieldset>
      <p className="muted small-text">{t("budget.categoriesHint")}</p>
      <div className="dialog-actions">
        <button type="submit" className="primary">
          {t("calendar.create")}
        </button>
      </div>
    </form>
  );
}
