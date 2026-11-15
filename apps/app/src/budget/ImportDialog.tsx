import { useState } from "react";
import { Upload } from "lucide-react";
import type * as Y from "yjs";
import { findColumns, formatAmount, importRows, parseCsv, toTransactions, type Columns } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { Problem } from "../ui";

/** A bank's export: UTF-8 if it is that, else what Swedish banks otherwise write (Windows-1252). */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** A CSV file from the bank: its columns found (or picked), a look at the rows, then in they go (none twice). */
export function ImportDialog({ doc, onDone }: { doc: Y.Doc; onDone: () => void }) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [columns, setColumns] = useState<Columns>({ date: -1, amount: -1, text: -1 });
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setProblem("");
    setResult(null);
    const r = parseCsv(await readText(file));
    if (r.length < 2) return setProblem(t("budget.importEmpty"));
    const found = findColumns(r);
    setRows(r);
    setHeaderRow(Math.max(0, found.headerRow));
    setColumns(found.columns ?? { date: -1, amount: -1, text: -1 });
  }

  const ready = rows && columns.date >= 0 && columns.amount >= 0;
  const found = ready ? toTransactions(rows, headerRow, columns) : [];
  const header = rows?.[headerRow] ?? [];

  if (result)
    return (
      <div className="stack">
        <p>{t("budget.imported", { added: result.added, skipped: result.skipped })}</p>
        <div className="dialog-actions">
          <button type="button" className="primary" onClick={onDone}>
            {t("budget.done")}
          </button>
        </div>
      </div>
    );

  return (
    <div className="stack import-dialog">
      <p className="muted small-text">{t("budget.importHint")}</p>
      <label className="secondary file-button">
        <Upload aria-hidden size={16} /> {t("budget.pickFile")}
        <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void pick(e.target.files?.[0])} hidden />
      </label>
      {problem && <Problem>{problem}</Problem>}
      {rows && (
        <>
          <div className="import-columns">
            {(["date", "amount", "text"] as const).map((k) => (
              <label key={k} className="field">
                <span>{t(`budget.column.${k}`)}</span>
                <select value={columns[k]} onChange={(e) => setColumns({ ...columns, [k]: Number(e.target.value) })}>
                  <option value={-1}>–</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `${t("budget.column")} ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="field">
              <span>{t("budget.headerRow")}</span>
              <input type="number" min={1} max={rows.length} value={headerRow + 1} onChange={(e) => setHeaderRow(Math.min(rows.length - 1, Math.max(0, Number(e.target.value) - 1)))} />
            </label>
          </div>
          {ready && (
            <>
              <p>{t("budget.found", { n: found.length })}</p>
              <ul className="tx-list preview">
                {found.slice(0, 8).map((x) => (
                  <li key={x.key} className="tx">
                    <span className="tx-date">{x.date}</span>
                    <span className="tx-text">{x.text || "–"}</span>
                    <span className={`tx-amount${x.amount > 0 ? " in" : ""}`}>{formatAmount(x.amount, lang)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="dialog-actions">
            <button type="button" className="primary" disabled={!found.length} onClick={() => setResult(importRows(doc, found))}>
              {t("budget.importN", { n: found.length })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
