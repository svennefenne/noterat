import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, ImagePlus, Mic, MoreVertical, Share2, Trash2, X } from "lucide-react";
import type * as Y from "yjs";
import {
  addClip,
  addPhoto,
  entryBody,
  entryTitle,
  MAX_PHOTOS,
  objectDocName,
  readEntry,
  removeClip,
  removePhoto,
  setEntryDate,
  setEntryTitle,
  touchEntry,
  type MemberRole,
  type Photo,
} from "@noterat/core";
import { ApiError, isNative } from "../lib/api";
import { useDates } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { shrinkPhoto } from "../lib/images";
import { useDocValue, useSession, useSyncState } from "../lib/sync-react";
import { clock, Player, TranscriptStatus } from "../memos/parts";
import { RecordPanel, useAutoTranscribe } from "../memos/RecordPanel";
import { MarkdownEditor } from "../notes/LazyEditor";
import { TitleInput } from "../notes/NoteScreen";
import { Back, NotHere, useAway, usePresence, useThing } from "../things/parts";
import { ShareDialog } from "../things/ShareDialog";
import { useFileUrl } from "../things/useFileUrl";
import { Dialog, Menu, MenuItem, Problem } from "../ui";
import { FromMemos } from "./FromMemos";
import { dayName } from "./JournalScreen";

const readBody = (doc: Y.Doc) => entryBody(doc).toString();

/** A journal entry's page: only for an entry this person has (behind the lock, when it's on). */
export function EntryScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { loading, role } = useThing("journal", id);
  if (loading) return <p className="muted">{t("lists.loading")}</p>;
  if (!role) return <NotHere type="journal" />;
  return <EntryPage id={id} role={role} />;
}

function EntryPage({ id, role }: { id: string; role: MemberRole }) {
  const { t, errorText } = useI18n();
  const dates = useDates();
  const { sync, api } = useSession();
  useSyncState();
  const name = objectDocName("journal", id);
  const doc = sync.doc(name);
  const entry = useDocValue(doc, readEntry);
  const body = useDocValue(doc, readBody);
  const [auto] = useAutoTranscribe();
  const [sharing, setSharing] = useState(false);
  const [shown, setShown] = useState<Photo | null>(null);
  const [adding, setAdding] = useState(0);
  const [picking, setPicking] = useState(false);
  const { away, problem, setProblem } = useAway("journal", id);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const readOnly = role === "viewer";
  const awareness = sync.awareness(name);
  usePresence(awareness);
  const title = entryTitle(entry, body) || dayName(entry.date, dates);

  // when it was last written in (by this device), at most every 20 seconds
  useEffect(() => {
    let last = 0;
    const seen = (_: unknown, tr: Y.Transaction) => {
      if (!tr.local || Date.now() - last < 20_000) return;
      last = Date.now();
      touchEntry(doc);
    };
    entryBody(doc).observe(seen);
    return () => entryBody(doc).unobserve(seen);
  }, [doc]);

  async function photos(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    setProblem("");
    setAdding(files.length);
    for (const file of files) {
      const shrunk = await shrinkPhoto(file);
      if (!shrunk) {
        setProblem(t("entry.notAPhoto", { name: file.name }));
      } else {
        // (the file first, so it's on the device when the entry shows it)
        const { hash } = await sync.files.add(shrunk.blob, id);
        addPhoto(doc, { hash, type: "image/jpeg", size: shrunk.blob.size, width: shrunk.width, height: shrunk.height });
      }
      setAdding((n) => n - 1);
    }
  }

  async function clip(blob: Blob, duration: number) {
    const { hash } = await sync.files.add(blob, id);
    addClip(doc, { hash, type: blob.type || "audio/webm", size: blob.size, duration }, auto === "on");
  }

  async function transcribe(hash: string) {
    setProblem("");
    try {
      await api.transcribe(id, hash);
    } catch (err) {
      setProblem(err instanceof ApiError && err.code === "network" ? t("list.needsOnline") : errorText(err));
    }
  }

  if (!sync.isLoaded(name)) return <p className="muted">{t("lists.loading")}</p>;

  return (
    <div className="screen entry-screen">
      <div className="list-head">
        <Back type="journal" />
        <div className="list-title-row">
          <TitleInput value={entry.title} placeholder={entryTitle({ ...entry, title: "" }, body) || t("entry.titlePlaceholder")} readOnly={readOnly} onCommit={(v) => setEntryTitle(doc, v)} />
          <div className="list-actions">
            <button type="button" className="secondary small" onClick={() => setSharing(true)}>
              <Share2 aria-hidden size={16} /> {t("list.share")}
            </button>
            <Menu label={t("list.more")} icon={<MoreVertical aria-hidden size={20} />}>
              {role === "owner" ? (
                <MenuItem danger onSelect={() => void away("delete", t("entry.deleteConfirm"))}>
                  {t("entry.delete")}
                </MenuItem>
              ) : (
                <MenuItem danger onSelect={() => void away("leave", t("entry.leaveConfirm"))}>
                  {t("entry.leave")}
                </MenuItem>
              )}
            </Menu>
          </div>
        </div>
        <label className="entry-date-field">
          <span className="visually-hidden">{t("entry.day")}</span>
          <input type="date" value={entry.date} disabled={readOnly} onChange={(e) => setEntryDate(doc, e.target.value)} />
          <span className="muted small-text">{dayName(entry.date, dates, { year: true })}</span>
        </label>
        {problem && <Problem>{problem}</Problem>}
      </div>

      <MarkdownEditor text={entryBody(doc)} awareness={awareness} readOnly={readOnly} placeholder={t("entry.placeholder")} label={t("entry.body")} />

      <section className="entry-section" aria-label={t("entry.photos")}>
        <div className="entry-section-head">
          <h2>{t("entry.photos")}</h2>
          {!readOnly && entry.photos.length < MAX_PHOTOS && (
            <div className="entry-section-actions">
              {/* (straight to the camera on a phone: capture; a computer would only offer files) */}
              {(isNative || matchMedia("(pointer: coarse)").matches) && (
                <>
                  <button type="button" className="secondary small" onClick={() => camera.current?.click()} disabled={adding > 0}>
                    <Camera aria-hidden size={16} /> {t("entry.takePhoto")}
                  </button>
                  <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void photos(e)} />
                </>
              )}
              <button type="button" className="secondary small" onClick={() => picker.current?.click()} disabled={adding > 0}>
                <ImagePlus aria-hidden size={16} /> {adding > 0 ? t("entry.addingPhotos", { n: adding }) : t("entry.addPhotos")}
              </button>
              <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => void photos(e)} />
            </div>
          )}
        </div>
        {entry.photos.length > 0 && (
          <ul className="photo-grid">
            {entry.photos.map((p) => (
              <li key={p.hash}>
                <button type="button" className="photo" onClick={() => setShown(p)} aria-label={t("entry.showPhoto")}>
                  <PhotoImage hash={p.hash} />
                </button>
                {!readOnly && (
                  <button type="button" className="photo-remove" onClick={() => confirm(t("entry.removePhotoConfirm")) && removePhoto(doc, p.hash)} aria-label={t("entry.removePhoto")}>
                    <X aria-hidden size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="entry-section" aria-label={t("entry.clips")}>
        <div className="entry-section-head">
          <h2>{t("entry.clips")}</h2>
        </div>
        {entry.clips.map((c) => (
          <div key={c.hash} className="clip">
            <Player hash={c.hash} />
            <div className="clip-meta">
              <span className="muted small-text">{clock(c.duration)}</span>
              <TranscriptStatus hash={c.hash} transcription={c.transcription} detail />
              {!readOnly && (!c.transcription || c.transcription.status === "failed") && (
                <button type="button" className="link-button small-text" onClick={() => void transcribe(c.hash)}>
                  {t("memo.transcribe")}
                </button>
              )}
              {!readOnly && (
                <button type="button" className="icon-button" onClick={() => confirm(t("entry.removeClipConfirm")) && removeClip(doc, c.hash)} aria-label={t("entry.removeClip")}>
                  <Trash2 aria-hidden size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <>
            <RecordPanel onRecorded={clip} compact />
            <button type="button" className="secondary small from-memos" onClick={() => setPicking(true)}>
              <Mic aria-hidden size={16} /> {t("fromMemos.open")}
            </button>
          </>
        )}
      </section>

      <Dialog open={sharing} onClose={() => setSharing(false)} title={t("share.title", { title })}>
        <ShareDialog id={id} />
      </Dialog>
      <Dialog open={picking} onClose={() => setPicking(false)} title={t("fromMemos.title")}>
        <FromMemos entryId={id} has={entry.clips.map((c) => c.hash)} onDone={() => setPicking(false)} />
      </Dialog>
      <Dialog open={!!shown} onClose={() => setShown(null)} title={title} wide>
        {shown && <PhotoImage hash={shown.hash} large />}
      </Dialog>
    </div>
  );
}

function PhotoImage({ hash, large = false }: { hash: string; large?: boolean }) {
  const { t } = useI18n();
  const url = useFileUrl(hash);
  if (url === null) return <span className="photo-missing small-text">{t("entry.photoMissing")}</span>;
  if (!url) return <span className="photo-missing" aria-hidden />;
  return <img src={url} alt="" className={large ? "photo-large" : undefined} loading="lazy" />;
}
