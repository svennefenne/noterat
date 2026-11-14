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

/** The request's JSON body, which has to be an object. */
export async function readBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Fail("bad_request", 400);
  return body as Record<string, unknown>;
}

export const text = (v: unknown) => (typeof v === "string" ? v : "");
