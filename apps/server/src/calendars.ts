import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import * as Y from "yjs";
import { cleanUrl, readCalendar, replaceEvents, setCalendarMeta } from "@noterat/core";
import type { DB } from "./db";
import { decodePage, fetchPublic, FetchFailed } from "./fetch";
import { Fail, publicAddress, signedIn, type Env } from "./http";
import { readIcs, writeIcs } from "./ics";
import { loadObjectState, objectRow, roleOf } from "./objects";
import type { FetchPage } from "./recipes";
import type { Sync } from "./sync";

/**
 * Calendars on the server (decision 10): subscriptions to other calendars' ICS addresses, fetched (only
 * from the internet) and written into their documents, again every hour; and each person's private ICS
 * feed of their own calendars, for other calendar apps.
 */

const HOUR = 3_600_000;

export function calendarRoutes(app: Hono<Env>, o: { db: DB; sync: Sync; publicUrl: string; fetchPage?: FetchPage; every?: number }) {
  const { db, sync } = o;
  const fetchPage = o.fetchPage ?? fetchPublic;
  const auth = signedIn(db);

  /** A subscription fetched again: its events replaced, or the reason it couldn't be. */
  async function refresh(objectId: string): Promise<{ ok: boolean; error?: string; events?: number }> {
    const obj = objectRow(db, objectId);
    if (!obj || obj.deleted_at || obj.type !== "calendar") return { ok: false, error: "gone" };
    const source = await sync.readObject("calendar", objectId, (d) => readCalendar(d).source);
    const url = cleanUrl(source.replace(/^webcals?:\/\//i, "https://"));
    if (!url) return { ok: false, error: "no address" };
    const t = Date.now();
    db.prepare("insert into subscriptions (object_id, url, refreshed_at) values (?, ?, ?) on conflict(object_id) do update set url = excluded.url, refreshed_at = excluded.refreshed_at").run(objectId, url, t);
    try {
      const page = await fetchPage(url, { maxBytes: 20 * 1024 * 1024, accept: "text/calendar,*/*;q=0.5" });
      const { name, events } = readIcs(decodePage(page));
      await sync.changeObject("calendar", objectId, (d) => {
        replaceEvents(d, events, { refreshedAt: t });
        if (!readCalendar(d).title && name) setCalendarMeta(d, { title: name });
      });
      db.prepare("update subscriptions set error = null where object_id = ?").run(objectId);
      return { ok: true, events: events.length };
    } catch (err) {
      const error = err instanceof FetchFailed || err instanceof Error ? err.message : "the calendar couldn't be fetched";
      db.prepare("update subscriptions set error = ? where object_id = ?").run(error, objectId);
      await sync.changeObject("calendar", objectId, (d) => replaceEvents(d, readCalendar(d).events, { refreshedAt: t, error }));
      return { ok: false, error };
    }
  }

  // every hour, the subscriptions not fetched for an hour
  const timer = setInterval(() => {
    const due = db.prepare("select s.object_id from subscriptions s join objects o on o.id = s.object_id where o.deleted_at is null and s.refreshed_at < ?").all(Date.now() - HOUR) as { object_id: string }[];
    void (async () => {
      for (const s of due) await refresh(s.object_id).catch((err) => console.error("calendars:", err));
    })();
  }, o.every ?? 10 * 60_000);
  timer.unref();

  /** Fetch a subscription now: anyone who has it. */
  app.post("/api/objects/:id/refresh", auth, async (c) => {
    const obj = objectRow(db, c.req.param("id"));
    if (!obj) throw new Fail("not_synced", 404);
    if (obj.deleted_at) throw new Fail("not_found", 404);
    if (!roleOf(db, obj.id, c.get("user").id)) throw new Fail("forbidden", 403);
    if (obj.type !== "calendar") throw new Fail("wrong_type", 400);
    const r = await refresh(obj.id);
    if (!r.ok) throw new Fail("fetch_failed", 502);
    return c.json({ events: r.events });
  });

  const tokenOf = (userId: number, fresh = false) => {
    const had = db.prepare("select token from feeds where user_id = ?").get(userId) as { token: string } | undefined;
    if (had && !fresh) return had.token;
    const token = randomBytes(18).toString("base64url");
    db.prepare("insert into feeds (user_id, token, created_at) values (?, ?, ?) on conflict(user_id) do update set token = excluded.token, created_at = excluded.created_at").run(userId, token, Date.now());
    return token;
  };

  /** This person's feed address (made the first time). A new one turns the old one off. */
  app.get("/api/calendar-feed", auth, (c) => c.json({ url: `${publicAddress(c, o.publicUrl)}/cal/${tokenOf(c.get("user").id)}.ics` }));
  app.post("/api/calendar-feed", auth, (c) => c.json({ url: `${publicAddress(c, o.publicUrl)}/cal/${tokenOf(c.get("user").id, true)}.ics` }));

  /** The feed itself: the calendars this person has (not their subscriptions: those have feeds of their own). */
  app.get("/cal/:file", (c) => {
    const token = (c.req.param("file") ?? "").replace(/\.ics$/, "");
    const user = token ? (db.prepare("select f.user_id, u.display_name from feeds f join users u on u.id = f.user_id where f.token = ?").get(token) as { user_id: number; display_name: string } | undefined) : undefined;
    if (!user) throw new Fail("not_found", 404);
    const rows = db
      .prepare(
        `select o.id from members m join objects o on o.id = m.object_id
         where m.user_id = ? and o.type = 'calendar' and o.deleted_at is null and o.id not in (select object_id from subscriptions)`,
      )
      .all(user.user_id) as { id: string }[];
    const calendars = rows.flatMap((r) => {
      // (an open document has the newest state; else what was last stored)
      const open = sync.hocuspocus.documents.get(`calendar/${r.id}`);
      const doc = new Y.Doc();
      if (open) Y.applyUpdate(doc, Y.encodeStateAsUpdate(open));
      else {
        const state = loadObjectState(db, r.id);
        if (state) Y.applyUpdate(doc, state);
      }
      const cal = readCalendar(doc);
      if (cal.source) return [];
      return [{ id: r.id, title: cal.title, events: cal.events }];
    });
    c.header("Content-Type", "text/calendar; charset=utf-8");
    c.header("Cache-Control", "private, max-age=300");
    return c.body(writeIcs(calendars, { name: `Noterat – ${user.display_name}` }));
  });

  return { refresh, stop: () => clearInterval(timer) };
}
