import type { Context, Hono } from "hono";
import { ACCOUNT_CHANGED, checkDisplayName, checkPassword, checkUsername, type ObjectType, type Role } from "@noterat/core";
import { hashPassword } from "./auth";
import type { DB } from "./db";
import { Fail, readBody, requireAdmin, signedIn, text, type Env } from "./http";
import { deleteObject } from "./objects";
import type { Sync } from "./sync";
import { createUser, type UserRow } from "./users";

/**
 * The household's accounts, for an admin (decision 14): who's here, when they were last seen and on how
 * many devices; adding someone (before, only a share link let anyone in), renaming them, making them an
 * admin or not, a new password, logging them out everywhere, and removing them. There's always an admin
 * left, and nobody removes themselves.
 */

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  createdAt: number;
  /** when one of their devices last asked anything, or null (never logged in) */
  lastSeen: number | null;
  /** how many devices are logged in */
  devices: number;
  /** how many things are theirs */
  owns: number;
}

/** what removing someone does to the things that are theirs */
export interface Removal {
  /** shared with others: the one who has had it longest takes it over (an editor before a viewer) */
  handedOver: number;
  /** no one else has them: they go */
  deleted: number;
}

export function adminRoutes(app: Hono<Env>, o: { db: DB; sync: Sync }) {
  const { db, sync } = o;
  const auth = signedIn(db);

  const row = (id: number) => (db.prepare("select * from users where id = ?").get(id) as UserRow | undefined) ?? null;
  const admins = () => (db.prepare("select count(*) n from users where role = 'admin'").get() as { n: number }).n;

  function adminUser(r: UserRow): AdminUser {
    const s = db.prepare("select count(*) n, max(last_used) last from sessions where user_id = ? and expires_at > ?").get(r.id, Date.now()) as { n: number; last: number | null };
    const owns = (db.prepare("select count(*) n from objects where owner_id = ? and deleted_at is null").get(r.id) as { n: number }).n;
    return { id: r.id, username: r.username, displayName: r.display_name, role: r.role, createdAt: r.created_at, lastSeen: s.last, devices: s.n, owns };
  }

  /** the one asked about, and that the one asking is an admin */
  const target = (c: Context<Env>) => {
    requireAdmin(c.get("user"));
    const r = row(Number(c.req.param("id")));
    if (!r) throw new Fail("not_found", 404);
    return r;
  };

  /** What's theirs, and who takes over each shared thing. */
  function plan(userId: number) {
    const owned = db.prepare("select id, type from objects where owner_id = ? and deleted_at is null").all(userId) as { id: string; type: ObjectType }[];
    return owned.map((obj) => {
      const heir = db
        .prepare("select user_id from members where object_id = ? and user_id != ? and role != 'owner' order by case role when 'editor' then 0 else 1 end, added_at limit 1")
        .get(obj.id, userId) as { user_id: number } | undefined;
      return { ...obj, heir: heir?.user_id ?? null };
    });
  }

  /** Every device of theirs logged out (but the one asking, if it's themselves). */
  function logOut(userId: number, keepSession: string | null) {
    db.prepare("delete from sessions where user_id = ? and id != ?").run(userId, keepSession ?? "");
    if (!keepSession) sync.closeUser(userId);
  }

  app.get("/api/admin/users", auth, (c) => {
    requireAdmin(c.get("user"));
    const rows = db.prepare("select * from users order by created_at").all() as UserRow[];
    return c.json(rows.map(adminUser));
  });

  app.post("/api/admin/users", auth, async (c) => {
    requireAdmin(c.get("user"));
    const body = await readBody(c);
    const username = text(body.username).trim();
    const displayName = text(body.displayName).trim();
    const password = text(body.password);
    const role: Role = body.role === "admin" ? "admin" : "member";
    for (const problem of [checkUsername(username), checkDisplayName(displayName), checkPassword(password)]) if (problem) throw new Fail(problem, 400);
    if (db.prepare("select 1 from users where username = ?").get(username)) throw new Fail("username_taken", 409);
    const user = createUser(db, { username, displayName, passwordHash: await hashPassword(password), role });
    return c.json(adminUser(row(user.id)!), 201);
  });

  /** A new name, or another role (not the last admin's). */
  app.patch("/api/admin/users/:id", auth, async (c) => {
    const r = target(c);
    const body = await readBody(c);
    if (body.displayName !== undefined) {
      const name = text(body.displayName).trim();
      const problem = checkDisplayName(name);
      if (problem) throw new Fail(problem, 400);
      db.prepare("update users set display_name = ? where id = ?").run(name, r.id);
    }
    if (body.role === "admin" || body.role === "member") {
      if (body.role === "member" && r.role === "admin" && admins() <= 1) throw new Fail("last_admin", 409);
      db.prepare("update users set role = ? where id = ?").run(body.role, r.id);
    }
    // (their apps ask who they are again)
    sync.tell(r.id, ACCOUNT_CHANGED);
    return c.json(adminUser(row(r.id)!));
  });

  /** A new password: every device of theirs has to log in with it. */
  app.post("/api/admin/users/:id/password", auth, async (c) => {
    const r = target(c);
    const password = text((await readBody(c)).password);
    const problem = checkPassword(password);
    if (problem) throw new Fail(problem, 400);
    db.prepare("update users set password_hash = ? where id = ?").run(await hashPassword(password), r.id);
    logOut(r.id, r.id === c.get("user").id ? c.get("sessionId") : null);
    return c.json(adminUser(row(r.id)!));
  });

  app.post("/api/admin/users/:id/logout", auth, (c) => {
    const r = target(c);
    logOut(r.id, r.id === c.get("user").id ? c.get("sessionId") : null);
    return c.json(adminUser(row(r.id)!));
  });

  /** What removing them would do (asked before, to say so). */
  app.get("/api/admin/users/:id/removal", auth, (c) => {
    const r = target(c);
    const p = plan(r.id);
    return c.json({ handedOver: p.filter((x) => x.heir).length, deleted: p.filter((x) => !x.heir).length } satisfies Removal);
  });

  app.delete("/api/admin/users/:id", auth, async (c) => {
    const r = target(c);
    if (r.id === c.get("user").id) throw new Fail("remove_yourself", 409);
    if (r.role === "admin" && admins() <= 1) throw new Fail("last_admin", 409);
    const p = plan(r.id);
    const invited = db.prepare("select id, to_id from invites where from_id = ? and to_id is not null and used_at is null").all(r.id) as { id: string; to_id: number }[];
    const gone: typeof p = [];
    db.transaction(() => {
      for (const obj of p) {
        if (obj.heir) {
          db.prepare("update objects set owner_id = ? where id = ?").run(obj.heir, obj.id);
          db.prepare("update members set role = 'owner' where object_id = ? and user_id = ?").run(obj.id, obj.heir);
        } else gone.push(obj);
      }
      for (const obj of gone) deleteObject(db, obj.id);
      db.prepare("delete from users where id = ?").run(r.id);
    })();
    sync.closeUser(r.id);
    for (const obj of p) {
      if (obj.heir) {
        sync.access(obj.type, obj.id, obj.heir, "owner");
        await sync.toHome(obj.heir, obj.id, obj.type, "owner");
      } else sync.closeAll(obj.type, obj.id);
    }
    for (const i of invited) await sync.removeInvitation(i.to_id, i.id);
    return c.json({ handedOver: p.length - gone.length, deleted: gone.length } satisfies Removal);
  });
}
