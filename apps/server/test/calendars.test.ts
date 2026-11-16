import { describe, expect, it } from "vitest";
import { addEvent, initCalendar, newObjectId, objectDocName, readCalendar, type ShareReply } from "@noterat/core";
import { FetchFailed, type Fetched } from "../src/fetch";
import { account, call, device, startServer, synced, until } from "./helpers";

/**
 * Calendars on the server (decision 10): a subscription fetched and written into its document, a
 * family calendar shared live, and each person's private feed for other calendar apps.
 */

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "X-WR-CALNAME:Skolan",
  "BEGIN:VEVENT",
  "UID:lov-1@skolan",
  "DTSTART;VALUE=DATE:20261102",
  "DTEND;VALUE=DATE:20261107",
  "SUMMARY:Höstlov",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:mote-1@skolan",
  "DTSTART:20261110T170000Z",
  "DTEND:20261110T180000Z",
  "SUMMARY:Föräldramöte",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const fakeFetch = async (url: string): Promise<Fetched> => {
  if (url === "https://skolan.example.se/kalender.ics") return { url, type: "text/calendar; charset=utf-8", body: Buffer.from(ICS) };
  throw new FetchFailed("the page answered 404");
};

describe("calendars", () => {
  it("a subscription is fetched into its document, named from the file, and says why when it can't be", async () => {
    const { db, base } = await startServer({ fetchPage: fakeFetch });
    const ada = await account(db, "ada");
    const id = newObjectId();
    const cal = device(base, ada.token)(objectDocName("calendar", id));
    initCalendar(cal.doc, { title: "", source: "webcal://skolan.example.se/kalender.ics", by: ada.user.id });
    await synced(cal.provider);
    expect((await call<{ events: number }>(base, "POST", `/api/objects/${id}/refresh`, ada.token)).json).toEqual({ events: 2 });
    await until(() => readCalendar(cal.doc).events.length === 2, "the events on the device");
    const c = readCalendar(cal.doc);
    expect(c.title).toBe("Skolan");
    expect(c.events.find((e) => e.title === "Höstlov")).toMatchObject({ allDay: true, start: "2026-11-02", end: "2026-11-06" });
    // (17:00 UTC in November is 18:00 in Stockholm)
    expect(c.events.find((e) => e.title === "Föräldramöte")).toMatchObject({ start: "2026-11-10T18:00", end: "2026-11-10T19:00" });

    const bad = newObjectId();
    const other = device(base, ada.token)(objectDocName("calendar", bad));
    initCalendar(other.doc, { title: "Trasig", source: "https://skolan.example.se/finns-inte.ics", by: ada.user.id });
    await synced(other.provider);
    expect((await call(base, "POST", `/api/objects/${bad}/refresh`, ada.token)).status).toBe(422);
    await until(() => readCalendar(other.doc).error !== "", "the error on the device");
  });

  it("a family calendar is shared live, and each person's feed has their calendars but not subscriptions", async () => {
    const { db, base } = await startServer({ fetchPage: fakeFetch });
    const ada = await account(db, "ada");
    const bo = await account(db, "bo");
    const id = newObjectId();
    const fam = device(base, ada.token)(objectDocName("calendar", id));
    initCalendar(fam.doc, { title: "Familjen", by: ada.user.id });
    addEvent(fam.doc, { title: "Middag hos mormor", start: "2026-11-15T17:00", end: "2026-11-15T20:00", allDay: false, rrule: "", exdates: [], location: "Ekhagen", notes: "", reminders: [30] });
    await synced(fam.provider);
    const sub = newObjectId();
    const school = device(base, ada.token)(objectDocName("calendar", sub));
    initCalendar(school.doc, { title: "Skolan", source: "https://skolan.example.se/kalender.ics", by: ada.user.id });
    await synced(school.provider);
    await call(base, "POST", `/api/objects/${sub}/refresh`, ada.token);

    const shared = await call<ShareReply>(base, "POST", `/api/objects/${id}/share`, ada.token, { role: "editor", userId: bo.user.id });
    await call(base, "POST", `/api/invitations/${shared.json.kind === "invitation" ? shared.json.id : ""}/accept`, bo.token);
    const boFam = device(base, bo.token)(objectDocName("calendar", id));
    await until(() => readCalendar(boFam.doc).events.length === 1, "the family calendar on Bo's phone");
    addEvent(boFam.doc, { title: "Simskola", start: "2026-11-16T09:00", end: "2026-11-16T10:00", allDay: false, rrule: "FREQ=WEEKLY", exdates: [], location: "", notes: "", reminders: [] });
    await until(() => readCalendar(fam.doc).events.length === 2, "Bo's event on Ada's phone");

    const { json } = await call<{ url: string }>(base, "GET", "/api/calendar-feed", ada.token);
    const path = new URL(json.url).pathname;
    expect(path).toMatch(/^\/cal\/[\w-]{24}\.ics$/);
    const feed = await fetch(base + path);
    expect(feed.headers.get("content-type")).toContain("text/calendar");
    const text = await feed.text();
    expect(text).toContain("SUMMARY:Middag hos mormor");
    expect(text).toContain("SUMMARY:Simskola");
    expect(text).toContain("DTSTART;TZID=Europe/Stockholm:20261115T170000");
    expect(text).not.toContain("Höstlov");

    // a new address turns the old one off
    await call(base, "POST", "/api/calendar-feed", ada.token);
    expect((await fetch(base + path)).status).toBe(404);
  });
});
