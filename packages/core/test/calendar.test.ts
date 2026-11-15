import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addEvent, initCalendar, occurrences, readCalendar, readRepeat, replaceEvents, searchable, skipOccurrence, writeRepeat, type EventInput } from "../src";

const ev = (o: Partial<EventInput>): EventInput => ({ title: "x", start: "2026-03-23T09:00", end: "2026-03-23T10:00", allDay: false, rrule: "", exdates: [], location: "", notes: "", reminders: [], ...o });

describe("a calendar's events", () => {
  it("repeat weekly at the same wall-clock time across summer time, skipped ones left out", () => {
    const doc = new Y.Doc();
    initCalendar(doc, { title: "Familjen", by: 1 });
    const id = addEvent(doc, ev({ title: "Simskola", rrule: writeRepeat({ freq: "weekly", interval: 1, days: [0], until: "" }) }));
    skipOccurrence(doc, id, "2026-04-06T09:00");
    const occ = occurrences("c", readCalendar(doc).events, "2026-03-20", "2026-04-15");
    // (summer time starts 29 March: still 09:00)
    expect(occ.map((o) => o.start)).toEqual(["2026-03-23T09:00", "2026-03-30T09:00", "2026-04-13T09:00"]);
    expect(occ[0]!.end).toBe("2026-03-23T10:00");
  });

  it("show an all-day event on every day it lasts, and a monthly one on its day", () => {
    const events = [
      { id: "a", ...ev({ title: "Fjällen", allDay: true, start: "2026-02-14", end: "2026-02-21" }) },
      { id: "b", ...ev({ title: "Hyra", allDay: true, start: "2026-01-28", end: "2026-01-28", rrule: "FREQ=MONTHLY" }) },
    ];
    expect(occurrences("c", events, "2026-02-20", "2026-02-28").map((o) => `${o.event.title} ${o.start}`)).toEqual(["Fjällen 2026-02-14", "Hyra 2026-02-28"]);
    expect(occurrences("c", events, "2026-02-22", "2026-02-27")).toEqual([]);
  });

  it("repeats go to and from what the editor shows", () => {
    expect(writeRepeat({ freq: "weekly", interval: 2, days: [2, 0], until: "2026-06-30" })).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20260630T235959");
    expect(readRepeat("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20260630T235959")).toEqual({ freq: "weekly", interval: 2, days: [0, 2], until: "2026-06-30", custom: false });
    expect(readRepeat("FREQ=MONTHLY;BYDAY=-1FR").custom).toBe(true);
    expect(writeRepeat({ freq: "none", interval: 1, days: [], until: "" })).toBe("");
  });

  it("from a subscription are replaced as a whole, and searchable", () => {
    const doc = new Y.Doc();
    initCalendar(doc, { title: "Allsvenskan", source: "https://example.se/a.ics", by: 1 });
    replaceEvents(doc, [{ id: "m1", ...ev({ title: "Hammarby – AIK" }) }], { refreshedAt: 5 });
    replaceEvents(doc, [{ id: "m2", ...ev({ title: "Djurgården – Hammarby", start: "2026-04-01T19:00", end: "2026-04-01T21:00" }) }], { refreshedAt: 6 });
    const c = readCalendar(doc);
    expect(c.events.map((e) => e.title)).toEqual(["Djurgården – Hammarby"]);
    expect(c).toMatchObject({ source: "https://example.se/a.ics", refreshedAt: 6 });
    expect(searchable("calendar", "c", doc).text).toContain("2026-04-01 · Djurgården");
  });
});
