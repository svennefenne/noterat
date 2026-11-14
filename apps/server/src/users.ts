import type { Role, User } from "@noterat/core";
import type { DB } from "./db";

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: Role;
  created_at: number;
}

export const toUser = (r: UserRow): User => ({ id: r.id, username: r.username, displayName: r.display_name, role: r.role });

export function userCount(db: DB): number {
  return (db.prepare("select count(*) n from users").get() as { n: number }).n;
}

/** (usernames are matched without regard to case: "Anna" logs in as "anna") */
export function userByUsername(db: DB, username: string): UserRow | null {
  return (db.prepare("select * from users where username = ?").get(username) as UserRow | undefined) ?? null;
}

export function createUser(db: DB, o: { username: string; displayName: string; passwordHash: string; role: Role }): User {
  const id = Number(
    db
      .prepare("insert into users (username, display_name, password_hash, role, created_at) values (?, ?, ?, ?, ?)")
      .run(o.username, o.displayName, o.passwordHash, o.role, Date.now()).lastInsertRowid,
  );
  return { id, username: o.username, displayName: o.displayName, role: o.role };
}
