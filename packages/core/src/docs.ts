import type * as Y from "yjs";

/**
 * Every thing in Noterat is one Yjs document, named "<type>/<id>": "list/0b6f…". Its id is made on the
 * device, so things can be made offline; the server learns of one the first time it's synced, and its
 * maker becomes its owner. Each person also has a home document, "home/<user id>" (see home.ts).
 */

/** The kinds of thing there are (phase 1: lists; the others arrive with their phases). */
export const OBJECT_TYPES = ["list"] as const;
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

/** A thing's title, from its "meta" map (every type has one): what share links and invitations show. */
export function docTitle(doc: Y.Doc): string {
  const t = doc.getMap("meta").get("title");
  return typeof t === "string" ? t.trim().slice(0, 200) : "";
}
