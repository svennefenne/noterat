import * as Y from "yjs";
import { firstLine, plainLine } from "./docs";

/**
 * A voice memo (decision 6). Its document:
 *
 * - meta: title (may be empty: it then goes by its text's first line, else when it was recorded),
 *   createdBy, createdAt
 * - audio: the recording, by its file's hash (the file itself syncs apart: files.ts)
 * - text: a Y.Text, the transcript, which people can correct
 * - transcription: how the transcript is coming along, written by the device (wanted) and the server
 *   (queued, working with progress, done, failed)
 */

export interface MemoAudio {
  /** the file's SHA-256 */
  hash: string;
  /** e.g. audio/webm */
  type: string;
  size: number;
  /** seconds */
  duration: number;
}

export type TranscriptionStatus = "wanted" | "queued" | "working" | "done" | "failed";

export interface Transcription {
  status: TranscriptionStatus;
  /** 0–1, while working */
  progress?: number;
  language?: string;
  model?: string;
  error?: string;
  at: number;
}

export interface MemoView {
  title: string;
  createdBy: number | null;
  createdAt: number;
  audio: MemoAudio | null;
  transcription: Transcription | null;
}

export const MEMO_TITLE_MAX = 120;

const meta = (doc: Y.Doc) => doc.getMap<unknown>("meta");
const audioMap = (doc: Y.Doc) => doc.getMap<unknown>("audio");
const transcriptionMap = (doc: Y.Doc) => doc.getMap<unknown>("transcription");
export const memoText = (doc: Y.Doc) => doc.getText("text");

const STATUSES: TranscriptionStatus[] = ["wanted", "queued", "working", "done", "failed"];

export function initMemo(doc: Y.Doc, o: { title?: string; audio: MemoAudio; transcribe: boolean; by: number }) {
  doc.transact(() => {
    meta(doc).set("title", (o.title ?? "").replace(/\s+/g, " ").trim().slice(0, MEMO_TITLE_MAX));
    meta(doc).set("createdBy", o.by);
    meta(doc).set("createdAt", Date.now());
    for (const [k, v] of Object.entries(o.audio)) audioMap(doc).set(k, v);
    if (o.transcribe) setTranscription(doc, { status: "wanted", at: Date.now() });
  });
}

export function readMemo(doc: Y.Doc): MemoView {
  const m = meta(doc);
  const a = audioMap(doc);
  const t = transcriptionMap(doc);
  const title = m.get("title");
  const by = m.get("createdBy");
  const at = m.get("createdAt");
  const hash = a.get("hash");
  const status = t.get("status") as TranscriptionStatus;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    title: typeof title === "string" ? title : "",
    createdBy: typeof by === "number" ? by : null,
    createdAt: typeof at === "number" ? at : 0,
    audio:
      typeof hash === "string"
        ? { hash, type: str(a.get("type")) ?? "audio/webm", size: Number(a.get("size")) || 0, duration: Number(a.get("duration")) || 0 }
        : null,
    transcription: STATUSES.includes(status)
      ? {
          status,
          progress: typeof t.get("progress") === "number" ? (t.get("progress") as number) : undefined,
          language: str(t.get("language")),
          model: str(t.get("model")),
          error: str(t.get("error")),
          at: Number(t.get("at")) || 0,
        }
      : null,
  };
}

export function setMemoTitle(doc: Y.Doc, title: string) {
  meta(doc).set("title", title.replace(/\s+/g, " ").trim().slice(0, MEMO_TITLE_MAX));
}

/** The transcription's state, as a whole (what isn't given is cleared). */
export function setTranscription(doc: Y.Doc, t: Transcription) {
  const map = transcriptionMap(doc);
  doc.transact(() => {
    for (const k of [...map.keys()]) if (k !== "raw" && !(k in t)) map.delete(k);
    for (const [k, v] of Object.entries(t)) if (v !== undefined) map.set(k, v);
  });
}

/**
 * A finished transcript into the memo. It replaces the text if that's empty or still what the last
 * transcript said; if someone has written in it since, the new one goes after what they wrote.
 */
export function putTranscript(doc: Y.Doc, text: string, info: { language?: string; model?: string }) {
  const body = memoText(doc);
  const map = transcriptionMap(doc);
  const now = body.toString();
  const before = map.get("raw");
  doc.transact(() => {
    if (now.trim() === "" || now === before) {
      body.delete(0, body.length);
      body.insert(0, text);
    } else if (text.trim()) body.insert(body.length, `\n\n${text}`);
    map.set("raw", text);
    setTranscription(doc, { status: "done", language: info.language, model: info.model, at: Date.now() });
  });
}

/** What a memo is called: its title, else its text's first line ("" if neither: the app shows its date). */
export const memoTitle = (memo: MemoView, text: string) => memo.title || firstLine(text, 80);

/** Text as list rows: one per line, without list marks and blank lines. */
export function textLines(text: string, max = 300): string[] {
  return text
    .split("\n")
    .map((l) => plainLine(l))
    .filter(Boolean)
    .slice(0, max);
}
