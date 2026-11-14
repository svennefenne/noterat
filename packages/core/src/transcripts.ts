import type * as Y from "yjs";
import type { ObjectType } from "./docs";
import { clipStatus, hasClip, putClipTranscript, setClipTranscription } from "./journal";
import { putTranscript, readMemo, setTranscription, type Transcription } from "./memos";

/**
 * Things with recordings in them, as the server's jobs see them (decision 7): where a recording is,
 * whether it wants transcribing, how it's coming along, and where its text goes. A memo has one
 * recording; a journal entry has a voice clip per recording.
 */

export const TRANSCRIBABLE: readonly ObjectType[] = ["memo", "journal"];
export const canTranscribe = (type: ObjectType) => TRANSCRIBABLE.includes(type);

/** Whether the thing has this recording in it (a memo's own, or one of an entry's clips). */
export function hasRecording(type: ObjectType, doc: Y.Doc, hash: string): boolean {
  if (type === "memo") return readMemo(doc).audio?.hash === hash;
  if (type === "journal") return hasClip(doc, hash);
  return false;
}

/** The recording a thing wants transcribed, if it's this one (or, without a hash, a memo's own). */
export function recordingToTranscribe(type: ObjectType, doc: Y.Doc, hash?: string): string | null {
  if (type === "memo") return readMemo(doc).audio?.hash ?? null;
  if (type === "journal" && hash) return hasClip(doc, hash) ? hash : null;
  return null;
}

export function wantsTranscript(type: ObjectType, doc: Y.Doc, hash: string): boolean {
  if (type === "memo") return readMemo(doc).audio?.hash === hash && readMemo(doc).transcription?.status === "wanted";
  if (type === "journal") return clipStatus(doc, hash) === "wanted";
  return false;
}

export function setTranscriptState(type: ObjectType, doc: Y.Doc, hash: string, t: Transcription) {
  if (type === "memo") {
    if (readMemo(doc).audio?.hash === hash) setTranscription(doc, t);
  } else if (type === "journal") setClipTranscription(doc, hash, t);
}

export function putTranscriptFor(type: ObjectType, doc: Y.Doc, hash: string, text: string, info: { language?: string; model?: string }) {
  if (type === "memo") {
    // (the memo might have had another recording put in meanwhile: then this text isn't its)
    if (readMemo(doc).audio?.hash === hash) putTranscript(doc, text, info);
  } else if (type === "journal") putClipTranscript(doc, hash, text, info);
}
