# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

One web app, the same in the browser, in the Android app (Capacitor) and in the Linux desktop app
(Electron). Native parts are plugins under the same interface: the scanner, the fingerprint, push.

## Users

A household (a family, a couple) and the people they share with, on the household's own server. The
everyday scenes: the shopping list in the shop, a voice memo on the go, the budget at the kitchen table,
the family calendar.

## Product Purpose

Everything the household writes down, records, plans and pays, in one place they own themselves. It works
offline and syncs live; success is that it's the place they reach for first.

## Positioning

Self-hosted and private by default: nothing is shared until you share it, and what you share is live for
everyone in it. Everything is kept on the phone too, so the app never waits for the server.

## Operating Context

Runs in one Docker container on the household's Unraid server, with an optional GPU worker (speech to
text, OCR, recipe reading). Reached from anywhere through the household's own domain and reverse proxy.
Lists, notes, voice memos, the journal, scanned documents and receipts, recipes, calendars, the budget
(month by month, filled from the bank's CSV export and from receipts), search, push.

## Capabilities and Constraints

- Every thing is a Yjs document, kept in IndexedDB on the device and synced over one WebSocket.
- Amounts are integers in öre.
- The household brings its own services: its own Firebase project for push, its own GPU.
- Swedish first, English too (the app follows the device's language; anyone can switch).

## Product Principles

- The phone never waits for the server.
- Private by default: notifications and mail say that something happened, not what's in it, unless the
  content is the point.
- The household's own accounts and services, never a third party's built in.
- Swedish first, English too.

## Accessibility & Inclusion

No product-specific requirements established yet.
