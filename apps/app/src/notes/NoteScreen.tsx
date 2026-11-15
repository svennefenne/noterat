import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Eye, MoreVertical, PenLine, Pin, PinOff, Share2, X } from "lucide-react";
import type * as Y from "yjs";
import { addTag, noteBody, noteTitle, objectDocName, readNote, removeTag, setNoteTitle, setPrefs, touchNote, type MemberRole } from "@noterat/core";
import { isNative } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useDocValue, useHomePrefs, useSession, useSyncState } from "../lib/sync-react";
import { Back, NotHere, useAway, usePresence, useThing } from "../things/parts";
import { ShareDialog } from "../things/ShareDialog";
import { Dialog, Menu, MenuItem, Problem, useStored } from "../ui";
import { MarkdownEditor } from "./LazyEditor";
import { Preview } from "./Preview";

const readBody = (doc: Y.Doc) => noteBody(doc).toString();

/** A note's page: only for a note this person has. */
export function NoteScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { loading, role } = useThing("note", id);
  if (loading) return <p className="muted">{t("lists.loading")}</p>;
  if (!role) return <NotHere type="note" />;
  return <NotePage id={id} role={role} />;
}

function NotePage({ id, role }: { id: string; role: MemberRole }) {
  const { t } = useI18n();
  const { sync } = useSession();
  useSyncState();
  const name = objectDocName("note", id);
  const doc = sync.doc(name);
  const note = useDocValue(doc, readNote);
  const body = useDocValue(doc, readBody);
  const allPrefs = useHomePrefs();
  const prefs = allPrefs[id] ?? {};
  const readOnly = role === "viewer";
  const [mode, setMode] = useStored<"write" | "read">(`noterat.note.${id}`, readOnly ? "read" : "write");
  const [sharing, setSharing] = useState(false);
  const [filing, setFiling] = useState(false);
  const { away, problem } = useAway("note", id);
  const awareness = sync.awareness(name);
  const title = noteTitle(note, body) || t("notes.untitled");

  usePresence(awareness);

  // when it was last written in (by this device), for the notes page's order; at most every 20 seconds
  useEffect(() => {
    let last = 0;
    const seen = (_: unknown, tr: Y.Transaction) => {
      if (!tr.local || Date.now() - last < 20_000) return;
      last = Date.now();
      touchNote(doc);
    };
    noteBody(doc).observe(seen);
    return () => noteBody(doc).unobserve(seen);
  }, [doc]);

  if (!sync.isLoaded(name)) return <p className="muted">{t("lists.loading")}</p>;

  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/markdown" }));
    a.download = `${title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "note"}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="screen note-screen">
      <div className="list-head">
        <Back type="note" />
        <div className="list-title-row">
          <TitleInput value={note.title} placeholder={noteTitle({ ...note, title: "" }, body) || t("note.titlePlaceholder")} readOnly={readOnly} onCommit={(v) => setNoteTitle(doc, v)} />
          <div className="list-actions">
            <div className="segmented" role="group" aria-label={t("note.mode")}>
              {!readOnly && (
                <button type="button" aria-pressed={mode === "write"} onClick={() => setMode("write")} title={t("note.write")}>
                  <PenLine aria-hidden size={16} />
                  <span>{t("note.write")}</span>
                </button>
              )}
              <button type="button" aria-pressed={mode === "read" || readOnly} onClick={() => setMode("read")} title={t("note.read")}>
                <Eye aria-hidden size={16} />
                <span>{t("note.read")}</span>
              </button>
            </div>
            <button type="button" className="icon-button" aria-pressed={!!prefs.pinned} onClick={() => setPrefs(sync.home, id, { pinned: !prefs.pinned })} title={t(prefs.pinned ? "note.unpin" : "note.pin")}>
              {prefs.pinned ? <PinOff aria-hidden size={18} /> : <Pin aria-hidden size={18} />}
              <span className="visually-hidden">{t(prefs.pinned ? "note.unpin" : "note.pin")}</span>
            </button>
            <button type="button" className="secondary small" onClick={() => setSharing(true)}>
              <Share2 aria-hidden size={16} /> {t("list.share")}
            </button>
            <Menu label={t("list.more")} icon={<MoreVertical aria-hidden size={20} />}>
              <MenuItem onSelect={() => setFiling(true)}>{prefs.folder ? t("note.folderIs", { folder: prefs.folder }) : t("note.toFolder")}</MenuItem>
              {!isNative && <MenuItem onSelect={download}>{t("note.download")}</MenuItem>}
              {navigator.clipboard && <MenuItem onSelect={() => void navigator.clipboard.writeText(body)}>{t("note.copy")}</MenuItem>}
              {role === "owner" ? (
                <MenuItem danger onSelect={() => void away("delete", t("note.deleteConfirm"))}>
                  {t("note.delete")}
                </MenuItem>
              ) : (
                <MenuItem danger onSelect={() => void away("leave", t("note.leaveConfirm"))}>
                  {t("note.leave")}
                </MenuItem>
              )}
            </Menu>
          </div>
        </div>
        <Tags doc={doc} tags={note.tags} readOnly={readOnly} />
        {readOnly && <p className="muted small-text">{t("note.readOnly")}</p>}
        {problem && <Problem>{problem}</Problem>}
      </div>

      {mode === "write" && !readOnly ? (
        <MarkdownEditor text={noteBody(doc)} awareness={awareness} placeholder={t("note.placeholder")} label={t("note.body")} />
      ) : (
        <Preview markdown={body} empty={t("note.empty")} />
      )}

      <Dialog open={sharing} onClose={() => setSharing(false)} title={t("share.title", { title })}>
        <ShareDialog id={id} />
      </Dialog>
      <Dialog open={filing} onClose={() => setFiling(false)} title={t("note.folderTitle")}>
        <FolderForm
          folder={prefs.folder ?? ""}
          folders={[...new Set(Object.values(allPrefs).map((p) => p.folder).filter((f): f is string => !!f))]}
          onDone={(folder) => {
            setPrefs(sync.home, id, { folder });
            setFiling(false);
          }}
        />
      </Dialog>
    </div>
  );
}

/** The title, written in place: kept when left or on Enter (Escape: as it was). */
export function TitleInput({ value, placeholder, readOnly, onCommit }: { value: string; placeholder: string; readOnly: boolean; onCommit: (v: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const settle = () => {
    if (draft !== null && draft.trim() !== value) onCommit(draft);
    setDraft(null);
  };
  if (readOnly) return <h1>{value || placeholder}</h1>;
  return (
    <input
      className="title-input"
      value={draft ?? value}
      placeholder={placeholder}
      aria-label={t("note.titleLabel")}
      maxLength={120}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={settle}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** A note's tags: shared with everyone who has it. */
function Tags({ doc, tags, readOnly }: { doc: Y.Doc; tags: string[]; readOnly: boolean }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState("");
  const add = () => {
    for (const part of adding.split(",")) addTag(doc, part);
    setAdding("");
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
    if (e.key === "Backspace" && !adding && tags.length) removeTag(doc, tags[tags.length - 1]!);
  };
  if (readOnly && tags.length === 0) return null;
  return (
    <div className="tags">
      {tags.map((tag) => (
        <span key={tag} className="badge tag">
          #{tag}
          {!readOnly && (
            <button type="button" onClick={() => removeTag(doc, tag)} aria-label={t("note.removeTag", { tag })}>
              <X aria-hidden size={12} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && <input className="tag-input" value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={keys} onBlur={() => adding && add()} placeholder={t("note.addTag")} aria-label={t("note.addTag")} />}
    </div>
  );
}

/** Which of this person's folders a note is in (theirs alone: others keep it where they like). */
function FolderForm({ folder, folders, onDone }: { folder: string; folders: string[]; onDone: (folder: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(folder);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onDone(value);
  };
  return (
    <form onSubmit={submit} className="stack">
      <p className="muted small-text">{t("note.folderHint")}</p>
      <label className="field">
        <span>{t("note.folder")}</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} list="noterat-folders" maxLength={40} data-autofocus />
        <datalist id="noterat-folders">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      <div className="dialog-actions">
        {folder && (
          <button type="button" className="secondary" onClick={() => onDone("")}>
            {t("note.noFolder")}
          </button>
        )}
        <button type="submit" className="primary">
          {t("note.save")}
        </button>
      </div>
    </form>
  );
}
