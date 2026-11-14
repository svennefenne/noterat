# Noterat: the plan

Noterat is a shared notes, journal, voice memo, lists, finances, calendar, recipes and receipt and
document scanning app. It runs on its own server at home (a Docker container on Unraid), and its apps
keep a copy of everything on the device, so they work offline and catch up when they're back online.
Nothing is shared until someone chooses to share it; what's shared is live for everyone in it.

The decisions behind this plan are in [decisions/](decisions/).

## How it fits together

```
Phone / browser / desktop (one React app)
  UI ──▶ local copy (IndexedDB: one Yjs document per thing + a queue of files to upload)   ← works offline
              │
              │  WebSocket (live sync)  +  HTTPS (API, file uploads)
              ▼
Unraid (Docker)
  noterat         Node: accounts, sharing, invitations, notifications, Yjs sync (Hocuspocus),
                  the app's web build; SQLite + files in /mnt/user/appdata/noterat
  noterat-worker  Python (optional, on the GPU): speech to text, OCR, recipe import, PDF   (phase 2)
```

**The app never waits for the server to show something.** It reads and writes its local copy; syncing
runs in the background. Offline isn't a special case, it's the normal one, and a connection only
brings things up to date.

| Part | Choice | Why |
|---|---|---|
| App | React + TypeScript (Vite), Tiptap for writing | One app for web, Android and desktop; Tiptap is already used in Hooden and has Yjs collaboration built in |
| Android | Capacitor: the built app inside an Android app | Opens offline (unlike a web view of the server), with native plugins for the scanner and push |
| Desktop | Electron shell, as in Hooden | Linux desktop app with tray and notifications |
| Sync | Yjs (CRDT) | Changes from several devices merge by themselves, also after being offline |
| Sync server | Hocuspocus | A Yjs server with per-document access checks and storage hooks |
| Server | Node + Hono, SQLite (better-sqlite3) | One container, one folder to back up, the same language as the app |
| Files | A volume on Unraid, uploads queued and resumable | Audio, photos and scans upload in the background |
| Worker | faster-whisper with KB-Whisper, OCRmyPDF/Tesseract, recipe-scrapers | KB-Whisper is the National Library of Sweden's Swedish-trained Whisper; the RTX 3070 Ti (8 GB) runs the large model |
| Distribution | GitHub Actions: image on ghcr.io, APK as a GitHub release | Unraid updates from its UI; the phone installs the APK (Obtainium can keep it updated) |

## Sync and offline

- **Every thing is its own document**: a list, a note, a recipe, a journal entry, a calendar, a budget.
  Its id is made on the device, so things can be made offline.
- The device keeps all of its documents locally. On connecting, device and server exchange only what the
  other lacks, both ways.
- **Conflicts resolve themselves.** One person ticks off milk while the other adds eggs without
  coverage: both changes stay. Text edited by both at once merges character by character.
- **Live**: everyone with the thing open gets each change over the WebSocket at once.
- Files sync separately and are referred to by hash, so a document can point at a photo that hasn't
  finished uploading.
- Search runs on the device (a local index), so it works offline.

## Sharing

- Everything is private by default. Each thing has members with a role: owner, can edit, can view.
- **By link**: "Share" makes a one-time link, `https://noterat.<domain>/i/<token>`. Its page says
  "Sam wants to share *Shopping list* with you – Accept". With the app installed it opens in the app
  (Android App Links), else in the web app. Someone without an account makes one on this server (the
  link is their invitation; there's no open sign-up).
- **On the same server**: pick a person in the app; the invitation shows at once under the bell (it's
  written into their home document: decision 5), and as a push when the app is closed (phase 8).
- Accepting makes them a member: the thing syncs down and changes flow live. A share can be taken back,
  left, or its role changed. Sharing a whole collection ("Household recipes") is an option, as a choice.
- Sharing between different Noterat servers (federation) is not planned.

## The sections

Phase 1 builds a common frame first: sync, sharing, search, tags, a bin, attachments. Each section is
then mostly a document type and its screens.

- **Lists**, as in Hooden: tables of your own making. Columns each hold one kind of thing (text, number,
  checkbox, person, date, time, choice; up to 12); templates (sign-up sheet, shopping list, checklist,
  schedule, empty); a fixed number of rows, or automatic rows (an empty row always last); who fills it in
  (everyone it's shared with, or only its owner), whether others may add rows, and whether a filled-in
  row is its filler's ("own rows"). Tab moves from cell to cell like a spreadsheet; a row with all its
  boxes ticked is struck through; wide tables scroll sideways with frozen columns. Notifications: a row
  filled in, your row changed, the list changed. Differences from Hooden:
  - "Everyone / a group / only me" becomes Noterat's sharing; a person column picks among the list's members.
  - Each cell is its own field in the list's Yjs document: different cells filled in offline both stay;
    the same cell, the last change wins.
  - The new row last isn't in the document: writing in it adds a row of its own, so two people adding
    at once both keep what they added (decision 5).
  - "Own rows" is enforced by the app at first (other people's rows are locked); the server checks
    roles per document. Checking each change per row on the server can come later.
  - No comments or reactions at first.
  - A compact phone view for lists that start with a checkbox (shopping, checklists): one tap ticks,
    ticked rows sink.
- **Notes**: Markdown, editing and preview, tags, folders, pinned notes; edited together live.
- **Journal**: entries per day with text, voice clips and photos; a timeline and a calendar view;
  voice clips can be transcribed; the journal can be locked with the fingerprint.
- **Voice memos**: one tap to record; transcription is a job for the worker (queued while offline);
  "Move to…" turns a memo into a note, a journal entry, list rows (one per line) or a calendar event.
- **Finances**: a monthly budget with categories (envelope or zero-based), transactions, recurring
  items, savings goals, reports, CSV import from the bank, a shared household budget. Amounts are
  integers in öre. Receipts from the scanner can become transactions.
- **Calendar**: events with repeats, reminders, several calendars, shared calendars. Integration in
  three steps: show the phone's calendars and subscribe to ICS links; publish Noterat's calendars as an
  ICS feed (Hooden has the repeat rules, `.ics` files and private feed to start from); two-way CalDAV.
- **Recipes**: import from a URL (the page's schema.org/Recipe data, with recipe-scrapers as a
  fallback), your own recipes, photos from the camera, gallery or the page (cropped and compressed),
  scaled servings, "Add the ingredients to the shopping list", shared live or exported as a PDF.
- **Scanner**: ML Kit's document scanner on Android finds the edges, suggests a crop to accept or
  adjust, and straightens the page. OCR on the phone gives text at once; the worker makes a searchable
  PDF. From a receipt: shop, date and total, suggested as a transaction.

## Phases

| Phase | What | Done when |
|---|---|---|
| 0 | Monorepo, CI, Docker image, Unraid template, Android shell, accounts and log-in, this plan | `docker compose up` starts a server the app can log in to ✅ |
| 1 | Sync core (Yjs + Hocuspocus + local copy), the common frame, **Lists**, sharing by link and in-app notification, running on Unraid | A shared shopping list works in flight mode on both phones and merges right afterwards ✅ in tests and in two browsers; on the phones and Unraid next |
| 2 | Notes, voice memos, the worker (speech to text on the GPU) | A recorded memo becomes text that can be moved to a note |
| 3 | Journal, search across everything, app lock | Search finds text in every section, offline too |
| 4 | Scanner and OCR | A photographed receipt is cropped by itself and becomes searchable text |
| 5 | Recipes | A recipe imported from a URL puts its ingredients on the shopping list and exports as a PDF |
| 6 | Calendar | Other calendars show beside your own; a shared family calendar |
| 7 | Finances | A monthly budget with CSV import and receipts linked to transactions |
| 8 | Push notifications, desktop app, widgets, polish | Notifications arrive with the app closed; the Linux desktop app works offline like the phone |

Lists come first because they're the smallest section that still tests the hardest requirement:
offline, live and shared at once. If the architecture holds there, it holds everywhere.

## Worth knowing

- **Sync is the main risk.** Phase 1 starts with automated tests: two simulated devices change
  different things offline, reconnect, and are compared.
- **Exposed to the internet** (a domain and a reverse proxy), the server holds journals and finances:
  log-in throttling, HTTPS only, and backups of the appdata folder.
- **Push** goes through Firebase Cloud Messaging, with the Firebase settings handed to the app by the
  server (as Hooden does), and only "you have a new invitation" in it, nothing private.
- **iOS** is left out for now (both phones are Android); Capacitor keeps the door open.

## What can come from Hooden

- The Dockerfile, entrypoint, Unraid template and GitHub workflows (done in phase 0).
- Push through FCM with the Firebase settings handed out by the server, and APK updates from the server.
- The Electron shell (tray, notifications, autostart).
- The calendar's repeat rules, `.ics` files and private calendar feed.
- Notification settings per kind with quiet hours, and Swedish/English translations.
- The lists' column types, cell checks, templates and table component (the server logic is rewritten
  for Yjs).
