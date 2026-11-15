import { LocalNotifications } from "@capacitor/local-notifications";
import { localDate, occurrences, readCalendar, wallOf, type CalEvent } from "@noterat/core";
import type * as Y from "yjs";
import { isApp } from "./api";

/**
 * Reminders for calendar events (decision 10): local notifications on the phone, scheduled for the
 * coming two weeks, and scheduled again whenever a calendar changes. No server is needed. Only in the app.
 */

const DAYS = 14;
// (the ids this app's reminders use, so the old ones can be taken back before scheduling anew)
const FIRST = 700_000;
let scheduled = 0;

export async function scheduleReminders(calendars: { id: string; doc: Y.Doc }[], wording: (e: CalEvent, start: string) => { title: string; body: string }) {
  if (!isApp) return;
  try {
    if ((await LocalNotifications.checkPermissions()).display !== "granted") {
      if ((await LocalNotifications.requestPermissions()).display !== "granted") return;
    }
    const now = new Date();
    const from = wallOf(now, true);
    const to = wallOf(new Date(now.getTime() + DAYS * 86_400_000), true);
    const due: { id: number; at: Date; title: string; body: string }[] = [];
    for (const c of calendars) {
      const cal = readCalendar(c.doc);
      // (a subscription's reminders are its own calendar app's business)
      if (cal.source) continue;
      for (const o of occurrences(c.id, cal.events, from, to)) {
        for (const min of o.event.reminders) {
          const start = o.event.allDay ? localDate(`${o.start}T09:00`) : localDate(o.start);
          const at = new Date(start.getTime() - min * 60_000);
          if (at > now) due.push({ id: FIRST + due.length, at, ...wording(o.event, o.start) });
        }
      }
    }
    if (scheduled) await LocalNotifications.cancel({ notifications: Array.from({ length: scheduled }, (_, i) => ({ id: FIRST + i })) });
    const list = due.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 60);
    if (list.length) await LocalNotifications.schedule({ notifications: list.map((d) => ({ id: d.id, title: d.title, body: d.body, schedule: { at: d.at, allowWhileIdle: true } })) });
    scheduled = list.length;
  } catch {
    // (no notifications on this phone, or not allowed: the calendar works without them)
  }
}
