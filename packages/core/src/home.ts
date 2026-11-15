import type * as Y from "yjs";
import type { MemberRole, ShareRole } from "./api";
import type { ObjectType } from "./docs";

/**
 * Each person's home document, "home/<user id>", only ever opened by them (and the server):
 *
 * - items: what they have, their own things and the ones shared with them, by id, with their role on
 *   each (so the app knows it offline too). The device adds what it makes (offline too); the server adds
 *   what's shared with them, changes their role when the owner does, and takes away what they no longer
 *   have (deleted, or no longer shared).
 * - invitations: someone on the same server wants to share something with them. The server puts it
 *   here, so it shows at once on every device that's online; accepting or declining goes through the API.
 * - prefs: how they keep their things (pinned, in which folder), by id. Only their devices write it, so
 *   it never meets the server's changes to items. (Decision 6.)
 */

export interface HomeItem {
  type: ObjectType;
  role: MemberRole;
  addedAt: number;
}

export interface Invitation {
  id: string;
  objectId: string;
  type: ObjectType;
  title: string;
  role: ShareRole;
  from: { id: number; displayName: string };
  at: number;
}

export const homeItems = (doc: Y.Doc) => doc.getMap<HomeItem>("items");
export const homeInvitations = (doc: Y.Doc) => doc.getMap<Invitation>("invitations");

/** One person's way of keeping a thing: not shared with anyone it's shared with. */
export interface ItemPrefs {
  pinned?: boolean;
  /** a folder's name ("" or missing: none) */
  folder?: string;
}

export const homePrefs = (doc: Y.Doc) => doc.getMap<ItemPrefs>("prefs");

export const FOLDER_MAX = 40;

/** Change how someone keeps a thing (pinned, folder); what's left empty is dropped. */
export function setPrefs(doc: Y.Doc, id: string, patch: Partial<ItemPrefs>) {
  const next: ItemPrefs = { ...homePrefs(doc).get(id), ...patch };
  if (!next.pinned) delete next.pinned;
  next.folder = (next.folder ?? "").replace(/\s+/g, " ").trim().slice(0, FOLDER_MAX);
  if (!next.folder) delete next.folder;
  if (Object.keys(next).length === 0) homePrefs(doc).delete(id);
  else homePrefs(doc).set(id, next);
}

// ───────────── notices on the desktop ─────────────

/**
 * The desktop app shows the same notices a phone gets a push for, while it runs (decision 12). It says
 * hello on its home document once it's let in, and the server sends each notice there as a stateless
 * message, on the connection the app always has open: no Firebase, nothing else to keep open. A phone
 * (which gets a push) and the website don't say hello, so they get none.
 */
export const DESKTOP_HELLO = "noterat:desktop";

export type NoticeKind = "invitation" | "transcribed" | "scanned" | "test";

/** What happened (never what's in it), and where a click leads: a path in the app. */
export interface Notice {
  notice: NoticeKind;
  url: string;
  /** an invitation's: who shared, and what kind of thing */
  from?: string;
  type?: ObjectType;
}

const NOTICE_KINDS: readonly string[] = ["invitation", "transcribed", "scanned", "test"] satisfies NoticeKind[];

export function readNotice(payload: string): Notice | null {
  let n: Partial<Record<keyof Notice, unknown>>;
  try {
    n = JSON.parse(payload) as typeof n;
  } catch {
    return null;
  }
  if (typeof n !== "object" || n === null || typeof n.notice !== "string" || !NOTICE_KINDS.includes(n.notice)) return null;
  const url = typeof n.url === "string" && n.url.startsWith("/") && !n.url.startsWith("//") ? n.url : "/";
  return {
    notice: n.notice as NoticeKind,
    url,
    ...(typeof n.from === "string" ? { from: n.from } : {}),
    ...(typeof n.type === "string" ? { type: n.type as ObjectType } : {}),
  };
}
