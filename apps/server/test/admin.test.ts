import { describe, expect, it } from "vitest";
import { ACCOUNT_CHANGED, homeDocName, homeItems, HOUSEHOLD_CHANGED, newObjectId, type Household } from "@noterat/core";
import { createSession } from "../src/auth";
import type { AdminUser, Removal } from "../src/admin";
import { addMember, createObject, objectRow, roleOf } from "../src/objects";
import { inQuietHours } from "../src/push";
import { account, admin, call, device, startServer, synced, until } from "./helpers";

/**
 * The admin page (decision 14): the household's settings, which every app is told about, and its
 * accounts, which only an admin manages.
 */

/** an app connected as someone, hearing what the server tells it */
async function listening(base: string, token: string, userId: number) {
  const home = device(base, token)(homeDocName(userId));
  await synced(home.provider);
  const told: string[] = [];
  const closed: string[] = [];
  home.provider.on("stateless", ({ payload }: { payload: string }) => told.push(payload));
  home.provider.on("close", ({ event }: { event: { reason: string } }) => closed.push(event.reason));
  return { home, told, closed };
}

describe("the household's settings", () => {
  it("are read by anyone, changed by an admin only, and every connected app is told", async () => {
    const { db, base } = await startServer();
    const ada = await admin(db, "ada");
    const bo = await account(db, "bo");
    const first = (await call<Household>(base, "GET", "/api/household")).json;
    expect(first.look).toEqual({ scheme: "noterat", mode: "auto" });
    expect(first.money.swish).toBe(true);

    expect((await call(base, "PUT", "/api/admin/household", bo.token, { money: { swish: false } })).status).toBe(403);
    const app = await listening(base, bo.token, bo.user.id);
    const r = await call<Household>(base, "PUT", "/api/admin/household", ada.token, { money: { swish: false }, look: { scheme: "nord", mode: "dark" }, locale: { timeZone: "Bogus/Zone", clock: "12" } });
    expect(r.status).toBe(200);
    expect(r.json.money.swish).toBe(false);
    expect(r.json.look).toEqual({ scheme: "nord", mode: "dark" });
    expect(r.json.locale).toMatchObject({ clock: "12", timeZone: first.locale.timeZone });
    expect((await call<Household>(base, "GET", "/api/household")).json.look.scheme).toBe("nord");
    await until(() => app.told.includes(HOUSEHOLD_CHANGED), "the app to be told");
  });

  it("set the clock quiet hours go by", () => {
    const at = new Date(Date.UTC(2026, 10, 15, 22, 30));
    const quiet = { quietFrom: "22:00", quietTo: "07:00" };
    expect(inQuietHours(quiet, at, "Europe/Stockholm")).toBe(true);
    expect(inQuietHours(quiet, at, "America/New_York")).toBe(false);
  });
});

describe("the household's accounts", () => {
  it("are for an admin to see, add to, rename and make admins, always keeping one", async () => {
    const { db, base } = await startServer();
    const ada = await admin(db, "ada");
    const bo = await account(db, "bo");
    expect((await call(base, "GET", "/api/admin/users", bo.token)).status).toBe(403);
    const list = await call<AdminUser[]>(base, "GET", "/api/admin/users", ada.token);
    expect(list.json.map((u) => [u.username, u.role, u.devices])).toEqual([
      ["ada", "admin", 1],
      ["bo", "member", 1],
    ]);

    const cilla = { username: "cilla", displayName: "Cilla Ek", password: "short", role: "member" };
    expect((await call(base, "POST", "/api/admin/users", ada.token, cilla)).json).toEqual({ error: "password_short" });
    const made = await call<AdminUser>(base, "POST", "/api/admin/users", ada.token, { ...cilla, password: "a long enough password" });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ username: "cilla", displayName: "Cilla Ek", role: "member", devices: 0, lastSeen: null });
    expect((await call(base, "POST", "/api/admin/users", ada.token, { ...cilla, password: "a long enough password" })).json).toEqual({ error: "username_taken" });
    expect((await call(base, "POST", "/api/login", undefined, { username: "cilla", password: "a long enough password" })).status).toBe(200);

    const app = await listening(base, bo.token, bo.user.id);
    const renamed = await call<AdminUser>(base, "PATCH", `/api/admin/users/${bo.user.id}`, ada.token, { displayName: "Bo Berg", role: "admin" });
    expect(renamed.json).toMatchObject({ displayName: "Bo Berg", role: "admin" });
    await until(() => app.told.includes(ACCOUNT_CHANGED), "bo's app to be told");
    // two admins: one may stop being one, but not the last
    expect((await call(base, "PATCH", `/api/admin/users/${ada.user.id}`, ada.token, { role: "member" })).status).toBe(200);
    expect((await call(base, "PATCH", `/api/admin/users/${bo.user.id}`, bo.token, { role: "member" })).json).toEqual({ error: "last_admin" });
    expect((await call(base, "GET", "/api/admin/users", ada.token)).status).toBe(403);
  });

  it("get a new password that logs them out everywhere, but not the admin's own device", async () => {
    const { db, base } = await startServer();
    const ada = await admin(db, "ada");
    const bo = await account(db, "bo");
    const app = await listening(base, bo.token, bo.user.id);
    expect((await call(base, "POST", `/api/admin/users/${bo.user.id}/password`, ada.token, { password: "another long password" })).status).toBe(200);
    expect((await call(base, "GET", "/api/me", bo.token)).status).toBe(401);
    await until(() => app.closed.includes("unauthorized"), "bo's app to be closed off");
    expect((await call(base, "POST", "/api/login", undefined, { username: "bo", password: "another long password" })).status).toBe(200);

    // the admin's own: this device stays, the others are logged out
    const other = createSession(db, ada.user.id, "another device");
    expect((await call(base, "POST", `/api/admin/users/${ada.user.id}/logout`, ada.token)).status).toBe(200);
    expect((await call(base, "GET", "/api/me", ada.token)).status).toBe(200);
    expect((await call(base, "GET", "/api/me", other)).status).toBe(401);
  });

  it("are removed with what they shared handed over, and the rest deleted", async () => {
    const { db, base } = await startServer();
    const ada = await admin(db, "ada");
    const bo = await account(db, "bo");
    const cilla = await account(db, "cilla");
    const david = await account(db, "david");
    const shared = newObjectId();
    const own = newObjectId();
    createObject(db, { id: shared, type: "list", ownerId: bo.user.id });
    addMember(db, shared, david.user.id, "viewer");
    addMember(db, shared, cilla.user.id, "editor");
    createObject(db, { id: own, type: "note", ownerId: bo.user.id });

    expect((await call<Removal>(base, "GET", `/api/admin/users/${bo.user.id}/removal`, ada.token)).json).toEqual({ handedOver: 1, deleted: 1 });
    expect((await call(base, "DELETE", `/api/admin/users/${ada.user.id}`, ada.token)).json).toEqual({ error: "remove_yourself" });
    const cillasApp = await listening(base, cilla.token, cilla.user.id);
    expect((await call<Removal>(base, "DELETE", `/api/admin/users/${bo.user.id}`, ada.token)).json).toEqual({ handedOver: 1, deleted: 1 });

    // the editor takes over (before the viewer); the note is gone, and so is bo
    expect(objectRow(db, shared)?.owner_id).toBe(cilla.user.id);
    expect(roleOf(db, shared, cilla.user.id)).toBe("owner");
    expect(roleOf(db, shared, david.user.id)).toBe("viewer");
    expect(objectRow(db, own)).toBeNull();
    expect((await call(base, "GET", "/api/me", bo.token)).status).toBe(401);
    await until(() => homeItems(cillasApp.home.doc).get(shared)?.role === "owner", "cilla's home to say she owns it");
  });
});
