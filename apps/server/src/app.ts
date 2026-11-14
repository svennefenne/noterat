import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { checkDisplayName, checkPassword, checkUsername, type ApiErrorBody, type ServerInfo, type SessionReply } from "@noterat/core";
import { createSession, dummyHash, endSession, hashPassword, LoginThrottle, verifyPassword } from "./auth";
import type { DB } from "./db";
import { fileRoutes, fileStore } from "./files";
import { Fail, readBody, signedIn, text, type Env } from "./http";
import { createJobs } from "./jobs";
import { shareRoutes } from "./sharing";
import type { Sync } from "./sync";
import { createUser, toUser, userByUsername, userCount } from "./users";
import { webFiles } from "./web";

export { Fail } from "./http";

export interface AppOptions {
  db: DB;
  sync: Sync;
  version: string;
  /** the app's built files, or null (development: Vite serves them) */
  webDir: string | null;
  /** a header holding the visitor's address, set by a trusted proxy ("" = the connection's own) */
  trustedIpHeader: string;
  /** the address people use (share links), or "" for the address each request came to */
  publicUrl: string;
  /** where files are kept (DATA_DIR) */
  dataDir: string;
  /** the speech-to-text worker's token ("" = none) and the language it transcribes in */
  workerToken?: string;
  transcribeLanguage?: string;
  /** (tests: how long the worker's request for work waits, and how long a quiet worker keeps a job) */
  workerWait?: number;
  workerLease?: number;
}

/**
 * The server's HTTP side: the API under /api, and the app's own files on every other path. (The live
 * sync is the WebSocket at /sync: sync.ts.)
 *
 * The app logs in with a bearer token rather than a cookie: the Android app runs from its own origin
 * (https://localhost) and talks to the server across origins, where a token simply works. So the API
 * allows any origin; a request only does something with a valid token.
 */
export function createApp(o: AppOptions) {
  const { db } = o;
  const app = new Hono<Env>();
  const throttle = new LoginThrottle();
  const auth = signedIn(db);

  app.onError((err, c) => {
    if (err instanceof Fail) return c.json({ error: err.code } satisfies ApiErrorBody, err.status);
    console.error(err);
    return c.json({ error: "server_error" } satisfies ApiErrorBody, 500);
  });

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
  });

  app.use(
    "/api/*",
    cors({ origin: "*", allowHeaders: ["Authorization", "Content-Type"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"], maxAge: 86_400 }),
  );

  const clientIp = (c: Context): string => {
    if (o.trustedIpHeader) {
      // (a list such as X-Forwarded-For: the last one, which the proxy itself added; the ones before it
      // came with the request and could be anything)
      const v = c.req.header(o.trustedIpHeader)?.split(",").pop()?.trim();
      if (v) return v;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      // (a request made in a test has no connection)
      return "local";
    }
  };

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/server", (c) => c.json({ app: "noterat", version: o.version, needsSetup: userCount(db) === 0 } satisfies ServerInfo));

  /** The first account, which is the admin. Only while there are no accounts. */
  app.post("/api/setup", async (c) => {
    const body = await readBody(c);
    const username = text(body.username).trim();
    const displayName = text(body.displayName).trim();
    const password = text(body.password);
    for (const problem of [checkUsername(username), checkDisplayName(displayName), checkPassword(password)]) if (problem) throw new Fail(problem, 400);
    if (userCount(db) > 0) throw new Fail("setup_done", 409);
    const passwordHash = await hashPassword(password);
    // (asked again where it counts: of two first accounts at once, only one is made)
    const user = db.transaction(() => {
      if (userCount(db) > 0) throw new Fail("setup_done", 409);
      return createUser(db, { username, displayName, passwordHash, role: "admin" });
    })();
    const token = createSession(db, user.id, c.req.header("user-agent") ?? "");
    return c.json({ token, user } satisfies SessionReply, 201);
  });

  app.post("/api/login", async (c) => {
    const body = await readBody(c);
    const username = text(body.username).trim();
    const password = text(body.password);
    const ip = clientIp(c);
    if (throttle.blocked(ip, username)) throw new Fail("too_many_attempts", 429);
    const row = username ? userByUsername(db, username) : null;
    const ok = await verifyPassword(password, row?.password_hash ?? (await dummyHash()));
    if (!row || !ok) {
      throttle.failed(ip, username);
      throw new Fail("login_failed", 401);
    }
    throttle.succeeded(ip, username);
    const token = createSession(db, row.id, c.req.header("user-agent") ?? "");
    return c.json({ token, user: toUser(row) } satisfies SessionReply);
  });

  app.get("/api/me", auth, (c) => c.json(c.get("user")));

  app.post("/api/logout", auth, (c) => {
    endSession(db, c.get("sessionId"));
    return c.body(null, 204);
  });

  shareRoutes(app, { db, sync: o.sync, publicUrl: o.publicUrl });

  const store = fileStore(o.dataDir);
  const jobs = createJobs({ db, sync: o.sync, store, workerToken: o.workerToken ?? "", language: o.transcribeLanguage ?? "sv", wait: o.workerWait, lease: o.workerLease });
  fileRoutes(app, { db, store, onUploaded: jobs.onUploaded });
  jobs.routes(app);

  app.all("/api/*", () => {
    throw new Fail("not_found", 404);
  });

  if (o.webDir) app.get("*", webFiles(o.webDir));

  return Object.assign(app, { jobs });
}
