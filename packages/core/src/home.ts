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
