import * as Y from "yjs";
import { firstLine, plainLine } from "./docs";
import { memoText, readMemo, type Transcription, type TranscriptionStatus } from "./memos";

/**
 * A journal entry (decision 7). Its document:
 *
 * - meta: title (may be empty), date (the day it's about, "YYYY-MM-DD"), createdBy, createdAt, updatedAt
 * - body: a Y.Text of Markdown, written as a note is
 * - photos: a Y.Array of photos, by their file's hash
 * - clips: a Y.Map of voice clips by their file's hash, each a Y.Map: the recording, and how its
 *   transcription is coming along (as a memo's); the text goes at the end of the body
 */

export interface Photo {
  hash: string;
  type: string;
  size: number;
  width: number;
  height: number;
  at: number;
}

export interface Clip {
  hash: string;
  type: string;
  size: number;
  /** seconds */
  duration: number;
  at: number;
  transcription: Transcription | null;
}

export interface EntryView {
  title: string;
  /** "YYYY-MM-DD" */
  date: string;
  createdBy: number | null;
  createdAt: number;
  updatedAt: number;
  photos: Photo[];
  clips: Clip[];
}

export const ENTRY_TITLE_MAX = 120;
export const MAX_PHOTOS = 30;

const meta = (doc: Y.Doc) => doc.getMap<unknown>("meta");
export const entryBody = (doc: Y.Doc) => doc.getText("body");
const photosArray = (doc: Y.Doc) => doc.getArray<Photo>("photos");
const clipsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("clips");

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (d: unknown): d is string => typeof d === "string" && DATE.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));

/** A day as kept: "YYYY-MM-DD", in the device's own time zone. */
export function dayOf(t: Date | number = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUSES: TranscriptionStatus[] = ["wanted", "queued", "working", "done", "failed"];

export function initEntry(doc: Y.Doc, o: { date?: string; title?: string; body?: string; by: number }) {
  doc.transact(() => {
    const m = meta(doc);
    m.set("title", (o.title ?? "").replace(/\s+/g, " ").trim().slice(0, ENTRY_TITLE_MAX));
    m.set("date", isDay(o.date) ? o.date : dayOf());
    m.set("createdBy", o.by);
    m.set("createdAt", Date.now());
    if (o.body) entryBody(doc).insert(0, o.body);
  });
}

function readClip(m: Y.Map<unknown>): Clip | null {
  const hash = m.get("hash");
  if (typeof hash !== "string") return null;
  const status = m.get("status") as TranscriptionStatus;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    hash,
    type: str(m.get("type")) ?? "audio/webm",
    size: Number(m.get("size")) || 0,
    duration: Number(m.get("duration")) || 0,
    at: Number(m.get("at")) || 0,
    transcription: STATUSES.includes(status)
      ? {
          status,
          progress: typeof m.get("progress") === "number" ? (m.get("progress") as number) : undefined,
          language: str(m.get("language")),
          model: str(m.get("model")),
          error: str(m.get("error")),
          at: Number(m.get("statusAt")) || 0,
        }
      : null,
  };
}

export function readEntry(doc: Y.Doc): EntryView {
  const m = meta(doc);
  const title = m.get("title");
  const date = m.get("date");
  const by = m.get("createdBy");
  const at = m.get("createdAt");
  const changed = m.get("updatedAt");
  const createdAt = typeof at === "number" ? at : 0;
  return {
    title: typeof title === "string" ? title : "",
    date: isDay(date) ? date : dayOf(createdAt || Date.now()),
    createdBy: typeof by === "number" ? by : null,
    createdAt,
    updatedAt: typeof changed === "number" ? changed : createdAt,
    photos: photosArray(doc)
      .toArray()
      .filter((p) => p && typeof p.hash === "string"),
    clips: [...clipsMap(doc).values()]
      .map(readClip)
      .filter((c): c is Clip => c !== null)
      .sort((a, b) => a.at - b.at),
  };
}

export function setEntryTitle(doc: Y.Doc, title: string) {
  meta(doc).set("title", title.replace(/\s+/g, " ").trim().slice(0, ENTRY_TITLE_MAX));
}

export function setEntryDate(doc: Y.Doc, date: string) {
  if (isDay(date)) meta(doc).set("date", date);
}

/** Its text was changed (now). */
export function touchEntry(doc: Y.Doc) {
  meta(doc).set("updatedAt", Date.now());
}

/** Returns whether it was added (not there already, and room for it). */
export function addPhoto(doc: Y.Doc, photo: Omit<Photo, "at">): boolean {
  const arr = photosArray(doc);
  if (arr.length >= MAX_PHOTOS || arr.toArray().some((p) => p.hash === photo.hash)) return false;
  arr.push([{ ...photo, at: Date.now() }]);
  return true;
}

export function removePhoto(doc: Y.Doc, hash: string) {
  const arr = photosArray(doc);
  doc.transact(() => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr.get(i)?.hash === hash) arr.delete(i, 1);
  });
}

/** A voice clip recorded into the entry (wanting its text, or not). */
export function addClip(doc: Y.Doc, clip: { hash: string; type: string; size: number; duration: number }, transcribe: boolean) {
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    clipsMap(doc).set(clip.hash, m);
    for (const [k, v] of Object.entries(clip)) m.set(k, v);
    m.set("at", Date.now());
    if (transcribe) {
      m.set("status", "wanted");
      m.set("statusAt", Date.now());
    }
  });
}

export const hasClip = (doc: Y.Doc, hash: string) => clipsMap(doc).has(hash);

export function clipStatus(doc: Y.Doc, hash: string): TranscriptionStatus | null {
  const s = clipsMap(doc).get(hash)?.get("status") as TranscriptionStatus;
  return STATUSES.includes(s) ? s : null;
}

export function removeClip(doc: Y.Doc, hash: string) {
  clipsMap(doc).delete(hash);
}

/** How a clip's transcription stands, as a whole (what isn't given is cleared). */
export function setClipTranscription(doc: Y.Doc, hash: string, t: Transcription): boolean {
  const m = clipsMap(doc).get(hash);
  if (!m) return false;
  doc.transact(() => {
    for (const k of ["status", "progress", "language", "model", "error", "statusAt"]) m.delete(k);
    for (const [k, v] of Object.entries(t)) if (v !== undefined) m.set(k === "at" ? "statusAt" : k, v);
  });
  return true;
}

/** A clip's finished text: at the end of the entry, after a blank line. */
export function putClipTranscript(doc: Y.Doc, hash: string, text: string, info: { language?: string; model?: string }) {
  if (!clipsMap(doc).has(hash)) return;
  doc.transact(() => {
    const body = entryBody(doc);
    const add = text.trim();
    if (add) {
      const now = body.toString();
      const gap = now.trim() === "" ? "" : now.endsWith("\n\n") ? "" : now.endsWith("\n") ? "\n" : "\n\n";
      body.insert(body.length, `${gap}${add}\n`);
    }
    setClipTranscription(doc, hash, { status: "done", language: info.language, model: info.model, at: Date.now() });
  });
}

/** What an entry is called: its title, else its first line ("" if neither: the app shows its day). */
export const entryTitle = (entry: EntryView, body: string) => entry.title || firstLine(body, 80);

/** A little of an entry's text after what it's called, as plain words, for its card. */
export function entryPreview(entry: EntryView, body: string, max = 160): string {
  const lines = body.split("\n").map(plainLine).filter(Boolean);
  const rest = (entry.title ? lines : lines.slice(1)).join(" ");
  return rest.length > max ? `${rest.slice(0, max - 1).trimEnd()}…` : rest;
}

/**
 * A voice memo into a journal entry: its recording becomes one of the entry's clips, and its text (if
 * it has any yet) goes at the end, as a clip's would. A memo still waiting for its text has the clip
 * want it instead. Returns false if the memo has no recording (or the entry has it already).
 */
export function memoToEntry(memo: Y.Doc, entry: Y.Doc): boolean {
  const m = readMemo(memo);
  if (!m.audio || hasClip(entry, m.audio.hash)) return false;
  const { hash, type, size, duration } = m.audio;
  const text = memoText(memo).toString().trim();
  const waiting = !text && !!m.transcription && m.transcription.status !== "failed";
  entry.transact(() => {
    addClip(entry, { hash, type, size, duration }, waiting);
    if (text) putClipTranscript(entry, hash, text, { language: m.transcription?.language, model: m.transcription?.model });
  });
  return true;
}
