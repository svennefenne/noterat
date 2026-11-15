import { useCallback, useState } from "react";
import { Link } from "wouter";
import { HandCoins } from "lucide-react";
import type * as Y from "yjs";
import { addExpense, expenseFromReceipt, formatAmount, readSplit, wallOf, type ReceiptGuess } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useDocsValues, useHomeItems, useSession } from "../lib/sync-react";

/**
 * A receipt, into a cost split (decision 13): who paid it, and it's an expense split equally among
 * everyone, tied to the scan, to change on the split's page if it wasn't for all of them.
 */
export function ToSplit({ scanId, receipt }: { scanId: string; receipt: ReceiptGuess }) {
  const { t, lang } = useI18n();
  const { sync, user } = useSession();
  const items = useHomeItems().filter(([, i]) => i.type === "split" && i.role !== "viewer");
  const docs = sync.docsOf("split", items.map(([id]) => id));
  const read = useCallback((doc: Y.Doc) => readSplit(doc), []);
  const views = useDocsValues(docs, read);
  const [chosen, setChosen] = useState(0);
  const [payer, setPayer] = useState<string | null>(null);

  if (!items.length || receipt.total === undefined) return null;
  const linked = views.findIndex((v) => v.expenses.some((e) => e.scan === scanId));
  if (linked >= 0)
    return (
      <p className="muted small-text to-budget">
        <HandCoins aria-hidden size={14} /> {t("split.receipt.inSplit")}{" "}
        <Link href={`/budget/splits/${items[linked]![0]}`}>{views[linked]!.title || t("untitled.split")}</Link>
      </p>
    );

  const i = Math.min(chosen, items.length - 1);
  const view = views[i]!;
  const me = view.people.find((p) => p.userId === user.id)?.id ?? view.people[0]?.id ?? "";
  const paidBy = payer && view.people.some((p) => p.id === payer) ? payer : me;
  if (!view.people.length) return null;

  return (
    <div className="card to-budget">
      <h3>
        <HandCoins aria-hidden size={16} /> {t("split.receipt.toSplit")}
      </h3>
      <div className="to-budget-new">
        {items.length > 1 && (
          <select value={i} onChange={(e) => setChosen(Number(e.target.value))} aria-label={t("split.title")}>
            {views.map((v, n) => (
              <option key={items[n]![0]} value={n}>
                {v.title || t("untitled.split")}
              </option>
            ))}
          </select>
        )}
        <select value={paidBy} onChange={(e) => setPayer(e.target.value)} aria-label={t("split.expense.paidBy")}>
          {view.people.map((p) => (
            <option key={p.id} value={p.id}>
              {t("split.receipt.paidBy", { name: p.name })}
            </option>
          ))}
        </select>
        <button type="button" className="primary small" onClick={() => addExpense(docs[i]!, expenseFromReceipt(view, scanId, receipt, paidBy, wallOf(new Date(), true).slice(0, 10)), user.id)}>
          {t("split.receipt.add", { amount: formatAmount(receipt.total, lang) })}
        </button>
      </div>
      <p className="muted small-text">{t("split.receipt.addHint", { n: view.people.length })}</p>
    </div>
  );
}
