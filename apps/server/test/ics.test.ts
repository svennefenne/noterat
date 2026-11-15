import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { occurrences, type CalEvent } from "@noterat/core";
import { readIcs, writeIcs } from "../src/ics";

/**
 * ICS files in and out (decision 10): subscriptions as Google and Outlook write them, read into local
 * wall-clock time in Stockholm (so core's occurrences() expands them right across summer time), and
 * Noterat's own calendars written as a feed that reads back the same.
 */

const NOW = new Date("2026-11-15T12:00:00Z");
const ics = (...lines: string[]) => `${lines.join("\r\n")}\r\n`;

const STOCKHOLM_TZ = [
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

const GOOGLE = ics(
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Familjen",
  "X-WR-TIMEZONE:Europe/Stockholm",
  ...STOCKHOLM_TZ,
  // a weekly repeat over the start of summer time (29 March), its last occurrence 27 April 17:00 = 15:00Z
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Stockholm:20260309T170000",
  "DTEND;TZID=Europe/Stockholm:20260309T180000",
  "RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20260427T150000Z;BYDAY=MO",
  "EXDATE;TZID=Europe/Stockholm:20260406T170000",
  "DTSTAMP:20261101T120000Z",
  "UID:simskola123@google.com",
  "SUMMARY:Simskola",
  "LOCATION:Eriksdalsbadet\\, Stockholm",
  "DESCRIPTION:Ta med handduk.\\nOch badmössa.",
  "STATUS:CONFIRMED",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:This is an event reminder",
  "TRIGGER:-P0DT0H30M0S",
  "END:VALARM",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:At a fixed time",
  "TRIGGER;VALUE=DATE-TIME:20260309T080000Z",
  "END:VALARM",
  "END:VEVENT",
  // one occurrence moved an hour later
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Stockholm:20260420T180000",
  "DTEND;TZID=Europe/Stockholm:20260420T190000",
  "DTSTAMP:20261101T120000Z",
  "UID:simskola123@google.com",
  "RECURRENCE-ID;TZID=Europe/Stockholm:20260420T170000",
  "SUMMARY:Simskola (flyttad)",
  "END:VEVENT",
  // and one cancelled
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Stockholm:20260413T170000",
  "DTEND;TZID=Europe/Stockholm:20260413T180000",
  "DTSTAMP:20261101T120000Z",
  "UID:simskola123@google.com",
  "RECURRENCE-ID;TZID=Europe/Stockholm:20260413T170000",
  "STATUS:CANCELLED",
  "SUMMARY:Simskola",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Stockholm:20260510T100000",
  "DTEND;TZID=Europe/Stockholm:20260510T110000",
  "DTSTAMP:20261101T120000Z",
  "UID:inställt@google.com",
  "STATUS:CANCELLED",
  "SUMMARY:Inställt kalas",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260214",
  "DTEND;VALUE=DATE:20260222",
  "DTSTAMP:20261101T120000Z",
  "UID:fjallen@google.com",
  "SUMMARY:Fjällen",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20260715T080000Z",
  "DTEND:20260715T090000Z",
  "DTSTAMP:20261101T120000Z",
  "UID:tandlakare-sommar@google.com",
  "SUMMARY:Tandläkare",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART:20260115T080000Z",
  "DURATION:PT45M",
  "DTSTAMP:20261101T120000Z",
  "UID:tandlakare-vinter@google.com",
  "SUMMARY:Tandläkare",
  "END:VEVENT",
  // long ago: left out
  "BEGIN:VEVENT",
  "DTSTART:20200115T080000Z",
  "DTEND:20200115T090000Z",
  "UID:gammalt@google.com",
  "SUMMARY:Gammalt",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Stockholm:20200106T170000",
  "DTEND;TZID=Europe/Stockholm:20200106T180000",
  "RRULE:FREQ=WEEKLY;UNTIL=20210104T160000Z",
  "UID:gammal-serie@google.com",
  "SUMMARY:Gammal serie",
  "END:VEVENT",
  // the same UID twice (no RECURRENCE-ID): two events all the same
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261224",
  "UID:dubbel@google.com",
  "SUMMARY:Julafton",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261231",
  "UID:dubbel@google.com",
  "SUMMARY:Nyårsafton",
  "END:VEVENT",
  "END:VCALENDAR",
);

const OUTLOOK_UID = "040000008200E00074C5B7101A82E0080000000080D2B4F5C1E3DA01000000000000000010000000A1B2C3D4E5F60718293A4B5C6D7E8F90";

const OUTLOOK = ics(
  "BEGIN:VCALENDAR",
  "METHOD:PUBLISH",
  "PRODID:Microsoft Exchange Server 2010",
  "VERSION:2.0",
  "X-WR-CALNAME:Kalender",
  "BEGIN:VTIMEZONE",
  "TZID:W. Europe Standard Time",
  "BEGIN:STANDARD",
  "DTSTART:16010101T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "DESCRIPTION:\\n",
  "RRULE:FREQ=WEEKLY;UNTIL=20261201T070000Z;INTERVAL=1;BYDAY=TU;WKST=MO",
  "EXDATE;TZID=W. Europe Standard Time:20261110T080000",
  `UID:${OUTLOOK_UID}`,
  "SUMMARY:Veckomöte",
  "DTSTART;TZID=W. Europe Standard Time:20261020T080000",
  "DTEND;TZID=W. Europe Standard Time:20261020T090000",
  "CLASS:PUBLIC",
  "PRIORITY:5",
  "DTSTAMP:20261112T093000Z",
  "TRANSP:OPAQUE",
  "STATUS:CONFIRMED",
  "SEQUENCE:0",
  "LOCATION:Rum 3",
  "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
  "BEGIN:VALARM",
  "DESCRIPTION:REMINDER",
  "TRIGGER;RELATED=START:-PT15M",
  "ACTION:DISPLAY",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
);

const byTitle = (events: CalEvent[], title: string) => events.filter((e) => e.title === title);
const noId = ({ id: _id, ...e }: CalEvent) => e;

describe("reading a subscription", () => {
  it("reads Google's file into Stockholm's wall-clock time", () => {
    const { name, events } = readIcs(GOOGLE, { now: NOW });
    expect(name).toBe("Familjen");
    expect(events.map((e) => e.title).sort()).toEqual(["Fjällen", "Julafton", "Nyårsafton", "Simskola", "Simskola (flyttad)", "Tandläkare", "Tandläkare"]);

    const [swim] = byTitle(events, "Simskola");
    expect(swim).toMatchObject({
      id: "simskola123@google.com",
      start: "2026-03-09T17:00",
      end: "2026-03-09T18:00",
      allDay: false,
      // (UNTIL in local time, the rest as it was)
      rrule: "FREQ=WEEKLY;WKST=MO;UNTIL=20260427T170000;BYDAY=MO",
      location: "Eriksdalsbadet, Stockholm",
      notes: "Ta med handduk.\nOch badmössa.",
      // (the alarm at a fixed time is left out)
      reminders: [30],
    });
    // the skipped one, the cancelled one and the moved one
    expect(swim!.exdates.sort()).toEqual(["2026-04-06T17:00", "2026-04-13T17:00", "2026-04-20T17:00"]);
    expect(byTitle(events, "Simskola (flyttad)")[0]).toMatchObject({ id: "simskola123@google.com-2026-04-20T17-00", start: "2026-04-20T18:00", end: "2026-04-20T19:00", rrule: "" });

    // UTC in summer and in winter, and DURATION for the end
    expect(byTitle(events, "Tandläkare").map((e) => [e.start, e.end])).toEqual([
      ["2026-07-15T10:00", "2026-07-15T11:00"],
      ["2026-01-15T09:00", "2026-01-15T09:45"],
    ]);
    // all day: DTEND is the day after, ours the last day; no DTEND is one day
    expect(byTitle(events, "Fjällen")[0]).toMatchObject({ allDay: true, start: "2026-02-14", end: "2026-02-21" });
    expect(byTitle(events, "Julafton")[0]).toMatchObject({ allDay: true, start: "2026-12-24", end: "2026-12-24" });

    // the same UID twice: two ids
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("dubbel@google.com");
    expect(ids).toContain("dubbel@google.com-2");
  });

  it("gives core the right occurrences across summer time", () => {
    const { events } = readIcs(GOOGLE, { now: NOW });
    const occ = occurrences("g", events, "2026-03-01", "2026-05-31");
    expect(occ.map((o) => `${o.start} ${o.event.title}`)).toEqual([
      "2026-03-09T17:00 Simskola",
      "2026-03-16T17:00 Simskola",
      "2026-03-23T17:00 Simskola",
      "2026-03-30T17:00 Simskola",
      "2026-04-20T18:00 Simskola (flyttad)",
      "2026-04-27T17:00 Simskola",
    ]);
    expect(occ[3]!.end).toBe("2026-03-30T18:00");
  });

  it("reads Outlook's file with its Windows time zone", () => {
    const { name, events } = readIcs(OUTLOOK, { now: NOW });
    expect(name).toBe("Kalender");
    expect(events).toHaveLength(1);
    const [e] = events;
    expect(e!.id).toMatch(/^[A-Za-z0-9._@-]{1,120}$/);
    expect(noId(e!)).toEqual({
      title: "Veckomöte",
      start: "2026-10-20T08:00",
      end: "2026-10-20T09:00",
      allDay: false,
      rrule: "FREQ=WEEKLY;UNTIL=20261201T080000;INTERVAL=1;BYDAY=TU;WKST=MO",
      exdates: ["2026-11-10T08:00"],
      location: "Rum 3",
      notes: "",
      reminders: [15],
    });
    // (summer time ends 25 October: still 08:00, and the last one, 07:00Z on 1 December, is in)
    expect(occurrences("o", events, "2026-10-01", "2026-12-31").map((o) => o.start)).toEqual([
      "2026-10-20T08:00",
      "2026-10-27T08:00",
      "2026-11-03T08:00",
      "2026-11-17T08:00",
      "2026-11-24T08:00",
      "2026-12-01T08:00",
    ]);
  });

  it("lines a repeat kept in another zone up with its exceptions", () => {
    const file = ics(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      // in UTC: 10:00 here in summer, repeated at 10:00 by core, so its exceptions are 10:00 too
      "BEGIN:VEVENT",
      "UID:utc-serie",
      "DTSTART:20260930T080000Z",
      "DTEND:20260930T090000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20261104T080000Z",
      "EXDATE:20261028T080000Z",
      "SUMMARY:Möte i UTC",
      "END:VEVENT",
      // Monday evening in New York (no VTIMEZONE: the zone is known by name) is Tuesday night here
      "BEGIN:VEVENT",
      "UID:new-york",
      "DTSTART;TZID=America/New_York:20261005T190000",
      "DTEND;TZID=America/New_York:20261005T200000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3",
      "SUMMARY:Samtal med New York",
      "END:VEVENT",
      // floating: as it stands
      "BEGIN:VEVENT",
      "UID:flytande",
      "DTSTART:20261201T073000",
      "SUMMARY:Lucia",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    const { events } = readIcs(file, { now: NOW });
    expect(events.map((e) => [e.title, e.start, e.end, e.rrule, e.exdates])).toEqual([
      ["Möte i UTC", "2026-09-30T10:00", "2026-09-30T11:00", "FREQ=WEEKLY;UNTIL=20261104T100000", ["2026-10-28T10:00"]],
      ["Samtal med New York", "2026-10-06T01:00", "2026-10-06T02:00", "FREQ=WEEKLY;BYDAY=TU;COUNT=3", []],
      ["Lucia", "2026-12-01T07:30", "2026-12-01T07:30", "", []],
    ]);
    expect(occurrences("x", events, "2026-09-01", "2026-11-30").map((o) => `${o.start} ${o.event.title}`)).toEqual([
      "2026-09-30T10:00 Möte i UTC",
      "2026-10-06T01:00 Samtal med New York",
      "2026-10-07T10:00 Möte i UTC",
      "2026-10-13T01:00 Samtal med New York",
      "2026-10-14T10:00 Möte i UTC",
      "2026-10-20T01:00 Samtal med New York",
      "2026-10-21T10:00 Möte i UTC",
      "2026-11-04T10:00 Möte i UTC",
    ]);
  });

  it("keeps a big file bounded", () => {
    const many = Array.from({ length: 5003 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString().replace(/[-:]/g, "").slice(0, 15);
      return ["BEGIN:VEVENT", `UID:e${i}`, `DTSTART:${day}Z`, "SUMMARY:x", "END:VEVENT"];
    });
    expect(readIcs(ics("BEGIN:VCALENDAR", "VERSION:2.0", ...many.flat(), "END:VCALENDAR"), { now: NOW }).events).toHaveLength(5000);
  });

  it("says plainly when the text isn't a calendar", () => {
    for (const bad of ["", "hello", "<!doctype html><html><body>Not found</body></html>", '{"events":[]}', "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ada\r\nEND:VCARD\r\n"]) {
      expect(() => readIcs(bad), JSON.stringify(bad)).toThrow("that isn't a calendar file");
    }
    expect(readIcs(ics("BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR"))).toEqual({ name: "", events: [] });
  });
});

describe("writing a feed", () => {
  const ev = (o: Partial<CalEvent> & Pick<CalEvent, "id" | "title" | "start" | "end">): CalEvent => ({ allDay: false, rrule: "", exdates: [], location: "", notes: "", reminders: [], ...o });
  const mine: CalEvent[] = [
    ev({
      id: "a",
      title: "Simskola; Ella, Olle",
      start: "2026-03-23T17:00",
      end: "2026-03-23T18:00",
      rrule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221T235959",
      exdates: ["2026-04-06T17:00", "2026-11-02T17:00"],
      location: "Eriksdalsbadet",
      notes: "Ta med:\n- handduk\n- badmössa \\ simglasögon",
      reminders: [15, 60],
    }),
    ev({ id: "b", title: "Fjällen", start: "2026-02-14", end: "2026-02-21", allDay: true }),
    ev({ id: "c", title: "Hyra", start: "2026-01-28", end: "2026-01-28", allDay: true, rrule: "FREQ=MONTHLY;UNTIL=20271228", exdates: ["2026-07-28"], reminders: [1440] }),
    ev({
      id: "d",
      title: "Midsommar på Ängsö med släkt och vänner från när och fjärran, årets längsta ljusa natt",
      start: "2026-06-19T15:00",
      end: "2026-06-20T02:00",
      location: "Ängsö",
      notes: "Åäö ".repeat(40).trim(),
      reminders: [0],
    }),
  ];
  const feed = writeIcs([{ id: "fam", title: "Familjen, hemma", events: mine }], { name: "Noterat", now: NOW });
  const unfolded = feed.replace(/\r\n /g, "");

  it("reads back as the same events", () => {
    const back = readIcs(feed, { now: NOW });
    expect(back.name).toBe("Noterat");
    expect(back.events.map(noId)).toEqual(mine.map(noId));
    expect(back.events.map((e) => e.id)).toEqual(["fam.a@noterat", "fam.b@noterat", "fam.c@noterat", "fam.d@noterat"]);
  });

  it("writes Stockholm's time with its VTIMEZONE, UNTIL in UTC, all-day ends the day after", () => {
    for (const l of [
      "X-WR-TIMEZONE:Europe/Stockholm",
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Stockholm",
      "UID:fam.a@noterat",
      "DTSTAMP:20261115T120000Z",
      "DTSTART;TZID=Europe/Stockholm:20260323T170000",
      "DTEND;TZID=Europe/Stockholm:20260323T180000",
      // (23:59:59 on 21 December here is 22:59:59 UTC)
      "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221T225959Z",
      "EXDATE;TZID=Europe/Stockholm:20260406T170000",
      "SUMMARY:Simskola\\; Ella\\, Olle",
      "DESCRIPTION:Ta med:\\n- handduk\\n- badmössa \\\\ simglasögon",
      "CATEGORIES:Familjen\\, hemma",
      "TRIGGER:-PT15M",
      "DTSTART;VALUE=DATE:20260214",
      "DTEND;VALUE=DATE:20260222",
      "RRULE:FREQ=MONTHLY;UNTIL=20271228",
      "EXDATE;VALUE=DATE:20260728",
    ])
      expect(unfolded.split("\r\n"), l).toContain(l);
    expect(feed.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Noterat//Calendar//SV\r\n")).toBe(true);

    // (its VTIMEZONE, read by ical.js on its own, puts summer and winter times at the right instants)
    const cal = new ICAL.Component(ICAL.parse(feed));
    const starts = cal.getAllSubcomponents("vevent").map((v) => (v.getFirstPropertyValue("dtstart") as ICAL.Time).toUnixTime() * 1000);
    expect(new Date(starts[0]!).toISOString()).toBe("2026-03-23T16:00:00.000Z");
    expect(new Date(starts[3]!).toISOString()).toBe("2026-06-19T13:00:00.000Z");
  });

  it("folds long lines at 75 octets without splitting a character, with CRLF", () => {
    const lines = feed.split("\r\n");
    expect(feed.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(feed.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(lines.some((l) => l.startsWith(" "))).toBe(true);
    for (const l of lines) {
      expect(Buffer.byteLength(l), l).toBeLessThanOrEqual(75);
      // (half a character would come back from UTF-8 as U+FFFD)
      expect(Buffer.from(l, "utf8").toString("utf8")).toBe(l);
    }
    expect(unfolded).toContain(`SUMMARY:${mine[3]!.title.replace(/,/g, "\\,")}`);
  });

  it("writes another zone in UTC, its repeats' exceptions matching", () => {
    const london = writeIcs([{ id: "fam", title: "Familjen", events: mine.slice(0, 2) }], { name: "Noterat", tz: "Europe/London", now: NOW });
    const lines = london.replace(/\r\n /g, "").split("\r\n");
    expect(lines).not.toContain("BEGIN:VTIMEZONE");
    expect(lines).toContain("DTSTART:20260323T170000Z");
    // (the first one is in winter time, so 17:00 every week is 17:00 UTC; 23:59:59 too)
    expect(lines).toContain("EXDATE:20260406T170000Z");
    expect(lines).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221T235959Z");
    expect(readIcs(london, { tz: "Europe/London", now: NOW }).events.map(noId)).toEqual(mine.slice(0, 2).map(noId));
  });
});
