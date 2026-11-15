import { useState } from "react";
import { Link } from "wouter";
import { Wallet } from "lucide-react";
import { addTransaction, formatAmount, readBudget, receiptMatches, suggestCategory, transactionFromReceipt, updateTransaction, wallOf, type ReceiptGuess } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useDocsValues, useHomeItems, useSession } from "../lib/sync-react";
import { CategorySelect } from "./BudgetPage";

/**
 * A receipt, into a budget: tied to the bank's line for it (same amount, a few days either side) when
 * that's been imported, else booked as a new expense. Either way the transaction links back to the scan.
 */
export function ToBudget({ scanId, receipt }: { scanId: string; receipt: ReceiptGuess }) {
  const { t, lang } = useI18n();
  const { sync } = useSession();
  const items = useHomeItems().filter(([, i]) => i.type === "budget" && i.role !== "viewer");
  const docs = sync.docsOf("budget", items.map(([id]) => id));
  const views = useDocsValues(docs, readBudget);
  const [chosen, setChosen] = useState(0);
  const [category, setCategory] = useState<string | null>(null);

  if (!items.length || receipt.total === undefined) return null;
  const linked = views.findIndex((v) => v.transactions.some((x) => x.scan === scanId));
  if (linked >= 0)
    return (
      <p className="muted small-text to-budget">
        <Wallet aria-hidden size={14} /> {t("budget.receiptBooked")}{" "}
        <Link href={`/budget/${items[linked]![0]}`}>{views[linked]!.title || t("untitled.budget")}</Link>
      </p>
    );

  const i = Math.min(chosen, items.length - 1);
  const view = views[i]!;
  const doc = docs[i]!;
  const matches = receiptMatches(view, receipt);
  const cat = category ?? suggestCategory(view, receipt.shop ?? "");

  return (
    <div className="card to-budget">
      <h3>
        <Wallet aria-hidden size={16} /> {t("budget.toBudget")}
      </h3>
      {items.length > 1 && (
        <select value={i} onChange={(e) => setChosen(Number(e.target.value))} aria-label={t("budget.title")}>
          {views.map((v, n) => (
            <option key={items[n]![0]} value={n}>
              {v.title || t("untitled.budget")}
            </option>
          ))}
        </select>
      )}
      {matches.length > 0 && (
        <>
          <p className="small-text">{t("budget.receiptMatches")}</p>
          <ul className="plain-list">
            {matches.map((x) => (
              <li key={x.id}>
                <button type="button" className="secondary small" onClick={() => updateTransaction(doc, x.id, { scan: scanId, ...(x.category ? {} : { category: cat }) })}>
                  {x.date} · {x.text || "–"} · {formatAmount(x.amount, lang)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="to-budget-new">
        <CategorySelect categories={view.categories} value={cat} onChange={setCategory} />
        <button type="button" className="primary small" onClick={() => addTransaction(doc, { ...transactionFromReceipt(scanId, receipt, wallOf(new Date(), true)), category: cat })}>
          {t(matches.length ? "budget.bookAnyway" : "budget.book")}
        </button>
      </div>
    </div>
  );
}
