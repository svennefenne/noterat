import { describe, expect, it } from "vitest";
import {
  cleanHousehold,
  clockIn,
  dayIn,
  dayOfWeek,
  defaultHousehold,
  formatDay,
  formatMonth,
  formatTime,
  isScheme,
  lookCss,
  lookTokens,
  mix,
  onColor,
  SCHEMES,
  schemeOf,
  weekdayNames,
  type DateRules,
} from "../src";

const sv: DateRules = { lang: "sv", dateStyle: "text", clock: "24", weekStart: "monday" };
const now = new Date(2026, 10, 15, 12);

describe("the household's settings", () => {
  it("start as the app was: Noterat's colours, Swedish, the journal and money off the start page", () => {
    const h = defaultHousehold("Europe/Stockholm");
    expect(h.look).toEqual({ scheme: "noterat", mode: "auto" });
    expect(h.locale).toEqual({ lang: "sv", dateStyle: "text", clock: "24", weekStart: "monday", timeZone: "Europe/Stockholm" });
    expect(h.home.sections.filter((s) => !s.show).map((s) => s.type)).toEqual(["journal", "money"]);
    expect(h.money.swish).toBe(true);
    expect(defaultHousehold("Not/AZone").locale.timeZone).toBe("Europe/Stockholm");
  });

  it("take a part of themselves, and keep what's missing or wrong as it was", () => {
    const had = defaultHousehold();
    const h = cleanHousehold({ look: { scheme: "nord", mode: "sideways" }, locale: { clock: "12", timeZone: "America/New_York", lang: "de" }, money: { swish: "no" } }, had);
    expect(h.look).toEqual({ scheme: "nord", mode: "auto" });
    expect(h.locale).toMatchObject({ lang: "sv", clock: "12", timeZone: "America/New_York" });
    expect(h.money.swish).toBe(true);
    expect(cleanHousehold({ look: { scheme: "no-such-scheme" } }, h).look.scheme).toBe("nord");
    expect(cleanHousehold(null, h)).toEqual(h);
    expect(cleanHousehold({ locale: { timeZone: "Mars/Olympus" } }, h).locale.timeZone).toBe("America/New_York");
  });

  it("keep every start-page section once, in the order given", () => {
    const had = defaultHousehold();
    const h = cleanHousehold({ home: { sections: [{ type: "money", show: true, count: 3 }, { type: "money", show: false }, { type: "list", count: 7 }, { type: "bogus" }] } }, had);
    expect(h.home.sections.map((s) => s.type)).toEqual(["money", "list", "calendar", "note", "memo", "scan", "recipe", "journal"]);
    expect(h.home.sections[0]).toEqual({ type: "money", show: true, count: 3 });
    expect(h.home.sections[1]).toEqual({ type: "list", show: true, count: 1 });
  });
});

describe("the colour schemes", () => {
  it("are Noterat's own and Hooden's 98, each with a light and a dark set", () => {
    expect(SCHEMES).toHaveLength(99);
    expect(SCHEMES[0]!.slug).toBe("noterat");
    expect(new Set(SCHEMES.map((s) => s.slug)).size).toBe(99);
    expect(SCHEMES.every((s) => /^#[0-9a-f]{6}$/i.test(s.light.bg) && /^#[0-9a-f]{6}$/i.test(s.dark.primary))).toBe(true);
    expect(isScheme("catppuccin-mocha")).toBe(true);
    expect(schemeOf("nope").slug).toBe("noterat");
  });

  it("keep Noterat's colours exactly, and make the app's variables from a scheme's nine", () => {
    expect(lookTokens(schemeOf("noterat"), "light")["--accent"]).toBe("#2f5d50");
    expect(lookTokens(schemeOf("noterat"), "dark")["--bg"]).toBe("#161514");
    const nord = lookTokens(schemeOf("nord"), "dark");
    expect(nord).toMatchObject({ "--bg": "#2e3440", "--accent": "#88c1d0", "--danger": "#bf616b", "color-scheme": "dark" });
    expect(nord["--line"]).toBe(mix("#2e3440", "#eceff4", 0.16));
    expect(lookTokens(schemeOf("nord"), "light")["color-scheme"]).toBe("light");
    expect(onColor("#ffffff")).toBe("#0b0d10");
    expect(onColor("#101010")).toBe("#fff8ec");
  });

  it("write the stylesheet for a mode: auto follows the device", () => {
    expect(lookCss("nord", "light")).toBe(`:root:root{${Object.entries(lookTokens(schemeOf("nord"), "light")).map(([k, v]) => `${k}:${v}`).join(";")}}`);
    expect(lookCss("nord", "dark")).not.toContain("@media");
    expect(lookCss("nord", "auto")).toMatch(/^:root:root\{--bg:#eceff4.*@media \(prefers-color-scheme: dark\)\{:root:root\{--bg:#2e3440/);
  });
});

describe("days and times", () => {
  it("are written with the month's name, or as ISO", () => {
    expect(formatDay("2026-11-15", sv, { now })).toBe("15 nov");
    expect(formatDay("2025-02-03", sv, { now })).toBe("3 feb 2025");
    expect(formatDay("2026-11-15", sv, { now, weekday: true })).toBe("sön 15 nov");
    expect(formatDay("2026-11-15", { ...sv, lang: "en" }, { now, year: true })).toBe("15 Nov 2026");
    expect(formatDay("2026-11-15", { ...sv, lang: "en" }, { now, weekday: true })).toBe("Sun, 15 Nov");
    expect(formatDay("2026-11-15", { ...sv, dateStyle: "iso" }, { now, weekday: true })).toBe("sön 2026-11-15");
    expect(formatDay(new Date(2026, 0, 5, 23, 59), { ...sv, dateStyle: "iso" })).toBe("2026-01-05");
    expect(formatMonth("2026-11", sv)).toBe("november 2026");
    expect(formatMonth("2026-11", { ...sv, dateStyle: "iso" })).toBe("2026-11");
  });

  it("on a 24- or a 12-hour clock", () => {
    expect(formatTime("2026-11-15T14:05", sv)).toBe("14:05");
    expect(formatTime("09:30", sv)).toBe("09:30");
    expect(formatTime("14:05", { ...sv, lang: "en", clock: "12" })).toBe("2:05 pm");
    expect(formatTime(new Date(2026, 0, 1, 0, 7), { ...sv, lang: "en", clock: "12" })).toBe("12:07 am");
  });

  it("with weeks from Monday or Sunday", () => {
    expect(weekdayNames(sv)).toEqual(["mån", "tis", "ons", "tors", "fre", "lör", "sön"]);
    expect(weekdayNames({ ...sv, lang: "en", weekStart: "sunday" })[0]).toBe("Sun");
    const sunday = new Date(2026, 10, 15);
    expect(dayOfWeek(sunday, sv)).toBe(6);
    expect(dayOfWeek(sunday, { ...sv, weekStart: "sunday" })).toBe(0);
  });

  it("in a time zone, for the server", () => {
    const at = new Date(Date.UTC(2026, 10, 15, 23, 30));
    expect(clockIn(at, "Europe/Stockholm")).toBe("00:30");
    expect(dayIn(at, "Europe/Stockholm")).toBe("2026-11-16");
    expect(clockIn(at, "America/New_York")).toBe("18:30");
  });
});
