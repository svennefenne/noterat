import type { Hono } from "hono";
import { cleanHousehold, defaultHousehold, HOUSEHOLD_CHANGED, type Household } from "@noterat/core";
import type { DB } from "./db";
import { readBody, requireAdmin, signedIn, type Env } from "./http";
import type { Sync } from "./sync";

/**
 * The household's settings (decision 14), kept in the settings table: read by anyone (the log-in page
 * takes its look and language from them too; there's nothing private in them), changed by an admin, and
 * every app that's connected is told at once. The time zone starts as the container's (TZ).
 */

const KEY = "household";

export function createHousehold(db: DB, o: { timeZone?: string } = {}) {
  const base = () => defaultHousehold(o.timeZone || process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone);
  let cached: Household | null = null;

  function get(): Household {
    if (cached) return cached;
    const row = db.prepare("select value from settings where key = ?").get(KEY) as { value: string } | undefined;
    let stored: unknown = null;
    try {
      stored = row ? JSON.parse(row.value) : null;
    } catch {
      // (unreadable: as it comes)
    }
    cached = cleanHousehold(stored, base());
    return cached;
  }

  /** A part of the settings (or all): what's wrong in it is left as it was. */
  function save(patch: unknown): Household {
    const next = cleanHousehold(patch, get());
    db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(KEY, JSON.stringify(next));
    cached = next;
    return next;
  }

  return { get, save };
}

export type HouseholdSettings = ReturnType<typeof createHousehold>;

export function householdRoutes(app: Hono<Env>, o: { db: DB; household: HouseholdSettings; sync: Sync }) {
  app.get("/api/household", (c) => c.json(o.household.get()));

  app.put("/api/admin/household", signedIn(o.db), async (c) => {
    requireAdmin(c.get("user"));
    const next = o.household.save(await readBody(c));
    o.sync.tellAll(HOUSEHOLD_CHANGED);
    return c.json(next);
  });
}
