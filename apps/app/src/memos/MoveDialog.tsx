import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import type * as Y from "yjs";
import {
  addTextRows,
  appendToNote,
  canAddRows,
  initNote,
  noteBody,
  noteTitle,
  objectDocName,
  readList,
  readNote,
  textLines,
} from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useDocsValues, useHomeItems, useSession } from "../lib/sync-react";
import { useAway } from "../things/parts";
import { Problem } from "../ui";

const readNoteName = (doc: Y.Doc) => noteTitle(readNote(doc), noteBody(doc).toString());
const readListInfo = (doc: Y.Doc) => {
  const l = readList(doc);
  return { title: l.title, settings: l.settings, text: l.columns.some((c) => c.type === "text") };
};

type Where = "newNote" | "note" | "list";

/**
 * "Move to…": a memo's text into a new note, at the end of a note, or into a list, a row per line
 * (decision 6). The memo stays unless its owner chooses to delete it; it's done on the device, so
 * offline too.
 */
export function MoveDialog({ memoId, title, text, owner, onDone }: { memoId: string; title: string; text: string; owner: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const { sync, user } = useSession();
  const [, navigate] = useLocation();
  const items = useHomeItems();
  const { away, problem } = useAway("memo", memoId);

  const notes = items.filter(([, i]) => i.type === "note" && i.role !== "viewer");
  const lists = items.filter(([, i]) => i.type === "list" && i.role !== "viewer");
  const noteDocs = sync.docsOf("note", notes.map(([id]) => id));
  const listDocs = sync.docsOf("list", lists.map(([id]) => id));
  const noteNames = useDocsValues(noteDocs, readNoteName);
  const listInfo = useDocsValues(listDocs, readListInfo);
  const usableLists = lists.map(([id, i], n) => ({ id, ...listInfo[n]!, role: i.role })).filter((l) => l.text && canAddRows(l.role, l.settings));

  const [where, setWhere] = useState<Where>("newNote");
  const [noteId, setNoteId] = useState(notes[0]?.[0] ?? "");
  const [listId, setListId] = useState(usableLists[0]?.id ?? "");
  const [remove, setRemove] = useState(false);
  const lines = textLines(text);

  async function move(e: FormEvent) {
    e.preventDefault();
    let to: string;
    if (where === "newNote") {
      const id = sync.create("note", (doc) => initNote(doc, { title, body: `${text.trim()}\n`, by: user.id }));
      to = `/notes/${id}`;
    } else if (where === "note") {
      appendToNote(sync.doc(objectDocName("note", noteId)), text);
      to = `/notes/${noteId}`;
    } else {
      addTextRows(sync.doc(objectDocName("list", listId)), lines, user.id);
      to = `/lists/${listId}`;
    }
    if (remove && !(await away("delete", "", to))) return;
    onDone();
    navigate(to);
  }

  const option = (value: Where, label: string, disabled = false) => (
    <label className={where === value ? "template chosen" : "template"}>
      <input type="radio" name="where" checked={where === value} disabled={disabled} onChange={() => setWhere(value)} />
      <span className="template-name">{label}</span>
    </label>
  );

  return (
    <form onSubmit={(e) => void move(e)} className="stack">
      <fieldset className="templates">
        <legend className="visually-hidden">{t("move.title")}</legend>
        {option("newNote", t("move.newNote"))}
        {option("note", t("move.toNote"), notes.length === 0)}
        {where === "note" && (
          <select value={noteId} onChange={(e) => setNoteId(e.target.value)} aria-label={t("move.pickNote")}>
            {notes.map(([id], n) => (
              <option key={id} value={id}>
                {noteNames[n] || t("notes.untitled")}
              </option>
            ))}
          </select>
        )}
        {option("list", t("move.toList", { n: lines.length }), usableLists.length === 0)}
        {where === "list" && (
          <select value={listId} onChange={(e) => setListId(e.target.value)} aria-label={t("move.pickList")}>
            {usableLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title || t("lists.untitled")}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      {owner && (
        <label className="check">
          <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
          {t("move.delete")}
        </label>
      )}
      {problem && <Problem>{problem}</Problem>}
      <div className="dialog-actions">
        <button type="submit" className="primary" disabled={(where === "note" && !noteId) || (where === "list" && !listId)}>
          {t("move.go")}
        </button>
      </div>
    </form>
  );
}
