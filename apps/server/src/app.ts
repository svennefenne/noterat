import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  checkDisplayName,
  checkPassword,
  checkUsername,
  type ApiErrorBody,
  type ErrorCode,
  type ServerInfo,
  type SessionReply,
  type User,
} from "@noterat/core";
import { createSession, dummyHash, endSession, hashPassword, LoginThrottle, sessionUser, verifyPassword } from "./auth";
import type { DB } from "./db";
import { createUser, toUser, userByUsername, userCount } from "./users";
import { webFiles } from "./web";

export interface AppOptions {
  db: DB;
  version: string;
  /** the app's built files, or null (development: Vite serves them) */
  webDir: string | null;
  /** a header holding the visitor's address, set by a trusted proxy ("" = the connection's own) */
  trustedIpHeader: string;
}

/** A request turned down: the API answers `{ "error": code }` with this status. */
export class Fail extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: ContentfulStatusCode,
  ) {
    super(code);
  }
}

type Env = { Variables: { user: User; sessionId: string } };

/**
 * The server's HTTP side: the API under /api, and the app's own files on every other path.
 *
 * The app logs in with a bearer token rather than a cookie: the Android app runs from its own origin
 * (https://localhost) and talks to the server across origins, where a token simply works. So the API
 * allows any origin; a request only does something with a valid token.
 */
export function createApp(o: AppOptions) {
  const { db } = o;
  const app = new Hono<Env>();
  const throttle = new LoginThrottle();

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

  const signedIn = createMiddleware<Env>(async (c, next) => {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    const s = m ? sessionUser(db, m[1]!) : null;
    if (!s) throw new Fail("unauthorized", 401);
    c.set("user", s.user);
    c.set("sessionId", s.sessionId);
    await next();
  });

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

  app.get("/api/me", signedIn, (c) => c.json(c.get("user")));

  app.post("/api/logout", signedIn, (c) => {
    endSession(db, c.get("sessionId"));
    return c.body(null, 204);
  });

  app.all("/api/*", () => {
    throw new Fail("not_found", 404);
  });

  if (o.webDir) app.get("*", webFiles(o.webDir));

  return app;
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Fail("bad_request", 400);
  return body as Record<string, unknown>;
}

const text = (v: unknown) => (typeof v === "string" ? v : "");
