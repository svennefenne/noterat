/**
 * Days and times as the household writes them (decision 14): "15 nov 2026" or "2026-11-15", a 24- or a
 * 12-hour clock, and weeks starting on Monday or Sunday. The app and the server (the mails) both write
 * them from here. A day is "YYYY-MM-DD" (a wall-clock day, as the app keeps them) or a Date.
 */

export type DateStyle = "text" | "iso";
export type Clock = "24" | "12";
export type WeekStart = "monday" | "sunday";

export interface DateRules {
  lang: "sv" | "en";
  dateStyle: DateStyle;
  clock: Clock;
  weekStart: WeekStart;
}

export const DATE_RULES: DateRules = { lang: "sv", dateStyle: "text", clock: "24", weekStart: "monday" };

const LOCALE = { sv: "sv-SE", en: "en-GB" } as const;
const pad = (n: number) => String(n).padStart(2, "0");

/** a "YYYY-MM-DD" (or "YYYY-MM-DDTHH:MM") at noon, or as it is: a Date */
function dateOf(d: Date | string): Date {
  if (d instanceof Date) return d;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(d);
  if (!m) return new Date(d);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 12, m[5] ? Number(m[5]) : 0);
}

/** (Swedish "15 nov." → "15 nov") */
const tidy = (s: string) => s.replace(/\.(?=\s|,|$)/g, "");

const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * A day: "15 nov" (the year when it isn't this year's, or `year: true`), or "2026-11-15"; with
 * `weekday`, "lör 15 nov" / "lör 2026-11-15"; with `long`, the month's whole name.
 */
export function formatDay(
  day: Date | string,
  r: DateRules,
  o: { year?: boolean; weekday?: boolean; long?: boolean; now?: Date } = {},
): string {
  const d = dateOf(day);
  if (Number.isNaN(d.getTime())) return "";
  const weekday = o.weekday ? tidy(new Intl.DateTimeFormat(LOCALE[r.lang], { weekday: o.long ? "long" : "short" }).format(d)) : "";
  if (r.dateStyle === "iso") return [weekday, isoDay(d)].filter(Boolean).join(" ");
  const year = o.year ?? d.getFullYear() !== (o.now ?? new Date()).getFullYear();
  const text = tidy(
    new Intl.DateTimeFormat(LOCALE[r.lang], { day: "numeric", month: o.long ? "long" : "short", ...(year ? { year: "numeric" } : {}) }).format(d),
  );
  return [weekday, text].filter(Boolean).join(r.lang === "en" && weekday ? ", " : " ").replace(/^, /, "");
}

/** A time of day: "14:05", or "2:05 pm" (a Date, or "HH:MM", or a wall-clock "YYYY-MM-DDTHH:MM"). */
export function formatTime(time: Date | string, r: DateRules): string {
  let d: Date;
  if (time instanceof Date) d = time;
  else {
    const m = /(?:^|T)(\d{2}):(\d{2})/.exec(time);
    if (!m) return "";
    d = new Date(2000, 0, 1, Number(m[1]), Number(m[2]));
  }
  if (r.clock === "24") return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return new Intl.DateTimeFormat(LOCALE[r.lang], { hour: "numeric", minute: "2-digit", hourCycle: "h12" }).format(d);
}

/** A moment: its day and time ("15 nov 14:05"). */
export const formatMoment = (at: Date | number, r: DateRules, o: { year?: boolean; now?: Date } = {}) => {
  const d = at instanceof Date ? at : new Date(at);
  return `${formatDay(d, r, o)} ${formatTime(d, r)}`;
};

/** A month: "november 2026", or "2026-11". */
export function formatMonth(month: Date | string, r: DateRules, o: { short?: boolean } = {}): string {
  const d = typeof month === "string" && /^\d{4}-\d{2}$/.test(month) ? dateOf(`${month}-01`) : dateOf(month);
  if (r.dateStyle === "iso") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  return tidy(new Intl.DateTimeFormat(LOCALE[r.lang], { month: o.short ? "short" : "long", year: "numeric" }).format(d));
}

/** The week's days in order, from the first: their short names ("mån", "tis", …). */
export function weekdayNames(r: DateRules, width: "short" | "narrow" | "long" = "short"): string[] {
  const f = new Intl.DateTimeFormat(LOCALE[r.lang], { weekday: width });
  // (2023-01-02 was a Monday)
  const first = r.weekStart === "monday" ? 2 : 1;
  return Array.from({ length: 7 }, (_, i) => tidy(f.format(new Date(2023, 0, first + i, 12))));
}

/** How far into its week a day is (0: the week's first day). */
export const dayOfWeek = (d: Date, r: DateRules) => (r.weekStart === "monday" ? (d.getDay() + 6) % 7 : d.getDay());

/** The hours and minutes of `at` in a time zone ("HH:MM"), or on this machine's clock without one. */
export function clockIn(at: Date, timeZone?: string): string {
  if (!timeZone) return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${v("hour")}:${v("minute")}`;
}

/** The day ("YYYY-MM-DD") `at` is in a time zone. */
export function dayIn(at: Date, timeZone?: string): string {
  if (!timeZone) return isoDay(at);
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Whether a time zone is one this runtime knows ("Europe/Stockholm"). */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
