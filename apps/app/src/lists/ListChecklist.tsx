import { useState, type FormEvent } from "react";
import type * as Y from "yjs";
import { addRow, canAddRows, canEditRow, MAX_ROWS, removeDone, setCell, type ListView, type MemberRole, type Person, type Row } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { CellInput, useCellText } from "./CellInput";

/**
 * A list with a checkbox and a text column, the phone's way: one tap ticks a row off, ticked rows sink
 * under "Ticked off", and "Add…" at the end adds a row (a new one each time, so two people adding at once
 * both get theirs). The other columns show small under each row; the table view changes them.
 */
export function ListChecklist({ doc, list, role, me, people }: { doc: Y.Doc; list: ListView; role: MemberRole; me: number; people: Person[] }) {
  const { t } = useI18n();
  const text = useCellText(people, me);
  const check = list.columns.find((c) => c.type === "check")!;
  const label = list.columns.find((c) => c.type === "text")!;
  const others = list.columns.filter((c) => c !== check && c !== label);
  const done = (r: Row) => r.cells[check.id] === true;
  const open = list.rows.filter((r) => !done(r));
  const ticked = list.rows.filter(done);
  const mayAdd = canAddRows(role, list.settings);
  const [adding, setAdding] = useState("");
  const [problem, setProblem] = useState("");

  function add(e: FormEvent) {
    e.preventDefault();
    if (!adding.trim()) return;
    const id = addRow(doc, { cells: { [label.id]: adding }, by: me });
    if (!id) return setProblem(t("list.full", { max: MAX_ROWS }));
    setProblem("");
    setAdding("");
  }

  const item = (r: Row) => {
    const editable = canEditRow(role, list.settings, list.columns, r, me);
    const extra = others.flatMap((c) => (r.cells[c.id] === undefined ? [] : [`${c.name}: ${text(c, r.cells[c.id])}`]));
    return (
      <li key={r.id} className={done(r) ? "check-item done" : "check-item"}>
        <CellInput col={check} value={r.cells[check.id]} editable={editable} onCommit={(v) => setCell(doc, r.id, check.id, v, me)} people={people} me={me} label={`${check.name}: ${String(r.cells[label.id] ?? "")}`} />
        <div className="check-text">
          <CellInput col={label} value={r.cells[label.id]} editable={editable} onCommit={(v) => setCell(doc, r.id, label.id, v, me)} people={people} me={me} label={label.name} />
          {extra.length > 0 && <span className="check-extra">{extra.join(" · ")}</span>}
        </div>
      </li>
    );
  };

  return (
    <div className="checklist">
      <ul className="check-items">{open.map(item)}</ul>
      {mayAdd && (
        <form className="check-add" onSubmit={add}>
          <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t("list.addPlaceholder")} aria-label={t("list.addPlaceholder")} enterKeyHint="done" />
          <button type="submit" className="secondary small" disabled={!adding.trim()}>
            {t("list.add")}
          </button>
        </form>
      )}
      {problem && <p className="problem">{problem}</p>}
      {ticked.length > 0 && (
        <section className="check-done" aria-label={t("list.doneSection", { n: ticked.length })}>
          <div className="check-done-head">
            <h2>{t("list.doneSection", { n: ticked.length })}</h2>
            {mayAdd && (
              <button type="button" className="link" onClick={() => removeDone(doc)}>
                {t("list.removeDone")}
              </button>
            )}
          </div>
          <ul className="check-items">{ticked.map(item)}</ul>
        </section>
      )}
    </div>
  );
}
