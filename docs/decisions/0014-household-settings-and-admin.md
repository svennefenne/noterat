# 14. The household's settings and accounts on one admin page

Date: 2026-11-15 · Status: accepted

## Context

An admin set push and mail in two dialogs in the account menu, and nothing else: accounts came only from
share links, nobody could be renamed, made an admin, given a new password or removed. The look was the
app's own colours, light or dark by the device. The language was chosen per device, dates and times were
written in some 25 places by their own rules (the journal's weeks started on Sunday in English, the
calendar's on Monday), and the server's clock (quiet hours, calendar subscriptions) was the container's
or Stockholm's.

## Decision

- **One admin page**, `/admin` (only for admins; "Administration" in the account menu): Users,
  Appearance, Language/time/date, Money, Push, Mail and Apps. On a wide screen the sections are a list
  beside the open one; on a phone the list is the page and a section opens on its own.
- **The household's settings** are one record, `Household` in `@noterat/core` (`cleanHousehold` takes a
  part of one and keeps what's missing or wrong as it was), kept in the settings table under
  `household`. Anyone may read them (`GET /api/household`, without a session: the log-in page takes its
  look and language from them too; nothing in them is private); an admin changes them (`PUT
  /api/admin/household`), and every connected app is told (a stateless `noterat:household` on its home
  document) and asks again. The app keeps them on the device, so they apply at once and offline.
- **Users**: the list shows when each was last seen and on how many devices. An admin adds an account (a
  readable suggested password to pass on), renames, makes an admin or a member, sets a new password (every
  device of theirs is logged out: their sessions go and their connections are closed with
  "unauthorized"), logs someone out everywhere, or removes them. Removing hands each shared thing to whoever
  has had it longest (an editor before a viewer) and deletes the rest; the confirmation says how many of
  each. There's always an admin left, and nobody removes themselves.
- **Appearance**: Noterat's own colours (the default, as they were) and all of Hooden's 98 colour schemes,
  each with a light and a dark set, with auto following the device. A scheme's nine colours become the
  app's colour variables with Hooden's colour maths (`lookTokens`, `lookCss`). The admin sets the
  household's; anyone can pick their own on their device (Appearance… in the account menu). The look is
  kept on the device and put on in `index.html` before the app loads, so there's no flash.
- **Language, time and date**: the language new devices start in (anyone can still switch), dates with
  the month's name ("15 nov 2026") or as ISO ("2026-11-15"), a 24- or 12-hour clock, weeks from Monday or
  Sunday (the calendar and the journal alike), and the household's time zone, which the server goes by:
  quiet hours, calendar subscriptions (read and written in it), and dates in what it mails. Every screen
  writes days and times through one place (`useDates`, over core's `formatDay`, `formatTime`…).
- **Money**: Swish on or off. Off, cost splits have no Swish numbers, flags, QR codes or links; what's
  sent out just says who pays whom (numbers already given stay).
- **Push and Mail**: the Firebase and SMTP settings, moved from their dialogs; each person's own
  notification choices stay in the account menu.
- **Apps**: which build the server is and which builds of the apps it offers (decision 16).

## Consequences

- A role change counts at once on the server; the person's app is told and asks who it is again.
- Removing someone can't be undone, and what they had alone goes with them.
- Days and times on a device are written in the device's own time; the household's time zone is what the
  server goes by.
