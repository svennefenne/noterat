import { useState, type ReactNode } from "react";
import { Folder, Pin, Plus, Search, Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import type * as Y from "yjs";
import { initNote, noteBody, notePreview, noteTitle, readNote, setPrefs, type NoteView } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useDocsValues, useHomeItems, useHomePrefs, useSession, useSyncState } from "../lib/sync-react";
import { useStored } from "../ui";

const readCard = (doc: Y.Doc) => ({ note: readNote(doc), body: noteBody(doc).toString() });

/**
 * Every note this person has, their own and the ones shared with them: pinned ones first, then the
 * most recently written in. Found by words, a folder of theirs, or a tag.
 */
export function NotesScreen() {
  const { t, lang } = useI18n();
  const { sync, user } = useSession();
  const { homeLoaded } = useSyncState();
  const [, navigate] = useLocation();
  const items = useHomeItems().filter(([, item]) => item.type === "note");
  const prefs = useHomePrefs();
  const docs = sync.docsOf("note", items.map(([id]) => id));
  const cards = useDocsValues(docs, readCard);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useStored<string>("noterat.notes.filter", "");

  const notes = items.map(([id, item], i) => ({ id, role: item.role, ...cards[i]!, prefs: prefs[id] ?? {} }));
  const folders = [...new Set(notes.map((n) => n.prefs.folder).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b, lang));
  const tags = [...new Set(notes.flatMap((n) => n.note.tags))].sort((a, b) => a.localeCompare(b, lang));
  const words = query.toLocaleLowerCase(lang).split(/\s+/).filter(Boolean);
  // (a folder or tag that's gone since it was picked: all of them again)
  const active = [...folders.map((f) => `folder:${f}`), ...tags.map((tag) => `tag:${tag}`)].includes(filter) ? filter : "";
  const shown = notes
    .filter((n) => !active || (active.startsWith("folder:") ? n.prefs.folder === active.slice(7) : n.note.tags.includes(active.slice(4))))
    .filter((n) => {
      const hay = `${n.note.title}\n${n.body}\n${n.note.tags.join(" ")}`.toLocaleLowerCase(lang);
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => Number(!!b.prefs.pinned) - Number(!!a.prefs.pinned) || b.note.updatedAt - a.note.updatedAt);

  function make() {
    const id = sync.create("note", (doc) => initNote(doc, { by: user.id, tags: active.startsWith("tag:") ? [active.slice(4)] : [] }));
    if (active.startsWith("folder:")) setPrefs(sync.home, id, { folder: active.slice(7) });
    navigate(`/notes/${id}`);
  }

  const chip = (value: string, label: string, icon?: ReactNode) => (
    <button key={value} type="button" className="chip" aria-pressed={active === value} onClick={() => setFilter(active === value ? "" : value)}>
      {icon}
      {label}
    </button>
  );

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t("notes.title")}</h1>
        <button type="button" className="primary small" onClick={make}>
          <Plus aria-hidden size={18} /> {t("notes.new")}
        </button>
      </div>
      {!homeLoaded ? (
        <p className="muted">{t("lists.loading")}</p>
      ) : notes.length === 0 ? (
        <div className="empty">
          <p>{t("notes.empty")}</p>
          <button type="button" className="primary" onClick={make}>
            <Plus aria-hidden size={18} /> {t("notes.new")}
          </button>
        </div>
      ) : (
        <>
          <label className="search">
            <Search aria-hidden size={18} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("notes.search")} aria-label={t("notes.search")} />
          </label>
          {(folders.length > 0 || tags.length > 0) && (
            <div className="chips" role="group" aria-label={t("notes.filter")}>
              {chip("", t("notes.all"))}
              {folders.map((f) => chip(`folder:${f}`, f, <Folder aria-hidden size={14} />))}
              {tags.map((tag) => chip(`tag:${tag}`, `#${tag}`))}
            </div>
          )}
          {shown.length === 0 ? (
            <p className="muted">{t("notes.noMatch")}</p>
          ) : (
            <ul className="cards">
              {shown.map((n) => (
                <NoteCard key={n.id} id={n.id} note={n.note} body={n.body} pinned={!!n.prefs.pinned} folder={n.prefs.folder} shared={n.role !== "owner"} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function NoteCard({ id, note, body, pinned, folder, shared }: { id: string; note: NoteView; body: string; pinned: boolean; folder?: string; shared: boolean }) {
  const { t, lang } = useI18n();
  const preview = notePreview(note, body);
  return (
    <li>
      <Link href={`/notes/${id}`} className="card">
        <span className="card-title">
          {pinned && <Pin aria-label={t("note.pinned")} size={14} className="pin" />}
          {noteTitle(note, body) || t("notes.untitled")}
        </span>
        {preview && <span className="card-preview">{preview}</span>}
        <span className="card-meta">
          {new Date(note.updatedAt).toLocaleDateString(lang === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "short" })}
          {folder && (
            <span className="badge">
              <Folder aria-hidden size={14} /> {folder}
            </span>
          )}
          {note.tags.map((tag) => (
            <span key={tag} className="badge tag">
              #{tag}
            </span>
          ))}
          {shared && (
            <span className="badge">
              <Users aria-hidden size={14} /> {t("lists.sharedWithYou")}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
