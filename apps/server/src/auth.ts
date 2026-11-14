import crypto from "node:crypto";
import { promisify } from "node:util";
import type { User } from "@noterat/core";
import type { DB } from "./db";
import { toUser, type UserRow } from "./users";

/**
 * Passwords and sessions. A password is kept as an scrypt hash. Logging in gives the device a random
 * token (sent back as `Authorization: Bearer …`); the server keeps only the token's sha256, so its
 * database can't be used to log in. A session lasts SESSION_DAYS from when it was last used, so a phone
 * that's used now and then stays logged in.
 */

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(got, want);
}

// a username that doesn't exist takes as long to turn down as a wrong password (no telling which it was)
let dummy: Promise<string> | null = null;
export const dummyHash = () => (dummy ??= hashPassword(crypto.randomBytes(16).toString("hex")));

const DAY = 86_400_000;
const SESSION_DAYS = 180;

const tokenId = (token: string) => crypto.createHash("sha256").update(token).digest("base64url");

/** A new session for a user; returns its token (the one time it's seen). */
export function createSession(db: DB, userId: number, userAgent: string): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const t = Date.now();
  db.prepare("insert into sessions (id, user_id, created_at, last_used, expires_at, user_agent) values (?, ?, ?, ?, ?, ?)").run(
    tokenId(token),
    userId,
    t,
    t,
    t + SESSION_DAYS * DAY,
    userAgent.slice(0, 300),
  );
  return token;
}

/** Whose session a token is (null: none, or it ran out). Using it makes it last SESSION_DAYS from now. */
export function sessionUser(db: DB, token: string): { user: User; sessionId: string } | null {
  const id = tokenId(token);
  const row = db
    .prepare("select s.last_used, s.expires_at, u.* from sessions s join users u on u.id = s.user_id where s.id = ?")
    .get(id) as (UserRow & { last_used: number; expires_at: number }) | undefined;
  if (!row) return null;
  const t = Date.now();
  if (row.expires_at <= t) {
    endSession(db, id);
    return null;
  }
  // (written at most once an hour, not on every request)
  if (t - row.last_used > 3_600_000) db.prepare("update sessions set last_used = ?, expires_at = ? where id = ?").run(t, t + SESSION_DAYS * DAY, id);
  return { user: toUser(row), sessionId: id };
}

export function endSession(db: DB, sessionId: string) {
  db.prepare("delete from sessions where id = ?").run(sessionId);
}

/**
 * Slows down password guessing: after PER_NAME wrong passwords for one username from one address, or
 * PER_ADDRESS from one address, within WINDOW, that address waits until the oldest is WINDOW old.
 * (In memory: a restart forgets, which is fine for a home server.)
 */
export class LoginThrottle {
  private fails = new Map<string, number[]>();

  constructor(
    private readonly perName = 5,
    private readonly perAddress = 30,
    private readonly window = 15 * 60_000,
  ) {}

  blocked(ip: string, username: string): boolean {
    return this.recent(nameKey(ip, username)).length >= this.perName || this.recent(ip).length >= this.perAddress;
  }

  failed(ip: string, username: string) {
    const t = Date.now();
    for (const key of [nameKey(ip, username), ip]) this.fails.set(key, [...this.recent(key), t]);
    if (this.fails.size > 10_000) for (const key of this.fails.keys()) if (!this.recent(key).length) this.fails.delete(key);
  }

  succeeded(ip: string, username: string) {
    this.fails.delete(nameKey(ip, username));
  }

  private recent(key: string): number[] {
    const since = Date.now() - this.window;
    return (this.fails.get(key) ?? []).filter((t) => t > since);
  }
}

const nameKey = (ip: string, username: string) => `${ip}\n${username.toLowerCase()}`;
