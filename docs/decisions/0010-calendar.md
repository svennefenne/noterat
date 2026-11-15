# 10. The calendar: one document per calendar, RRULE repeats in local time, ICS in and out

Date: 2026-11-15 · Status: accepted (phase 6)

## Context

Phase 6 brings the calendar: events with repeats and reminders, several calendars, a family calendar
shared by everyone in it, and the other calendars people already have shown beside their own. The plan
names three steps of integration: the phone's calendars and ICS subscriptions, Noterat's calendars as an
ICS feed, and (later) two-way CalDAV.

## Decision

- **A calendar is a document**, `calendar/<id>`: `meta` (title, colour, and for a subscription its
  `source`) and `events`, a `Y.Map` of events by id. A family calendar is a calendar shared with the
  family; an event in it is live for everyone.
- **An event keeps local wall-clock times** (`2026-11-15T09:00`, or a day for an all-day event), as a
  household in one time zone thinks of them, so 09:00 stays 09:00 across summer time. **Repeats are RFC
  5545 RRULE strings** (`FREQ=WEEKLY;BYDAY=MO,WE`), expanded with the `rrule` library in that same local
  time, with **exceptions** (`exdates`: one occurrence skipped, or moved by making it an event of its own).
  Hooden's own repeat code has no exceptions, and subscribed calendars bring full RRULEs, so one library
  reads both. Reminders are minutes before.
- **Other calendars, three ways**:
  - **ICS subscriptions** (Google's, Outlook's or iCloud's secret address, a sports team's): a calendar
    with a `source`. The server fetches it (only from the internet, as recipes are fetched: decision 9),
    reads it with `ical.js` (time zones, RRULE, EXDATE and moved occurrences turned into local time) and
    writes its events into the document; again every hour, and when asked. They're read-only.
  - **The phone's own calendars** (Google, Exchange… whatever Android shows), read on the phone with
    `@ebarooni/capacitor-calendar` and shown beside Noterat's, never copied anywhere.
  - **Noterat's calendars as an ICS feed** for other calendar apps: `GET /cal/<token>.ics`, a secret
    address per person (as Hooden's feed), with times in `Europe/Stockholm` and its `VTIMEZONE` (Hooden's
    feed gave UTC, which drifts an hour across summer time in some apps). A new address can be made,
    which turns the old one off.
- **Reminders** are local notifications on the phone (`@capacitor/local-notifications`), scheduled for
  the coming two weeks whenever a calendar changes; no server is needed for them.
- **Two-way CalDAV** is left for later.

## Consequences

- Shared calendars, offline editing and live updates come from the same sync as everything else.
- A subscription is as fresh as the last hourly fetch; the phone's calendars are as fresh as the phone.
