import crypto from "node:crypto";
import type { Context, Hono } from "hono";
import {
  checkDisplayName,
  checkPassword,
  checkUsername,
  isObjectId,
  isShareRole,
  type AcceptReply,
  type Invitation,
  type LinkInfo,
  type Person,
  type ShareLink,
  type ShareReply,
  type ShareRole,
  type ShareState,
  type SignupReply,
  type User,
} from "@noterat/core";
import { createSession, hashPassword, newToken, tokenId } from "./auth";
import type { DB } from "./db";
import { Fail, publicAddress, readBody, signedIn, text, type Env } from "./http";
import { addMember, deleteObject, membersOf, objectRow, people, person, removeMember, roleOf, setRole, type ObjectRow } from "./objects";
import type { Sync } from "./sync";
import { createUser, userByUsername } from "./users";

/**
 * Sharing. Nothing is shared until its owner shares it, in one of two ways:
 *
 * - a link (`/i/<token>`), sent however they like: whoever opens it sees "Sam wants to share …" and
 *   accepts, making an account on this server first if they have none (a link is the only way in for
 *   someone new). A link works once, for LINK_DAYS.
 * - an invitation to someone on this server: it shows at once in their app (their home document), to
 *   accept or decline, for INVITATION_DAYS.
 *
 * Accepting makes them a member (editor or viewer), puts the thing in their home document, and their
 * devices sync it from then on. The owner can change a member's role or take the thing back; a member
 * can leave it. Deleting a thing takes it from everyone.
 */

const DAY = 86_400_000;
const LINK_DAYS = 14;
const INVITATION_DAYS = 30;

interface InviteRow {
  id: string;
  object_id: string;
  from_id: number;
  to_id: number | null;
  role: ShareRole;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

const inviteState = (i: InviteRow): LinkInfo["status"] => (i.used_at ? "used" : i.expires_at <= Date.now() ? "expired" : "open");

export function shareRoutes(app: Hono<Env>, o: { db: DB; sync: Sync; publicUrl: string }) {
  const { db, sync } = o;
  const auth = signedIn(db);

  const inviteRow = (id: string) => (db.prepare("select * from invites where id = ?").get(id) as InviteRow | undefined) ?? null;

  /** The thing in the path, synced to the server and not deleted, and the asker's role on it. */
  function thing(c: Context<Env>): { obj: ObjectRow; role: NonNullable<ReturnType<typeof roleOf>> } {
    const id = c.req.param("id") ?? "";
    const obj = isObjectId(id) ? objectRow(db, id) : null;
    // (one the server hasn't seen yet was made offline and hasn't synced: it can't be shared until it has)
    if (!obj) throw new Fail("not_synced", 404);
    if (obj.deleted_at) throw new Fail("not_found", 404);
    const role = roleOf(db, obj.id, c.get("user").id);
    if (!role) throw new Fail("forbidden", 403);
    return { obj, role };
  }

  function ownThing(c: Context<Env>) {
    const t = thing(c);
    if (t.role !== "owner") throw new Fail("forbidden", 403);
    return t;
  }

  const publicBase = (c: Context) => publicAddress(c, o.publicUrl);

  /** Someone gets what an invite gives (a link or an invitation). Used up only when it gave them something. */
  async function accept(invite: InviteRow, user: User): Promise<AcceptReply> {
    const obj = objectRow(db, invite.object_id);
    if (!obj || obj.deleted_at) throw new Fail("not_found", 404);
    const changed = addMember(db, obj.id, user.id, invite.role);
    if (changed) {
      db.prepare("update invites set used_at = ?, used_by = ? where id = ?").run(Date.now(), user.id, invite.id);
      // (a viewer who became an editor, with it open, can change it at once)
      sync.access(obj.type, obj.id, user.id, invite.role);
    }
    await sync.toHome(user.id, obj.id, obj.type, roleOf(db, obj.id, user.id)!);
    return { objectId: obj.id, type: obj.type };
  }

  function openInvite(invite: InviteRow | null): InviteRow {
    if (!invite) throw new Fail("not_found", 404);
    const state = inviteState(invite);
    if (state === "used") throw new Fail("invite_used", 410);
    if (state === "expired") throw new Fail("invite_expired", 410);
    return invite;
  }

  /** The people on this server, to share with. */
  app.get("/api/people", auth, (c) => c.json(people(db) satisfies Person[]));

  /** Who has a thing; the owner also sees the links and invitations still open. */
  app.get("/api/objects/:id/share", auth, (c) => {
    const { obj, role } = thing(c);
    const open = role !== "owner" ? [] : (db.prepare("select * from invites where object_id = ? and used_at is null and expires_at > ? order by created_at").all(obj.id, Date.now()) as InviteRow[]);
    const state: ShareState = {
      title: sync.titleOf(obj),
      role,
      members: membersOf(db, obj.id),
      links: open.filter((i) => i.to_id === null).map((i) => ({ id: i.id, role: i.role, createdAt: i.created_at, expiresAt: i.expires_at })),
      invitations: open.flatMap((i) => {
        const p = i.to_id ? person(db, i.to_id) : null;
        return p ? [{ id: i.id, person: p, role: i.role, at: i.created_at }] : [];
      }),
    };
    return c.json(state);
  });

  /** Share: a new link, or an invitation to someone on this server. */
  app.post("/api/objects/:id/share", auth, async (c) => {
    const { obj } = ownThing(c);
    const body = await readBody(c);
    if (!isShareRole(body.role)) throw new Fail("bad_request", 400);
    const me = c.get("user");
    const t = Date.now();
    if (body.userId === undefined) {
      const token = newToken();
      const link: ShareLink = { id: tokenId(token), role: body.role, createdAt: t, expiresAt: t + LINK_DAYS * DAY };
      db.prepare("insert into invites (id, object_id, from_id, role, created_at, expires_at) values (?, ?, ?, ?, ?, ?)").run(link.id, obj.id, me.id, link.role, t, link.expiresAt);
      return c.json({ kind: "link", url: `${publicBase(c)}/i/${token}`, link } satisfies ShareReply, 201);
    }
    const to = typeof body.userId === "number" ? person(db, body.userId) : null;
    if (!to) throw new Fail("not_found", 404);
    if (roleOf(db, obj.id, to.id)) throw new Fail("already_member", 409);
    // (one open invitation per person: a new one replaces it)
    for (const old of db.prepare("select id from invites where object_id = ? and to_id = ? and used_at is null").all(obj.id, to.id) as { id: string }[]) {
      db.prepare("delete from invites where id = ?").run(old.id);
      await sync.removeInvitation(to.id, old.id);
    }
    const id = crypto.randomBytes(12).toString("hex");
    db.prepare("insert into invites (id, object_id, from_id, to_id, role, created_at, expires_at) values (?, ?, ?, ?, ?, ?, ?)").run(
      id,
      obj.id,
      me.id,
      to.id,
      body.role,
      t,
      t + INVITATION_DAYS * DAY,
    );
    const invitation: Invitation = { id, objectId: obj.id, type: obj.type, title: sync.titleOf(obj), role: body.role, from: { id: me.id, displayName: me.displayName }, at: t };
    await sync.addInvitation(to.id, invitation);
    return c.json({ kind: "invitation", id } satisfies ShareReply, 201);
  });

  /** Take back a link or an invitation that hasn't been used. */
  app.delete("/api/objects/:id/share/:inviteId", auth, async (c) => {
    const { obj } = ownThing(c);
    const invite = inviteRow(c.req.param("inviteId"));
    if (!invite || invite.object_id !== obj.id) throw new Fail("not_found", 404);
    db.prepare("delete from invites where id = ?").run(invite.id);
    if (invite.to_id && !invite.used_at) await sync.removeInvitation(invite.to_id, invite.id);
    return c.body(null, 204);
  });

  /** Change a member's role (the owner). */
  app.patch("/api/objects/:id/members/:userId", auth, async (c) => {
    const { obj } = ownThing(c);
    const body = await readBody(c);
    const userId = Number(c.req.param("userId"));
    const had = roleOf(db, obj.id, userId);
    if (!had) throw new Fail("not_found", 404);
    if (!isShareRole(body.role) || had === "owner") throw new Fail("bad_request", 400);
    setRole(db, obj.id, userId, body.role);
    sync.access(obj.type, obj.id, userId, body.role);
    await sync.toHome(userId, obj.id, obj.type, body.role);
    return c.body(null, 204);
  });

  /** Take a thing back from a member (the owner), or leave it (a member). */
  app.delete("/api/objects/:id/members/:userId", auth, async (c) => {
    const { obj, role } = thing(c);
    const userId = Number(c.req.param("userId"));
    const self = userId === c.get("user").id;
    if (self ? role === "owner" : role !== "owner") throw new Fail("forbidden", 403);
    if (!roleOf(db, obj.id, userId)) throw new Fail("not_found", 404);
    removeMember(db, obj.id, userId);
    sync.access(obj.type, obj.id, userId, null);
    await sync.removeFromHome(userId, obj.id);
    return c.body(null, 204);
  });

  /** Delete a thing (its owner): it goes from everyone who has it. */
  app.delete("/api/objects/:id", auth, async (c) => {
    const { obj } = ownThing(c);
    const had = membersOf(db, obj.id).map((m) => m.person.id);
    const invited = db.prepare("select id, to_id from invites where object_id = ? and to_id is not null and used_at is null").all(obj.id) as { id: string; to_id: number }[];
    deleteObject(db, obj.id);
    sync.closeAll(obj.type, obj.id);
    for (const userId of had) await sync.removeFromHome(userId, obj.id);
    for (const i of invited) await sync.removeInvitation(i.to_id, i.id);
    return c.body(null, 204);
  });

  // ───────────── a share link (/i/<token>) ─────────────

  const linkByToken = (token: string) => {
    const invite = inviteRow(tokenId(token));
    return invite && invite.to_id === null ? invite : null;
  };

  /** What a link is, for its page before logging in: who shares what. */
  app.get("/api/links/:token", (c) => {
    const invite = linkByToken(c.req.param("token"));
    const obj = invite ? objectRow(db, invite.object_id) : null;
    const from = invite ? person(db, invite.from_id) : null;
    if (!invite || !obj || obj.deleted_at || !from) throw new Fail("not_found", 404);
    return c.json({ from: from.displayName, title: sync.titleOf(obj), type: obj.type, role: invite.role, status: inviteState(invite) } satisfies LinkInfo);
  });

  app.post("/api/links/:token/accept", auth, async (c) => {
    const invite = openInvite(linkByToken(c.req.param("token")));
    return c.json(await accept(invite, c.get("user")));
  });

  /** Someone new: an account on this server from the link, which it then accepts. */
  app.post("/api/links/:token/signup", async (c) => {
    const invite = openInvite(linkByToken(c.req.param("token")));
    const body = await readBody(c);
    const username = text(body.username).trim();
    const displayName = text(body.displayName).trim();
    const password = text(body.password);
    for (const problem of [checkUsername(username), checkDisplayName(displayName), checkPassword(password)]) if (problem) throw new Fail(problem, 400);
    if (userByUsername(db, username)) throw new Fail("username_taken", 409);
    const passwordHash = await hashPassword(password);
    const user = db.transaction(() => {
      if (userByUsername(db, username)) throw new Fail("username_taken", 409);
      return createUser(db, { username, displayName, passwordHash, role: "member" });
    })();
    const token = createSession(db, user.id, c.req.header("user-agent") ?? "");
    const accepted = await accept(invite, user);
    return c.json({ token, user, accepted } satisfies SignupReply, 201);
  });

  // ───────────── an invitation to someone on this server ─────────────

  function myInvitation(c: Context<Env>): InviteRow {
    const invite = inviteRow(c.req.param("id") ?? "");
    if (!invite || invite.to_id !== c.get("user").id) throw new Fail("not_found", 404);
    return invite;
  }

  app.post("/api/invitations/:id/accept", auth, async (c) => {
    const invite = myInvitation(c);
    const me = c.get("user");
    try {
      return c.json(await accept(openInvite(invite), me));
    } finally {
      // (accepted, used up or run out: either way it's not waiting any more)
      await sync.removeInvitation(me.id, invite.id);
    }
  });

  app.post("/api/invitations/:id/decline", auth, async (c) => {
    const invite = myInvitation(c);
    db.prepare("delete from invites where id = ?").run(invite.id);
    await sync.removeInvitation(c.get("user").id, invite.id);
    return c.body(null, 204);
  });
}
