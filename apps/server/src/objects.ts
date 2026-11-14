import type { Member, MemberRole, ObjectType, Person, ShareRole } from "@noterat/core";
import type { DB } from "./db";

/**
 * Things (a list…) and who has them, as the server keeps them. The thing itself is its Yjs document
 * (state); the server reads only its title from it.
 */

export interface ObjectRow {
  id: string;
  type: ObjectType;
  owner_id: number;
  title: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const ROLE_RANK: Record<MemberRole, number> = { viewer: 1, editor: 2, owner: 3 };

export function objectRow(db: DB, id: string): ObjectRow | null {
  return (db.prepare("select id, type, owner_id, title, created_at, updated_at, deleted_at from objects where id = ?").get(id) as ObjectRow | undefined) ?? null;
}

/** A thing the server hasn't seen before, synced for the first time: its maker owns it. */
export function createObject(db: DB, o: { id: string; type: ObjectType; ownerId: number }) {
  const t = Date.now();
  db.transaction(() => {
    const made = db.prepare("insert or ignore into objects (id, type, owner_id, created_at, updated_at) values (?, ?, ?, ?, ?)").run(o.id, o.type, o.ownerId, t, t);
    if (made.changes) db.prepare("insert into members (object_id, user_id, role, added_at) values (?, ?, 'owner', ?)").run(o.id, o.ownerId, t);
  })();
}

export function roleOf(db: DB, objectId: string, userId: number): MemberRole | null {
  return (db.prepare("select role from members where object_id = ? and user_id = ?").get(objectId, userId) as { role: MemberRole } | undefined)?.role ?? null;
}

export function membersOf(db: DB, objectId: string): Member[] {
  const rows = db
    .prepare("select m.role, u.id, u.username, u.display_name from members m join users u on u.id = m.user_id where m.object_id = ? order by m.added_at")
    .all(objectId) as { role: MemberRole; id: number; username: string; display_name: string }[];
  return rows.map((r) => ({ role: r.role, person: { id: r.id, username: r.username, displayName: r.display_name } }));
}

/**
 * Someone gets a thing (or a better role on it: an editor's link makes a viewer an editor, a viewer's
 * link leaves an editor one). Returns whether anything changed.
 */
export function addMember(db: DB, objectId: string, userId: number, role: ShareRole): boolean {
  const had = roleOf(db, objectId, userId);
  if (had && ROLE_RANK[had] >= ROLE_RANK[role]) return false;
  db.prepare("insert into members (object_id, user_id, role, added_at) values (?, ?, ?, ?) on conflict(object_id, user_id) do update set role = excluded.role").run(
    objectId,
    userId,
    role,
    Date.now(),
  );
  return true;
}

export function setRole(db: DB, objectId: string, userId: number, role: ShareRole) {
  db.prepare("update members set role = ? where object_id = ? and user_id = ? and role != 'owner'").run(role, objectId, userId);
}

export function removeMember(db: DB, objectId: string, userId: number) {
  db.prepare("delete from members where object_id = ? and user_id = ? and role != 'owner'").run(objectId, userId);
}

/** Deleted: no one has it any more, its document is let go, and its row stays to say so. */
export function deleteObject(db: DB, objectId: string) {
  const t = Date.now();
  db.transaction(() => {
    db.prepare("update objects set deleted_at = ?, updated_at = ?, state = null where id = ?").run(t, t, objectId);
    db.prepare("delete from members where object_id = ?").run(objectId);
    db.prepare("delete from invites where object_id = ?").run(objectId);
    // (its files stay while something else refers to them; its jobs stop)
    db.prepare("delete from file_refs where object_id = ?").run(objectId);
    db.prepare("update jobs set status = 'cancelled', updated_at = ? where object_id = ? and status in ('queued', 'working')").run(t, objectId);
  })();
}

export function people(db: DB): Person[] {
  const rows = db.prepare("select id, username, display_name from users order by display_name collate nocase").all() as { id: number; username: string; display_name: string }[];
  return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name }));
}

export function person(db: DB, id: number): Person | null {
  const r = db.prepare("select id, username, display_name from users where id = ?").get(id) as { id: number; username: string; display_name: string } | undefined;
  return r ? { id: r.id, username: r.username, displayName: r.display_name } : null;
}

// ───────────── documents ─────────────

export function loadObjectState(db: DB, id: string): Uint8Array | null {
  const r = db.prepare("select state from objects where id = ? and deleted_at is null").get(id) as { state: Buffer | null } | undefined;
  return r?.state ? new Uint8Array(r.state) : null;
}

export function storeObjectState(db: DB, id: string, state: Uint8Array, title: string) {
  db.prepare("update objects set state = ?, title = ?, updated_at = ? where id = ? and deleted_at is null").run(Buffer.from(state), title, Date.now(), id);
}

export function loadHomeState(db: DB, userId: number): Uint8Array | null {
  const r = db.prepare("select state from homes where user_id = ?").get(userId) as { state: Buffer } | undefined;
  return r ? new Uint8Array(r.state) : null;
}

export function storeHomeState(db: DB, userId: number, state: Uint8Array) {
  db.prepare("insert into homes (user_id, state, updated_at) values (?, ?, ?) on conflict(user_id) do update set state = excluded.state, updated_at = excluded.updated_at").run(
    userId,
    Buffer.from(state),
    Date.now(),
  );
}
