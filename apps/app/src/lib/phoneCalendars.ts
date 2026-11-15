import { CalendarPermissionScope, CapacitorCalendar } from "@ebarooni/capacitor-calendar";
import { wallOf, type CalEvent } from "@noterat/core";
import { isNative } from "./api";

/**
 * The phone's own calendars (Google, Exchange… whatever Android shows), read on the phone and shown
 * beside Noterat's, never copied anywhere (decision 10). Only in the app; asked for the first time.
 */

export interface PhoneCalendar {
  id: string;
  title: string;
  color: string;
}

export const canReadPhone = isNative;

export async function phoneAccess(ask: boolean): Promise<boolean> {
  if (!isNative) return false;
  try {
    const { result } = ask ? await CapacitorCalendar.requestReadOnlyCalendarAccess() : await CapacitorCalendar.checkPermission({ scope: CalendarPermissionScope.READ_CALENDAR });
    return result === "granted";
  } catch {
    return false;
  }
}

export async function phoneCalendars(): Promise<PhoneCalendar[]> {
  const { result } = await CapacitorCalendar.listCalendars();
  return result.map((c) => ({ id: `phone:${c.id}`, title: c.title ?? "", color: c.color ?? "#5b6470" }));
}

/** The phone's events between two days, as Noterat's events (read-only), by their calendar. */
export async function phoneEvents(fromDay: string, toDay: string): Promise<Map<string, CalEvent[]>> {
  const from = new Date(`${fromDay}T00:00`).getTime();
  const to = new Date(`${toDay}T23:59`).getTime();
  const { result } = await CapacitorCalendar.listEventsInRange({ from, to });
  const out = new Map<string, CalEvent[]>();
  for (const e of result) {
    const allDay = e.isAllDay;
    // (an all-day event's end on the phone is the next midnight: its last day is the one before)
    const end = allDay ? new Date(e.endDate - 1) : new Date(e.endDate);
    const ev: CalEvent = {
      id: `${e.id}@${e.startDate}`,
      title: e.title,
      start: wallOf(new Date(e.startDate), allDay),
      end: wallOf(end < new Date(e.startDate) ? new Date(e.startDate) : end, allDay),
      allDay,
      rrule: "",
      exdates: [],
      location: e.location ?? "",
      notes: e.description ?? "",
      reminders: [],
    };
    const key = `phone:${e.calendarId ?? ""}`;
    out.set(key, [...(out.get(key) ?? []), ev]);
  }
  return out;
}
