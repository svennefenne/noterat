import type * as Y from "yjs";

/**
 * Every thing in Noterat is one Yjs document, named "<type>/<id>": "list/0b6f…". Its id is made on the
 * device, so things can be made offline; the server learns of one the first time it's synced, and its
 * maker becomes its owner. Each person also has a home document, "home/<user id>" (see home.ts).
 */

/** The kinds of thing there are (lists from phase 1, notes and voice memos from phase 2, journal entries from phase 3, scans from phase 4, recipes from phase 5, calendars from phase 6; the others arrive with their phases). */
export const OBJECT_TYPES = ["list", "note", "memo", "journal", "scan", "recipe", "calendar"] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];
export const isObjectType = (t: unknown): t is ObjectType => OBJECT_TYPES.includes(t as ObjectType);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isObjectId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);

/** Random bytes, also where crypto.randomUUID isn't there (a page on plain http isn't a "secure context"). */
export function randomHex(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** A new thing's id: a version 4 UUID. */
export function newObjectId(): string {
  const h = randomHex(16).split("");
  h[12] = "4";
  h[16] = "89ab"[parseInt(h[16]!, 16) & 3]!;
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export type DocName = { kind: "object"; type: ObjectType; id: string } | { kind: "home"; userId: number };

export const objectDocName = (type: ObjectType, id: string) => `${type}/${id}`;
export const homeDocName = (userId: number) => `home/${userId}`;

export function parseDocName(name: string): DocName | null {
  const [kind, rest, extra] = name.split("/");
  if (extra !== undefined || !rest) return null;
  if (kind === "home") {
    const userId = Number(rest);
    return Number.isInteger(userId) && userId > 0 && String(userId) === rest ? { kind: "home", userId } : null;
  }
  return isObjectType(kind) && isObjectId(rest) ? { kind: "object", type: kind, id: rest } : null;
}

/**
 * A thing's title, from its "meta" map (every type has one): what share links and invitations show. A
 * note or memo without one goes by the first line of its text.
 */
export function docTitle(doc: Y.Doc): string {
  const t = doc.getMap("meta").get("title");
  if (typeof t === "string" && t.trim()) return t.trim().slice(0, 200);
  for (const name of ["body", "text", "ingredients"]) if (doc.share.has(name)) return firstLine(doc.getText(name).toString());
  return "";
}

/** The first line of some Markdown with something in it, as plain words ("# Inköp" → "Inköp"). */
export function firstLine(text: string, max = 120): string {
  for (const raw of text.split("\n")) {
    const line = plainLine(raw);
    if (line) return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return "";
}

/** A line of Markdown without its marks: heading, list, task box, quote, emphasis, code, link targets. */
export function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+(\[[ xX]\]\s+)?)/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A word as it's matched: lower case, without accents, so "Köttbullar" and "kottbullar" are the same
 * word to search. Character by character, so a folded text lines up with the original (for snippets).
 */
export function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    const low = ch.toLowerCase();
    const base = low.normalize("NFD")[0] ?? low;
    // (only what keeps its length: "İ" lower-cases to two characters, and stays as it is)
    out += base.length === ch.length ? base : low.length === ch.length ? low : ch;
  }
  return out;
}
