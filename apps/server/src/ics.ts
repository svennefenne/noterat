import { createHash } from "node:crypto";
import ICAL from "ical.js";
import { floating, isWhen, type CalEvent } from "@noterat/core";

/**
 * ICS files, in and out (decision 10).
 *
 * In: a subscription (Google's, Outlook's, iCloud's, a sports team's) read with ical.js into Noterat's
 * events, whose times are local wall-clock times in one zone and whose repeats are RRULEs expanded in
 * that same wall-clock time (core's occurrences()). So every time in the file is turned into wall-clock
 * time here, and the parts of a repeat that name times (UNTIL, EXDATE, RECURRENCE-ID) are turned the
 * same way as the event's start, so they still line up with the occurrences core will expand.
 *
 * Out: Noterat's calendars as one feed for other calendar apps, with times in Europe/Stockholm and its
 * VTIMEZONE, so 09:00 stays 09:00 across summer time there too.
 */

const STOCKHOLM = "Europe/Stockholm";
const DAY = 86_400_000;
const MAX_EVENTS = 5000;
/** Events that ended longer ago than this are left out of a subscription. */
const KEEP_PAST = 365 * DAY;

const notCalendar = () => new Error("that isn't a calendar file");

// ───────────── wall-clock time ─────────────

/*
 * A wall-clock time is kept as a number: the milliseconds of a Date whose UTC fields are those
 * wall-clock fields (core's floating()). A zone turns instants into wall-clock times and back.
 */

interface Zone {
  toWall(instant: number): number;
  toInstant(wall: number): number;
}

const UTC: Zone = { toWall: (i) => i, toInstant: (w) => w };

const formatters = new Map<string, Intl.DateTimeFormat>();
const ianaZones = new Map<string, Zone>();

/** A zone from the time zone database the runtime knows (Intl), for any IANA name. */
function ianaZone(name: string): Zone {
  const had = ianaZones.get(name);
  if (had) return had;
  let f = formatters.get(name);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: name, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    formatters.set(name, f);
  }
  const fmt = f;
  const toWall = (instant: number) => {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(instant))) if (part.type !== "literal") p[part.type] = Number(part.value);
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  };
  // (the offset at a guess, then at the answer, which settles it except in the hour summer time skips)
  const toInstant = (wall: number) => {
    const guess = wall - (toWall(wall) - wall);
    return wall - (toWall(guess) - guess);
  };
  const zone = { toWall, toInstant };
  ianaZones.set(name, zone);
  return zone;
}

/** Windows' names for the zones Outlook may name without a VTIMEZONE, as IANA names. */
const WINDOWS_ZONES: Record<string, string> = {
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw",
  "Romance Standard Time": "Europe/Paris",
  "GMT Standard Time": "Europe/London",
  "FLE Standard Time": "Europe/Helsinki",
  "E. Europe Standard Time": "Europe/Chisinau",
  "Eastern Standard Time": "America/New_York",
  "Pacific Standard Time": "America/Los_Angeles",
};

function ianaName(tzid: string): string | null {
  const name = WINDOWS_ZONES[tzid] ?? tzid.replace(/^\/[^/]*\/[^/]*\//, ""); // ("/mozilla.org/20050126_1/Europe/Stockholm")
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return name;
  } catch {
    return null;
  }
}

/** The wall-clock fields of an ical.js time (whatever its zone). */
const wallOf = (t: ICAL.Time) => Date.UTC(t.year, t.month - 1, t.day, t.isDate ? 0 : t.hour, t.isDate ? 0 : t.minute, t.isDate ? 0 : t.second);

const sane = (t: unknown): t is ICAL.Time => t instanceof ICAL.Time && t.year >= 1000 && t.year <= 9999 && Number.isFinite(wallOf(t));

const icalZones = new WeakMap<ICAL.Timezone, Zone>();

/** A zone from the file's own VTIMEZONE, which ical.js finds by the TZID within the parsed calendar. */
function icalZone(z: ICAL.Timezone): Zone {
  let zone = icalZones.get(z);
  if (!zone) {
    zone = {
      toWall: (i) => wallOf(ICAL.Time.fromJSDate(new Date(i), true).convertToZone(z)),
      toInstant: (w) => {
        const d = new Date(w);
        return new ICAL.Time({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), isDate: false }, z).toUnixTime() * 1000;
      },
    };
    icalZones.set(z, zone);
  }
  return zone;
}

/**
 * The zone a date-time in the file is in: UTC ("Z"), the file's VTIMEZONE for its TZID, the IANA zone
 * of that name when the file has no VTIMEZONE for it, or none (null) for a floating time.
 */
function zoneOf(t: ICAL.Time, prop: ICAL.Property): Zone | null {
  if (t.isDate) return null;
  if (t.zone === ICAL.Timezone.utcTimezone || t.zone?.tzid === "UTC") return UTC;
  if (t.zone && t.zone !== ICAL.Timezone.localTimezone && t.zone.tzid !== "floating") return icalZone(t.zone);
  const tzid = prop.getFirstParameter("tzid");
  const name = typeof tzid === "string" && tzid ? ianaName(tzid) : null;
  return name ? ianaZone(name) : null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const parts = (w: number) => {
  const d = new Date(w);
  return { y: pad(d.getUTCFullYear(), 4), mo: pad(d.getUTCMonth() + 1), d: pad(d.getUTCDate()), h: pad(d.getUTCHours()), mi: pad(d.getUTCMinutes()), s: pad(d.getUTCSeconds()) };
};
/** "2026-11-15" or "2026-11-15T09:00", as CalEvent keeps them. */
const ours = (w: number, allDay: boolean) => {
  const p = parts(w);
  return allDay ? `${p.y}-${p.mo}-${p.d}` : `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}`;
};
/** "20261115" or "20261115T090000", as ICS writes them. */
const icsForm = (w: number, allDay: boolean) => {
  const p = parts(w);
  return allDay ? `${p.y}${p.mo}${p.d}` : `${p.y}${p.mo}${p.d}T${p.h}${p.mi}${p.s}`;
};
const startOfDay = (w: number) => Math.floor(w / DAY) * DAY;

// ───────────── reading ─────────────

const str = (v: unknown) => (typeof v === "string" ? v : "");
const line = (v: unknown, max: number) => str(v).replace(/\s+/g, " ").trim().slice(0, max);
const cancelled = (v: ICAL.Component) => str(v.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED";

/** An event as read, with what its repeat's exceptions need to be turned the same way as its start. */
interface Read {
  event: CalEvent;
  /** the id it's made from (UID, or UID and recurrence id) */
  base: string;
  /** the zone of its DTSTART, its DTSTART's own wall-clock time, and how far local time is from it */
  zone: Zone;
  ownStart: number;
  shift: number;
  /** wall-clock time (local) after which it no longer happens, for leaving out the long past */
  endsAt: number;
}

/** The text, split into its VCALENDARs (a file may hold more than one). */
function parseCalendars(text: string): ICAL.Component[] {
  const t = text.replace(/^\uFEFF/, "");
  if (!/^\s*BEGIN:VCALENDAR\s*$/im.test(t.slice(0, 2000))) throw notCalendar();
  let jcal: unknown;
  try {
    jcal = ICAL.parse(t);
  } catch {
    // Some feeds have a stray line that is neither a property nor a folded continuation (a description
    // broken by a careless writer): without those lines, the rest can still be read.
    try {
      jcal = ICAL.parse(t.split(/\r?\n/).filter((l) => /^[ \t]/.test(l) || /^[A-Za-z0-9-]+[;:]/.test(l)).join("\r\n"));
    } catch {
      throw notCalendar();
    }
  }
  const list = Array.isArray(jcal) && typeof jcal[0] === "string" ? [jcal] : Array.isArray(jcal) ? jcal : [];
  const roots = list.filter((j): j is unknown[] => Array.isArray(j) && j[0] === "vcalendar").map((j) => new ICAL.Component(j));
  if (!roots.length) throw notCalendar();
  return roots;
}

const clean = (s: string) => s.replace(/[^A-Za-z0-9._@-]+/g, "-").replace(/^-+|-+$/g, "");
/** An id from a UID: only safe characters, at most 120 of them (a long one keeps a hash of the rest). */
function idFrom(raw: string): string {
  const s = clean(raw) || "event";
  return s.length <= 120 ? s : `${s.slice(0, 107)}-${createHash("sha1").update(raw).digest("hex").slice(0, 12)}`;
}

/** An ICS file (a subscription) as events in local wall-clock time of `tz`. */
export function readIcs(text: string, o: { tz?: string; now?: Date } = {}): { name: string; events: CalEvent[] } {
  const local = ianaZone(o.tz ?? STOCKHOLM);
  const now = (o.now ?? new Date()).getTime();
  const cutoff = local.toWall(now) - KEEP_PAST;
  const roots = parseCalendars(text);
  const name = line(roots.map((r) => r.getFirstPropertyValue("x-wr-calname")).find((n) => str(n).trim()), 80);

  /** A date-time from the file as local wall-clock time. */
  const toLocal = (t: ICAL.Time, prop: ICAL.Property) => {
    const z = zoneOf(t, prop);
    return z ? local.toWall(z.toInstant(wallOf(t))) : wallOf(t);
  };

  /**
   * A time that names one of a repeating event's occurrences (EXDATE, RECURRENCE-ID), in the form core
   * gives that occurrence's start. Core repeats the event at its first local wall-clock time, so the
   * time is taken to the event's own zone and moved as far as the start was; for an event kept in the
   * local zone (most are) that's simply its local time.
   */
  const occurrenceOf = (t: ICAL.Time, prop: ICAL.Property, r: Read): string => {
    if (r.event.allDay) return ours(t.isDate ? wallOf(t) : toLocal(t, prop), true);
    let own: number;
    if (t.isDate) own = wallOf(t) + (r.ownStart - startOfDay(r.ownStart));
    else {
      const z = zoneOf(t, prop);
      own = z && z !== r.zone ? r.zone.toWall(z.toInstant(wallOf(t))) : wallOf(t);
    }
    return ours(own + r.shift, false);
  };

  /** UNTIL, in the same local form as the start (core expands it as floating time). */
  const untilOf = (u: ICAL.Time, r: Read): number => {
    if (r.event.allDay) return startOfDay(u.isDate || u.zone !== ICAL.Timezone.utcTimezone ? wallOf(u) : local.toWall(wallOf(u)));
    if (u.isDate) return wallOf(u) + DAY - 1000 + r.shift;
    return (u.zone === ICAL.Timezone.utcTimezone ? r.zone.toWall(wallOf(u)) : wallOf(u)) + r.shift;
  };

  function readOne(v: ICAL.Component, base: string): Read | null {
    const sp = v.getFirstProperty("dtstart");
    const st = sp?.getFirstValue();
    if (!sp || !sane(st)) return null;
    const allDay = st.isDate;
    const own = zoneOf(st, sp);
    const ownStart = wallOf(st);
    const start = own ? local.toWall(own.toInstant(ownStart)) : ownStart;
    const r: Read = { event: { id: "", title: "", start: ours(start, allDay), end: "", allDay, rrule: "", exdates: [], location: "", notes: "", reminders: [] }, base, zone: own ?? local, ownStart, shift: start - ownStart, endsAt: start };

    const ep = v.getFirstProperty("dtend");
    const et = ep?.getFirstValue();
    const dur = v.getFirstPropertyValue("duration");
    let end = start;
    if (allDay) {
      // (an all-day DTEND is the day after the last one)
      if (ep && sane(et)) end = startOfDay(wallOf(et)) - DAY;
      else if (dur instanceof ICAL.Duration) end = start + (Math.max(1, Math.round(dur.toSeconds() / 86_400)) - 1) * DAY;
      end = Math.max(end, start);
      r.endsAt = end + DAY;
    } else {
      if (ep && sane(et)) end = et.isDate ? wallOf(et) : toLocal(et, ep);
      else if (dur instanceof ICAL.Duration) end = local.toWall(r.zone.toInstant(ownStart) + dur.toSeconds() * 1000);
      end = Math.max(end, start);
      r.endsAt = end;
    }
    r.event.end = ours(end, allDay);

    const rp = v.getFirstProperty("rrule");
    const rule = rp?.getFirstValue();
    if (rp && rule instanceof ICAL.Recur) {
      // The rule as the file wrote it, but for UNTIL in local time, weekdays moved when the start moved to
      // another day (an evening in New York is a night here), and no X- parts (the rrule library refuses them).
      const days = Math.round((startOfDay(start) - startOfDay(ownStart)) / DAY);
      const wd = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
      const until = rule.until && sane(rule.until) ? untilOf(rule.until, r) : null;
      r.event.rrule = rp
        .toICALString()
        .replace(/^[^:]*:/, "")
        .split(";")
        .filter((p) => p && !/^X-/i.test(p))
        .map((p) => {
          const [k = "", val = ""] = p.split("=");
          if (k.toUpperCase() === "UNTIL" && until !== null) return `UNTIL=${icsForm(until, allDay)}`;
          if (k.toUpperCase() === "BYDAY" && days)
            return `BYDAY=${val
              .split(",")
              .map((d) => d.replace(/(MO|TU|WE|TH|FR|SA|SU)$/i, (x) => wd[(((wd.indexOf(x.toUpperCase()) + days) % 7) + 7) % 7]!))
              .join(",")}`;
          return p;
        })
        .join(";");
      r.endsAt = until !== null ? Math.max(until, start) : Infinity;
    }

    const exdates = new Set<string>();
    if (r.event.rrule)
      for (const p of v.getAllProperties("exdate")) for (const x of p.getValues() as unknown[]) if (sane(x)) exdates.add(occurrenceOf(x, p, r));
    r.event.exdates = [...exdates];

    r.event.title = line(v.getFirstPropertyValue("summary"), 200);
    r.event.location = line(v.getFirstPropertyValue("location"), 200);
    r.event.notes = str(v.getFirstPropertyValue("description")).replace(/\r\n?/g, "\n").trim().slice(0, 4000);

    // Reminders: alarms some time before the start (or at it); one at a fixed time, or after, is left out.
    const reminders = new Set<number>();
    for (const a of v.getAllSubcomponents("valarm")) {
      const tp = a.getFirstProperty("trigger");
      const tv = tp?.getFirstValue();
      if (!tp || !(tv instanceof ICAL.Duration) || str(tp.getFirstParameter("related")).toUpperCase() === "END") continue;
      const s = tv.toSeconds();
      if (s <= 0) reminders.add(Math.abs(Math.round(s / 60)));
    }
    r.event.reminders = [...reminders].sort((a, b) => a - b).slice(0, 10);
    return r;
  }

  const read: Read[] = [];
  const masters = new Map<string, Read>();
  const cancelledSeries = new Set<string>();
  const moved: ICAL.Component[] = [];
  const events = roots.flatMap((root) => root.getAllSubcomponents("vevent"));
  for (const v of events) {
    if (v.hasProperty("recurrence-id")) {
      moved.push(v);
      continue;
    }
    const uid = str(v.getFirstPropertyValue("uid")).trim();
    if (cancelled(v)) {
      cancelledSeries.add(uid);
      continue;
    }
    // (an event without a UID still gets the same id each time the file is fetched)
    const base = uid || `event-${createHash("sha1").update(v.toString()).digest("hex").slice(0, 16)}`;
    let r: Read | null = null;
    try {
      r = readOne(v, base);
    } catch {
      // (an event the file has broken is left out, not the whole calendar)
    }
    if (!r) continue;
    read.push(r);
    if (uid && r.event.rrule && !masters.has(uid)) masters.set(uid, r);
  }

  // Moved and cancelled occurrences: skipped in their series, and a moved one an event of its own.
  for (const v of moved) {
    const uid = str(v.getFirstPropertyValue("uid")).trim();
    if (cancelledSeries.has(uid)) continue;
    try {
      const rp = v.getFirstProperty("recurrence-id")!;
      const rid = rp.getFirstValue();
      if (!sane(rid)) continue;
      const master = masters.get(uid);
      const at = master ? occurrenceOf(rid, rp, master) : ours(rid.isDate ? wallOf(rid) : toLocal(rid, rp), rid.isDate);
      if (master && !master.event.exdates.includes(at)) master.event.exdates.push(at);
      if (cancelled(v)) continue;
      const r = readOne(v, `${uid}/${at}`);
      if (r) read.push(r);
    } catch {
      // (as above)
    }
  }

  // Bounded: not the long past, and at most MAX_EVENTS, the repeating ones and those nearest now first.
  let kept = read.filter((r) => r.endsAt >= cutoff);
  if (kept.length > MAX_EVENTS) {
    const nowWall = local.toWall(now);
    const distance = (r: Read) => (r.event.rrule ? 0 : Math.abs(floating(r.event.start).getTime() - nowWall));
    const keep = new Set([...kept].sort((a, b) => distance(a) - distance(b)).slice(0, MAX_EVENTS));
    kept = kept.filter((r) => keep.has(r));
  }

  const ids = new Set<string>();
  return {
    name,
    events: kept.map((r) => {
      const base = idFrom(r.base);
      let id = base;
      for (let n = 2; ids.has(id); n++) id = `${base.slice(0, 120 - String(n).length - 1)}-${n}`;
      ids.add(id);
      return { ...r.event, id };
    }),
  };
}

// ───────────── writing ─────────────

/** Europe/Stockholm as RFC 5545 describes a zone: CEST from the last Sunday of March, CET from October's. */
const STOCKHOLM_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Stockholm",
  "X-LIC-LOCATION:Europe/Stockholm",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** TEXT as RFC 5545 escapes it (and without control characters, which it doesn't allow). */
const text = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .replace(/[\\;,]/g, (c) => `\\${c}`)
    .replace(/\n/g, "\\n");

const utcStamp = (instant: number) => `${icsForm(instant, false)}Z`;

/** A line folded at 75 octets, never inside a character's UTF-8 bytes. */
function fold(l: string): string {
  if (Buffer.byteLength(l) <= 75) return l;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let room = 75;
  for (const ch of l) {
    const cp = ch.codePointAt(0)!;
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + n > room) {
      out.push(cur);
      cur = "";
      bytes = 0;
      room = 74; // (a continuation line starts with a space)
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** Calendars as one ICS feed for other calendar apps. */
export function writeIcs(calendars: { id: string; title: string; events: CalEvent[] }[], o: { name: string; tz?: string; now?: Date }): string {
  const tz = o.tz ?? STOCKHOLM;
  // With Stockholm's VTIMEZONE times are written as they are. Another zone is written in UTC instead:
  // right for every single event, while a repeat keeps its first occurrence's UTC time (so moves an hour
  // across summer time), and its exceptions are written to match that.
  const named = tz === STOCKHOLM;
  const local = ianaZone(tz);
  const toUtc = (w: number) => local.toInstant(w);
  const at = (s: string, utc = toUtc) => (named ? `;TZID=${tz}:${icsForm(floating(s).getTime(), false)}` : `:${utcStamp(utc(floating(s).getTime()))}`);
  const day = (s: string, plus = 0) => `;VALUE=DATE:${icsForm(floating(s).getTime() + plus * DAY, true)}`;

  /** The repeat, with UNTIL as RFC 5545 wants it: a date for all-day events, else UTC. */
  const rule = (rrule: string, allDay: boolean, utc: (w: number) => number) =>
    rrule
      .replace(/^RRULE:/i, "")
      .replace(/[\r\n]/g, "")
      .split(";")
      .filter(Boolean)
      .map((p) => {
        const m = /^UNTIL=(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z?)$/i.exec(p);
        if (!m) return p;
        const [, y, mo, d, h = "23", mi = "59", s = "59", z] = m;
        if (allDay) return `UNTIL=${y}${mo}${d}`;
        if (z) return p.toUpperCase();
        return `UNTIL=${utcStamp(utc(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s)))}`;
      })
      .join(";");

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Noterat//Calendar//SV", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${text(o.name)}`, `X-WR-TIMEZONE:${tz}`];
  if (named) lines.push(...STOCKHOLM_VTIMEZONE);
  const stamp = utcStamp((o.now ?? new Date()).getTime());
  for (const cal of calendars)
    for (const e of cal.events) {
      if (!isWhen(e.start, e.allDay)) continue;
      const end = isWhen(e.end, e.allDay) && e.end >= e.start ? e.end : e.start;
      // (the calendar's id too, so the same event id in two calendars is two events)
      lines.push("BEGIN:VEVENT", `UID:${text(`${cal.id}.${e.id}`)}@noterat`, `DTSTAMP:${stamp}`);
      if (e.allDay) lines.push(`DTSTART${day(e.start)}`, `DTEND${day(end, 1)}`);
      else lines.push(`DTSTART${at(e.start)}`, `DTEND${at(end)}`);
      const first = floating(e.start).getTime();
      const repeatUtc = named ? toUtc : (w: number) => w - (first - toUtc(first));
      const r = e.rrule ? rule(e.rrule, e.allDay, repeatUtc) : "";
      if (r) {
        lines.push(`RRULE:${r}`);
        for (const x of new Set(e.exdates)) if (isWhen(x, e.allDay)) lines.push(`EXDATE${e.allDay ? day(x) : at(x, repeatUtc)}`);
      }
      if (e.title) lines.push(`SUMMARY:${text(e.title)}`);
      if (e.location) lines.push(`LOCATION:${text(e.location)}`);
      if (e.notes) lines.push(`DESCRIPTION:${text(e.notes)}`);
      if (cal.title) lines.push(`CATEGORIES:${text(cal.title)}`);
      for (const m of new Set(e.reminders))
        if (Number.isInteger(m) && m >= 0) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${text(e.title || "Påminnelse")}`, `TRIGGER:-PT${m}M`, "END:VALARM");
      lines.push("END:VEVENT");
    }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
