import { datetime, RRule, rrulestr } from "rrule";
import * as Y from "yjs";
import { newObjectId } from "./docs";

/**
 * A calendar (decision 10). Its document:
 *
 * - meta: title, color, createdBy, createdAt; source (an ICS address) for a subscription, which the
 *   server fills in, and refreshedAt / error
 * - events: a Y.Map of events by id, each a Y.Map
 *
 * Times are local wall-clock times ("2026-11-15T09:00"; a day, "2026-11-15", for an all-day event), and
 * repeats are RRULE strings expanded in that same local time, so 09:00 stays 09:00 across summer time.
 */

export interface CalEvent {
  id: string;
  title: string;
  /** "YYYY-MM-DDTHH:mm", or "YYYY-MM-DD" all day */
  start: string;
  /** the same form; an all-day event's last day (inclusive) */
  end: string;
  allDay: boolean;
  /** "FREQ=WEEKLY;BYDAY=MO", or "" */
  rrule: string;
  /** occurrences skipped, by their start */
  exdates: string[];
  location: string;
  notes: string;
  /** minutes before */
  reminders: number[];
}

export interface CalendarView {
  title: string;
  color: string;
  source: string;
  refreshedAt: number;
  error: string;
  events: CalEvent[];
}

export interface Occurrence {
  calendarId: string;
  event: CalEvent;
  /** this occurrence's start and end, in the event's form */
  start: string;
  end: string;
}

export const CALENDAR_COLORS = ["#2f5d50", "#b5543a", "#3b6ea8", "#8a5a9e", "#c08a1e", "#4f8a3c", "#a8476b", "#5b6470"];

const meta = (doc: Y.Doc) => doc.getMap<unknown>("meta");
const eventsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("events");

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const isWhen = (s: unknown, allDay: boolean): s is string => typeof s === "string" && (allDay ? DAY : TIME).test(s);

export function initCalendar(doc: Y.Doc, o: { title: string; color?: string; source?: string; by: number }) {
  doc.transact(() => {
    meta(doc).set("title", o.title.replace(/\s+/g, " ").trim().slice(0, 80));
    meta(doc).set("color", o.color ?? CALENDAR_COLORS[0]);
    if (o.source) meta(doc).set("source", o.source);
    meta(doc).set("createdBy", o.by);
    meta(doc).set("createdAt", Date.now());
  });
}

function readEvent(id: string, m: Y.Map<unknown>): CalEvent | null {
  const allDay = m.get("allDay") === true;
  const start = m.get("start");
  if (!isWhen(start, allDay)) return null;
  const end = m.get("end");
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const arr = <T>(v: unknown, ok: (x: unknown) => x is T) => (Array.isArray(v) ? v.filter(ok) : []);
  return {
    id,
    title: str(m.get("title")),
    start,
    end: isWhen(end, allDay) && end >= start ? end : start,
    allDay,
    rrule: str(m.get("rrule")),
    exdates: arr(m.get("exdates"), (x): x is string => typeof x === "string"),
    location: str(m.get("location")),
    notes: str(m.get("notes")),
    reminders: arr(m.get("reminders"), (x): x is number => typeof x === "number" && x >= 0),
  };
}

export function readCalendar(doc: Y.Doc): CalendarView {
  const m = meta(doc);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const events: CalEvent[] = [];
  for (const [id, e] of eventsMap(doc)) {
    const ev = e instanceof Y.Map ? readEvent(id, e) : null;
    if (ev) events.push(ev);
  }
  return { title: str(m.get("title")), color: str(m.get("color")) || CALENDAR_COLORS[0]!, source: str(m.get("source")), refreshedAt: Number(m.get("refreshedAt")) || 0, error: str(m.get("error")), events };
}

export function setCalendarMeta(doc: Y.Doc, patch: { title?: string; color?: string }) {
  doc.transact(() => {
    if (patch.title !== undefined) meta(doc).set("title", patch.title.replace(/\s+/g, " ").trim().slice(0, 80));
    if (patch.color !== undefined) meta(doc).set("color", patch.color);
  });
}

export type EventInput = Omit<CalEvent, "id">;

function writeEvent(m: Y.Map<unknown>, e: Partial<EventInput>) {
  for (const [k, v] of Object.entries(e)) if (v !== undefined) m.set(k, Array.isArray(v) ? [...v] : v);
}

export function addEvent(doc: Y.Doc, e: EventInput, id = newObjectId()): string {
  const m = new Y.Map<unknown>();
  doc.transact(() => {
    eventsMap(doc).set(id, m);
    writeEvent(m, e);
  });
  return id;
}

export function updateEvent(doc: Y.Doc, id: string, patch: Partial<EventInput>) {
  const m = eventsMap(doc).get(id);
  if (m) doc.transact(() => writeEvent(m, patch));
}

export function removeEvent(doc: Y.Doc, id: string) {
  eventsMap(doc).delete(id);
}

/** One occurrence of a repeating event skipped (deleted, or moved into an event of its own). */
export function skipOccurrence(doc: Y.Doc, id: string, start: string) {
  const m = eventsMap(doc).get(id);
  if (!m) return;
  const had = Array.isArray(m.get("exdates")) ? (m.get("exdates") as string[]) : [];
  if (!had.includes(start)) m.set("exdates", [...had, start]);
}

/** All events replaced at once (a subscription, fetched again by the server). */
export function replaceEvents(doc: Y.Doc, events: CalEvent[], o: { refreshedAt: number; error?: string }) {
  doc.transact(() => {
    const map = eventsMap(doc);
    const keep = new Set(events.map((e) => e.id));
    for (const id of [...map.keys()]) if (!keep.has(id)) map.delete(id);
    for (const e of events) {
      const { id, ...rest } = e;
      const was = map.get(id);
      const now = was ? readEvent(id, was) : null;
      if (now && JSON.stringify(now) === JSON.stringify(e)) continue;
      const m = new Y.Map<unknown>();
      map.set(id, m);
      writeEvent(m, rest);
    }
    meta(doc).set("refreshedAt", o.refreshedAt);
    if (o.error) meta(doc).set("error", o.error);
    else meta(doc).delete("error");
  });
}

// ───────────── time, as wall-clock strings ─────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** A wall-clock string as a Date whose UTC fields are those wall-clock fields (rrule's "floating" time). */
export function floating(s: string): Date {
  const [d, t = "00:00"] = s.split("T");
  const [y, mo, da] = d!.split("-").map(Number) as [number, number, number];
  const [h, mi] = t.split(":").map(Number) as [number, number];
  return datetime(y, mo, da, h, mi);
}

export function wall(d: Date, allDay: boolean): string {
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return allDay ? day : `${day}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** A local Date (the device's own clock) as a wall-clock string. */
export function wallOf(d: Date, allDay = false): string {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return allDay ? day : `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A wall-clock string as a local Date (for reminders on this device). */
export function localDate(s: string): Date {
  const f = floating(s);
  return new Date(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes());
}

const span = (e: CalEvent) => floating(e.end).getTime() - floating(e.start).getTime();

/**
 * The occurrences of a calendar's events between two days (inclusive), in order: a single event once,
 * a repeating one as often as its rule says, its skipped ones left out. An event counts if any of it
 * falls in the range.
 */
export function occurrences(calendarId: string, events: CalEvent[], fromDay: string, toDay: string, max = 2000): Occurrence[] {
  const from = floating(fromDay);
  const to = new Date(floating(toDay).getTime() + 86_400_000 - 1);
  const out: Occurrence[] = [];
  for (const e of events) {
    const len = span(e);
    // (an all-day event's end is its last day: it lasts until that day's end)
    const reach = e.allDay ? len + 86_400_000 - 1 : len;
    const starts: Date[] = [];
    if (!e.rrule) starts.push(floating(e.start));
    else {
      try {
        const rule = rrulestr(`DTSTART:${floating(e.start).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}\nRRULE:${e.rrule.replace(/^RRULE:/i, "")}`, { forceset: false }) as RRule;
        starts.push(...rule.between(new Date(from.getTime() - reach), to, true).slice(0, max));
      } catch {
        starts.push(floating(e.start));
      }
    }
    for (const s of starts) {
      const start = wall(s, e.allDay);
      if (e.exdates.includes(start)) continue;
      if (s.getTime() > to.getTime() || s.getTime() + reach < from.getTime()) continue;
      out.push({ calendarId, event: e, start, end: wall(new Date(s.getTime() + len), e.allDay) });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || Number(b.event.allDay) - Number(a.event.allDay));
}

// ───────────── repeats, as people choose them ─────────────

export type Freq = "none" | "daily" | "weekly" | "monthly" | "yearly";

export interface Repeat {
  freq: Freq;
  interval: number;
  /** weekly: 0 = Monday … 6 = Sunday */
  days: number[];
  /** "YYYY-MM-DD", or "" for no end */
  until: string;
}

const FREQS: Record<Exclude<Freq, "none">, string> = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" };
const WD = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export function writeRepeat(r: Repeat): string {
  if (r.freq === "none") return "";
  const parts = [`FREQ=${FREQS[r.freq]}`];
  if (r.interval > 1) parts.push(`INTERVAL=${Math.min(99, Math.round(r.interval))}`);
  if (r.freq === "weekly" && r.days.length) parts.push(`BYDAY=${[...new Set(r.days)].sort().map((d) => WD[d]).join(",")}`);
  if (r.until) parts.push(`UNTIL=${r.until.replace(/-/g, "")}T235959`);
  return parts.join(";");
}

/** An RRULE as the editor shows it (a rule it can't show is kept, and says "custom"). */
export function readRepeat(rrule: string): Repeat & { custom: boolean } {
  const none = { freq: "none" as Freq, interval: 1, days: [], until: "", custom: false };
  if (!rrule) return none;
  const kv = Object.fromEntries(rrule.replace(/^RRULE:/i, "").split(";").map((p) => p.split("=") as [string, string]));
  const freq = (Object.entries(FREQS).find(([, v]) => v === kv.FREQ)?.[0] ?? "none") as Freq;
  const days = (kv.BYDAY ?? "")
    .split(",")
    .filter(Boolean)
    .map((d) => WD.indexOf(d))
    .filter((d) => d >= 0);
  const until = /^(\d{4})(\d{2})(\d{2})/.exec(kv.UNTIL ?? "");
  const known = new Set(["FREQ", "INTERVAL", "BYDAY", "UNTIL"]);
  const custom = freq === "none" || Object.keys(kv).some((k) => !known.has(k)) || (kv.BYDAY ?? "").split(",").some((d) => d && WD.indexOf(d) < 0) || (!!kv.BYDAY && freq !== "weekly");
  return { freq, interval: Number(kv.INTERVAL) || 1, days, until: until ? `${until[1]}-${until[2]}-${until[3]}` : "", custom };
}

export { RRule };
