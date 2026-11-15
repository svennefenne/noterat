import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorCode, User } from "@noterat/core";
import { sessionUser } from "./auth";
import type { DB } from "./db";

/** A request turned down: the API answers `{ "error": code }` with this status. */
export class Fail extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: ContentfulStatusCode,
  ) {
    super(code);
  }
}

export type Env = { Variables: { user: User; sessionId: string } };

/** Only with a valid session token (`Authorization: Bearer …`); its user is c.get("user"). */
export const signedIn = (db: DB) =>
  createMiddleware<Env>(async (c, next) => {
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    const s = m ? sessionUser(db, m[1]!) : null;
    if (!s) throw new Fail("unauthorized", 401);
    c.set("user", s.user);
    c.set("sessionId", s.sessionId);
    await next();
  });

/** Only for an admin (decision 14): turned down otherwise. */
export function requireAdmin(user: { role: string }) {
  if (user.role !== "admin") throw new Fail("forbidden", 403);
}

/** The request's JSON body, which has to be an object. */
export async function readBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Fail("bad_request", 400);
  return body as Record<string, unknown>;
}

export const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Where links to this server point (share links, calendar feeds): PUBLIC_URL, else the address the request came to. */
export function publicAddress(c: Context, publicUrl: string): string {
  if (publicUrl) return publicUrl;
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host")?.split(",")[0]?.trim() || c.req.header("host") || url.host;
  return `${proto}://${host}`;
}
