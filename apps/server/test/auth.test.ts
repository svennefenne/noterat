import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ServerInfo, SessionReply, User } from "@noterat/core";
import { createApp } from "../src/app";
import { openDb } from "../src/db";
import { createSync } from "../src/sync";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "noterat-test-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function server(webDir: string | null = null, trustedIpHeader = "") {
  const db = openDb(":memory:");
  return createApp({ db, sync: createSync(db), version: "test", webDir, trustedIpHeader, publicUrl: "", dataDir });
}
type App = ReturnType<typeof server>;

const send = (app: App, method: string, url: string, body?: unknown, token?: string) =>
  app.request(url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const first = { username: "ada", displayName: "Ada", password: "a long enough password" };

async function setUp(app: App): Promise<SessionReply> {
  const res = await send(app, "POST", "/api/setup", first);
  expect(res.status).toBe(201);
  return (await res.json()) as SessionReply;
}

describe("the first account", () => {
  it("is asked for until there is one, and is the admin", async () => {
    const app = server();
    expect(((await (await send(app, "GET", "/api/server")).json()) as ServerInfo).needsSetup).toBe(true);
    const { token, user } = await setUp(app);
    expect(user).toMatchObject({ username: "ada", displayName: "Ada", role: "admin" });
    expect(((await (await send(app, "GET", "/api/server")).json()) as ServerInfo).needsSetup).toBe(false);
    const me = await send(app, "GET", "/api/me", undefined, token);
    expect(((await me.json()) as User).username).toBe("ada");
  });

  it("is made only once", async () => {
    const app = server();
    await setUp(app);
    const again = await send(app, "POST", "/api/setup", { ...first, username: "eve" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "setup_done" });
  });

  it("needs a valid username, a name and a long enough password", async () => {
    const app = server();
    for (const [change, error] of [
      [{ username: "a b" }, "username_invalid"],
      [{ displayName: "  " }, "name_missing"],
      [{ password: "short" }, "password_short"],
    ] as const) {
      const res = await send(app, "POST", "/api/setup", { ...first, ...change });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    expect(((await (await send(app, "GET", "/api/server")).json()) as ServerInfo).needsSetup).toBe(true);
  });
});

describe("logging in", () => {
  it("works with the right password, in any case of the username", async () => {
    const app = server();
    await setUp(app);
    const res = await send(app, "POST", "/api/login", { username: "ADA", password: first.password });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as SessionReply;
    expect((await send(app, "GET", "/api/me", undefined, token)).status).toBe(200);
  });

  it("is turned down with a wrong password or an unknown username, the same way", async () => {
    const app = server();
    await setUp(app);
    for (const body of [
      { username: "ada", password: "not the password" },
      { username: "nobody", password: first.password },
    ]) {
      const res = await send(app, "POST", "/api/login", body);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "login_failed" });
    }
  });

  it("waits after five wrong passwords, even for the right one", async () => {
    const app = server();
    await setUp(app);
    for (let i = 0; i < 5; i++) await send(app, "POST", "/api/login", { username: "ada", password: `wrong ${i}` });
    const res = await send(app, "POST", "/api/login", { username: "ada", password: first.password });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too_many_attempts" });
  });

  it("waits per visitor behind a proxy, by the address the proxy added", async () => {
    const app = server(null, "x-forwarded-for");
    await setUp(app);
    const from = (forwarded: string, password: string) =>
      app.request("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": forwarded },
        body: JSON.stringify({ username: "ada", password }),
      });
    for (let i = 0; i < 5; i++) await from(`10.0.0.${i}, 203.0.113.7`, `wrong ${i}`);
    // (a made-up address in front doesn't get round it)
    expect((await from("10.9.9.9, 203.0.113.7", first.password)).status).toBe(429);
    expect((await from("203.0.113.8", first.password)).status).toBe(200);
  });

  it("ends with logging out: the token no longer works", async () => {
    const app = server();
    const { token } = await setUp(app);
    expect((await send(app, "POST", "/api/logout", undefined, token)).status).toBe(204);
    const me = await send(app, "GET", "/api/me", undefined, token);
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ error: "unauthorized" });
  });
});

describe("the API", () => {
  it("turns away what isn't JSON", async () => {
    const app = server();
    const res = await app.request("/api/setup", { method: "POST", body: "username=ada" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
  });

  it("answers an unknown path with not_found", async () => {
    const res = await send(server(), "GET", "/api/nothing-here");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("can be called from the Android app's own origin", async () => {
    const res = await server().request("/api/server", { headers: { Origin: "https://localhost" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("the app's files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noterat-web-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Noterat</title>");
  fs.writeFileSync(path.join(dir, "assets", "app-1234.js"), "console.log(1)");
  fs.writeFileSync(path.join(os.tmpdir(), "noterat-secret.txt"), "not for the web");

  it("serves a built file, kept long when its name has a hash", async () => {
    const res = await server(dir).request("/assets/app-1234.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("serves the app's page on any other path, never a file outside it", async () => {
    for (const url of ["/lists/3", "/../noterat-secret.txt", "/%2e%2e/noterat-secret.txt", "/%E0%A4%A"]) {
      const res = await server(dir).request(url);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<title>Noterat</title>");
      expect(res.headers.get("cache-control")).toBe("no-cache");
    }
  });
});
