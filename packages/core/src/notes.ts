import * as Y from "yjs";
import { firstLine, plainLine } from "./docs";

/**
 * A note: Markdown, kept as it's written (decision 6). Its document:
 *
 * - meta: title (may be empty: the note then goes by its first line), createdBy, createdAt, updatedAt
 * - body: a Y.Text with the Markdown, which CodeMirror edits directly, so people typing at once merge
 *   character by character
 * - tags: a Y.Array of strings, the same for everyone the note is shared with (pinned and folder are
 *   each person's own: home.ts)
 */

export const NOTE_TITLE_MAX = 120;
export const TAG_MAX = 40;
export const MAX_TAGS = 20;

export interface NoteView {
  title: string;
  tags: string[];
  createdBy: number | null;
  createdAt: number;
  /** when its text last changed (createdAt until then) */
  updatedAt: number;
}

const meta = (doc: Y.Doc) => doc.getMap<unknown>("meta");
export const noteBody = (doc: Y.Doc) => doc.getText("body");
const tagsArray = (doc: Y.Doc) => doc.getArray<string>("tags");

const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** A tag as it's kept: one line, no leading #, at most TAG_MAX characters; null if nothing's left. */
export function cleanTag(raw: string): string | null {
  const t = oneLine(raw.replace(/^#+/, ""), TAG_MAX);
  return t || null;
}

const sameTag = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

export function initNote(doc: Y.Doc, o: { title?: string; body?: string; tags?: string[]; by: number }) {
  doc.transact(() => {
    meta(doc).set("title", oneLine(o.title ?? "", NOTE_TITLE_MAX));
    meta(doc).set("createdBy", o.by);
    meta(doc).set("createdAt", Date.now());
    if (o.body) noteBody(doc).insert(0, o.body);
    for (const t of o.tags ?? []) addTag(doc, t);
  });
}

export function readNote(doc: Y.Doc): NoteView {
  const m = meta(doc);
  const title = m.get("title");
  const by = m.get("createdBy");
  const at = m.get("createdAt");
  const changed = m.get("updatedAt");
  // (two devices adding the same tag at once both add it: shown once)
  const tags: string[] = [];
  for (const t of tagsArray(doc).toArray()) if (typeof t === "string" && !tags.some((x) => sameTag(x, t))) tags.push(t);
  return {
    title: typeof title === "string" ? title : "",
    tags,
    createdBy: typeof by === "number" ? by : null,
    createdAt: typeof at === "number" ? at : 0,
    updatedAt: typeof changed === "number" ? changed : typeof at === "number" ? at : 0,
  };
}

/** Its text was changed (now): for sorting notes by when they were last written in. */
export function touchNote(doc: Y.Doc) {
  meta(doc).set("updatedAt", Date.now());
}

export function setNoteTitle(doc: Y.Doc, title: string) {
  meta(doc).set("title", oneLine(title, NOTE_TITLE_MAX));
}

/** Returns whether it was added (not already there, a tag left after cleaning, and room for it). */
export function addTag(doc: Y.Doc, raw: string): boolean {
  const tag = cleanTag(raw);
  const have = readNote(doc).tags;
  if (!tag || have.length >= MAX_TAGS || have.some((t) => sameTag(t, tag))) return false;
  tagsArray(doc).push([tag]);
  return true;
}

export function removeTag(doc: Y.Doc, tag: string) {
  const arr = tagsArray(doc);
  doc.transact(() => {
    for (let i = arr.length - 1; i >= 0; i--) if (sameTag(arr.get(i), tag)) arr.delete(i, 1);
  });
}

/** Text added at the end of a note, after a blank line. */
export function appendToNote(doc: Y.Doc, text: string) {
  const body = noteBody(doc);
  const add = text.trim();
  if (!add) return;
  const now = body.toString();
  const gap = now.trim() === "" ? "" : now.endsWith("\n\n") ? "" : now.endsWith("\n") ? "\n" : "\n\n";
  body.insert(body.length, gap + add + "\n");
}

/** What a note is called: its title, else its first line. ("" if it has neither.) */
export const noteTitle = (note: NoteView, body: string) => note.title || firstLine(body);

/** A little of a note's text after what it's called, as plain words, for its card. */
export function notePreview(note: NoteView, body: string, max = 140): string {
  const lines = body.split("\n").map(plainLine).filter(Boolean);
  // (without a title the first line is the title: the preview starts after it)
  const rest = (note.title ? lines : lines.slice(1)).join(" ");
  return rest.length > max ? `${rest.slice(0, max - 1).trimEnd()}…` : rest;
}
