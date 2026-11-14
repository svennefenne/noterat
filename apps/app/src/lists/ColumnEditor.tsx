import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type * as Y from "yjs";
import {
  cleanColumns,
  COLUMN_TYPES,
  MAX_COLUMNS,
  MAX_ROWS,
  setColumns,
  setRowCount,
  setSettings,
  setTitle,
  type ColumnInput,
  type ColumnType,
  type ListSettings,
  type ListView,
} from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { Problem } from "../ui";

interface Draft {
  id?: string;
  name: string;
  type: ColumnType;
  options: string;
  /** (a key for React: new columns have no id yet) */
  key: string;
}

/**
 * The owner's editor: the list's name, its columns (name, kind, a choice column's choices; in order) and
 * its settings, saved at once when done. What's written in a removed column goes with it.
 */
export function ColumnEditor({ doc, list, onDone }: { doc: Y.Doc; list: ListView; onDone: () => void }) {
  const { t, errorText } = useI18n();
  const [title, setTitleDraft] = useState(list.title);
  const [cols, setCols] = useState<Draft[]>(() => list.columns.map((c) => ({ id: c.id, name: c.name, type: c.type, options: (c.options ?? []).join(", "), key: c.id })));
  const [settings, setSettingsDraft] = useState<ListSettings>(list.settings);
  const [rowCount, setRowCountDraft] = useState(String(Math.max(1, list.rows.length)));
  const [problem, setProblem] = useState("");

  const change = (i: number, patch: Partial<Draft>) => setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, by: -1 | 1) =>
    setCols((cs) => {
      const next = [...cs];
      [next[i], next[i + by]] = [next[i + by]!, next[i]!];
      return next;
    });

  function save(e: FormEvent) {
    e.preventDefault();
    const input: ColumnInput[] = cols.map((c) => ({ id: c.id, name: c.name, type: c.type, options: c.options.split(",") }));
    try {
      // (checked before anything is changed: a problem changes nothing)
      cleanColumns(input, list.columns);
      doc.transact(() => {
        setTitle(doc, title);
        setColumns(doc, input);
        setSettings(doc, settings);
        if (!settings.autoRows) setRowCount(doc, Number(rowCount) || list.rows.length || 1);
      });
      onDone();
    } catch (err) {
      setProblem(errorText(err));
    }
  }

  return (
    <form className="editor" onSubmit={save}>
      <label className="field">
        <span>{t("list.titleLabel")}</span>
        <input value={title} onChange={(e) => setTitleDraft(e.target.value)} maxLength={120} />
      </label>

      <fieldset className="editor-columns">
        <legend>{t("editor.columns")}</legend>
        <ol>
          {cols.map((c, i) => (
            <li key={c.key} className="editor-column">
              <input value={c.name} onChange={(e) => change(i, { name: e.target.value })} aria-label={`${t("editor.name")} ${i + 1}`} maxLength={60} />
              <select value={c.type} onChange={(e) => change(i, { type: e.target.value as ColumnType })} aria-label={`${t("editor.type")} ${i + 1}`}>
                {COLUMN_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`colType.${type}`)}
                  </option>
                ))}
              </select>
              <span className="editor-column-actions">
                <button type="button" className="icon-button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("editor.up")} title={t("editor.up")}>
                  <ArrowUp aria-hidden size={18} />
                </button>
                <button type="button" className="icon-button" onClick={() => move(i, 1)} disabled={i === cols.length - 1} aria-label={t("editor.down")} title={t("editor.down")}>
                  <ArrowDown aria-hidden size={18} />
                </button>
                <button type="button" className="icon-button" onClick={() => setCols((cs) => cs.filter((_, j) => j !== i))} disabled={cols.length === 1} aria-label={t("editor.remove")} title={t("editor.remove")}>
                  <Trash2 aria-hidden size={18} />
                </button>
              </span>
              {c.type === "choice" && (
                <input className="editor-choices" value={c.options} onChange={(e) => change(i, { options: e.target.value })} placeholder={t("editor.choices")} aria-label={t("editor.choices")} />
              )}
            </li>
          ))}
        </ol>
        {cols.length < MAX_COLUMNS && (
          <button type="button" className="secondary small" onClick={() => setCols((cs) => [...cs, { name: "", type: "text", options: "", key: crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36) }])}>
            <Plus aria-hidden size={16} /> {t("editor.addColumn")}
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend>{t("editor.fill")}</legend>
        {(["members", "owner"] as const).map((fill) => (
          <label key={fill} className="choice">
            <input type="radio" name="fill" checked={settings.fill === fill} onChange={() => setSettingsDraft((s) => ({ ...s, fill }))} />
            {t(fill === "members" ? "editor.fillMembers" : "editor.fillOwner")}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>{t("editor.rows")}</legend>
        <label className="choice">
          <input type="radio" name="rows" checked={settings.autoRows} onChange={() => setSettingsDraft((s) => ({ ...s, autoRows: true }))} />
          {t("editor.autoRows")}
        </label>
        <label className="choice">
          <input type="radio" name="rows" checked={!settings.autoRows} onChange={() => setSettingsDraft((s) => ({ ...s, autoRows: false }))} />
          {t("editor.fixedRows")}
        </label>
        {!settings.autoRows && (
          <label className="field inline">
            <span>{t("editor.rowCount")}</span>
            <input type="number" min={1} max={MAX_ROWS} value={rowCount} onChange={(e) => setRowCountDraft(e.target.value)} />
          </label>
        )}
        {!settings.autoRows && (
          <label className="choice">
            <input type="checkbox" checked={settings.addRows} onChange={(e) => setSettingsDraft((s) => ({ ...s, addRows: e.target.checked }))} />
            {t("editor.addRows")}
          </label>
        )}
        <label className="choice">
          <input type="checkbox" checked={settings.ownRows} onChange={(e) => setSettingsDraft((s) => ({ ...s, ownRows: e.target.checked }))} />
          {t("editor.ownRows")}
        </label>
      </fieldset>

      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onDone}>
          {t("editor.cancel")}
        </button>
        <button type="submit" className="primary">
          {t("editor.save")}
        </button>
      </div>
    </form>
  );
}
