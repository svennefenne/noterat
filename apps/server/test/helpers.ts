import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import { serve } from "@hono/node-server";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { afterEach, expect } from "vitest";
import { CHUNK_SIZE, type UploadReply } from "@noterat/core";
import * as Y from "yjs";
import { createApp } from "../src/app";
import type { MailTransport } from "../src/mail";
import type { FetchPage } from "../src/recipes";
import { createSession, hashPassword } from "../src/auth";
import { openDb, type DB } from "../src/db";
import { createSync } from "../src/sync";
import { createUser } from "../src/users";

/**
 * The server for real: HTTP and the sync's WebSocket on a free port, and devices that connect to it the
 * way the app does (HocuspocusProvider, one Yjs document per thing). "Offline" is a device whose
 * connection is cut while it goes on changing things.
 */

export const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
});

export async function startServer(
  o: { workerToken?: string; workerWait?: number; workerLease?: number; fetchPage?: FetchPage; pushFetch?: typeof fetch; mailTransport?: MailTransport; mailEnv?: NodeJS.ProcessEnv; bundledDir?: string } = {},
) {
  const db = openDb(":memory:");
  const sync = createSync(db, { debounce: 20, maxDebounce: 100 });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "noterat-test-"));
  const app = createApp({ db, sync, version: "test", webDir: null, trustedIpHeader: "", publicUrl: "", dataDir, workerToken: o.workerToken, workerWait: o.workerWait ?? 300, workerLease: o.workerLease, fetchPage: o.fetchPage, pushFetch: o.pushFetch, mailTransport: o.mailTransport, mailEnv: o.mailEnv ?? {}, bundledDir: o.bundledDir ?? null, build: 30, timeZone: "Europe/Stockholm" });
  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s as Server));
  });
  sync.attach(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stops.push(async () => {
    app.jobs.stop();
    app.calendars.stop();
    await sync.stop();
    await new Promise((r) => server.close(r));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { db, base, dataDir };
}

export async function account(db: DB, username: string) {
  const user = createUser(db, { username, displayName: username[0]!.toUpperCase() + username.slice(1), passwordHash: await hashPassword("a long enough password"), role: "member" });
  return { user, token: createSession(db, user.id, "test") };
}

/** an account that's an admin */
export async function admin(db: DB, username: string) {
  const a = await account(db, username);
  db.prepare("update users set role = 'admin' where id = ?").run(a.user.id);
  return { ...a, user: { ...a.user, role: "admin" as const } };
}

export async function call<T>(base: string, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const answer = await res.text();
  return { status: res.status, json: (answer ? JSON.parse(answer) : null) as T };
}

/** A device logged in as someone: it opens documents and keeps them in sync, as the app does. */
export function device(base: string, token: string) {
  const providers: HocuspocusProvider[] = [];
  stops.push(async () => providers.forEach((p) => (p.destroy(), p.configuration.websocketProvider.destroy())));
  return (name: string) => {
    const doc = new Y.Doc();
    const refused: string[] = [];
    const socket = new HocuspocusProviderWebsocket({ url: `${base.replace("http", "ws")}/sync`, WebSocketPolyfill: WebSocket });
    const provider = new HocuspocusProvider({ websocketProvider: socket, name, document: doc, token, onAuthenticationFailed: ({ reason }) => refused.push(reason) });
    provider.attach();
    providers.push(provider);
    return {
      doc,
      provider,
      refused,
      /** the connection lost, until it's really gone */
      offline: async () => {
        socket.disconnect();
        await until(() => socket.status === "disconnected", "the device to be offline");
      },
      online: () => void socket.connect(),
    };
  };
}

export async function until(check: () => boolean, what: string, ms = 4000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`waited ${ms} ms for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

export const synced = (p: HocuspocusProvider) => until(() => p.isSynced && !p.hasUnsyncedChanges, "the device to be synced");

// ───────────── files and the worker ─────────────

export const WORKER = "w".repeat(40);
export const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export async function put(base: string, token: string, hash: string, o: { object: string; offset: number; size: number; body: Uint8Array }) {
  const res = await fetch(`${base}/api/files/${hash}?object=${o.object}&offset=${o.offset}&size=${o.size}&type=audio%2Fwebm%3Bcodecs%3Dopus`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
    body: o.body,
  });
  return { status: res.status, json: (await res.json()) as UploadReply & { error?: string; received?: number } };
}

/** Upload a whole file in pieces, from wherever the server has got to. */
export async function upload(base: string, token: string, object: string, bytes: Uint8Array) {
  const hash = sha(bytes);
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const r = await put(base, token, hash, { object, offset, size: bytes.length, body: bytes.subarray(offset, offset + CHUNK_SIZE) });
    expect(r.status).toBe(200);
  }
  return hash;
}

export const worker = (base: string, path: string, body?: unknown, token = WORKER) =>
  fetch(`${base}/api/worker${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

