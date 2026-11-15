import { useState, type FormEvent } from "react";
import { Plus, Users, Wallet } from "lucide-react";
import { Link, useLocation } from "wouter";
import type * as Y from "yjs";
import { formatAmount, initBudget, monthSummary, readBudget, type BudgetMethod } from "@noterat/core";
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
    </div>
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
