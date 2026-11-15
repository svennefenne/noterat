import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import type * as Y from "yjs";
import {
  addTextRows,
  appendToNote,
  canAddRows,
  entryBody,
  entryTitle,
  initNote,
  noteBody,
  noteTitle,
  objectDocName,
  readList,
  readEntry,
  readNote,
  textLines,
} from "@noterat/core";
import { useDates } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useDocsValues, useHomeItems, useSession } from "../lib/sync-react";
import { byDay, memoIntoJournal } from "../journal/fromMemo";
import { dayName } from "../journal/JournalScreen";
import { useAway } from "../things/parts";
import { Problem } from "../ui";

const readNoteName = (doc: Y.Doc) => noteTitle(readNote(doc), noteBody(doc).toString());
const readListInfo = (doc: Y.Doc) => {
  const l = readList(doc);
  return { title: l.title, settings: l.settings, text: l.columns.some((c) => c.type === "text") };
};

type Where = "newNote" | "note" | "list" | "journal";

const readEntryName = (doc: Y.Doc) => ({ entry: readEntry(doc), body: entryBody(doc).toString() });

/**
 * "Move to…": a memo's text into a new note, at the end of a note, or into a list, a row per line
 * (decision 6); or the memo itself into the journal, its recording as a clip and its text at the end
 * (a new entry for the day it was recorded, or one picked). The memo stays unless its owner chooses to
 * delete it; it's done on the device, so offline too.
 */
export function MoveDialog({ memoId, title, text, owner, onDone }: { memoId: string; title: string; text: string; owner: boolean; onDone: () => void }) {
  const { t } = useI18n();
  const dates = useDates();
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
  const entries = items.filter(([, i]) => i.type === "journal" && i.role !== "viewer");
  const entryDocs = sync.docsOf("journal", entries.map(([id]) => id));
  const entryInfo = useDocsValues(entryDocs, readEntryName);
  const usableEntries = entries.map(([id], n) => ({ id, ...entryInfo[n]! })).sort(byDay);
  const hasText = !!text.trim();
  const usableLists = lists.map(([id, i], n) => ({ id, ...listInfo[n]!, role: i.role })).filter((l) => l.text && canAddRows(l.role, l.settings));

  const [where, setWhere] = useState<Where>(hasText ? "newNote" : "journal");
  const [entryId, setEntryId] = useState("");
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
    } else if (where === "list") {
      addTextRows(sync.doc(objectDocName("list", listId)), lines, user.id);
      to = `/lists/${listId}`;
    } else {
      const id = memoIntoJournal(sync, memoId, { entryId: entryId || undefined, by: user.id });
      if (!id) return;
      to = `/journal/${id}`;
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
        {option("newNote", t("move.newNote"), !hasText)}
        {option("note", t("move.toNote"), notes.length === 0 || !hasText)}
        {where === "note" && (
          <select value={noteId} onChange={(e) => setNoteId(e.target.value)} aria-label={t("move.pickNote")}>
            {notes.map(([id], n) => (
              <option key={id} value={id}>
                {noteNames[n] || t("notes.untitled")}
              </option>
            ))}
          </select>
        )}
        {option("list", t("move.toList", { n: lines.length }), usableLists.length === 0 || !hasText)}
        {where === "list" && (
          <select value={listId} onChange={(e) => setListId(e.target.value)} aria-label={t("move.pickList")}>
            {usableLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title || t("lists.untitled")}
              </option>
            ))}
          </select>
        )}
        {option("journal", t("move.toJournal"))}
        {where === "journal" && (
          <select value={entryId} onChange={(e) => setEntryId(e.target.value)} aria-label={t("move.pickEntry")}>
            <option value="">{t("move.newEntry")}</option>
            {usableEntries.map((e) => (
              <option key={e.id} value={e.id}>
                {dayName(e.entry.date, dates, { weekday: false })}
                {entryTitle(e.entry, e.body) ? ` · ${entryTitle(e.entry, e.body)}` : ""}
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
