# 7. The journal's entries, searching on the device, and a lock in front of the app

Date: 2026-11-14 · Status: accepted (phase 3)

## Context

Phase 3 brings the journal (entries per day with text, voice clips and photos), search across every
section that works offline, and a lock for the journal (or the whole app) with the fingerprint. The plan
already says every thing is its own document, and that search runs on the device.

## Decision

### The journal

- **Each entry is its own document**, `journal/<id>`, shareable like anything else (a family's journal of
  a trip is a few entries shared with the family): `meta` (title, which may be empty; the day it's about,
  `date`, as `YYYY-MM-DD`; createdBy, createdAt, updatedAt), `body` (a `Y.Text` of Markdown, edited as a
  note is), `photos` (a `Y.Array` of `{ hash, type, size, width, height, at }`) and `clips` (a `Y.Map` of
  voice clips by their file's hash, each a `Y.Map` with the recording and its transcription's state).
- One document per entry rather than one per journal: an entry is written in one day and then mostly
  read, so a year of them doesn't make one document grow without end, and each can be shared or deleted
  on its own. The journal's pages are the entries this person has, by day.
- **Photos** are made smaller on the device before they're kept (at most 2048 px on the longest side,
  JPEG), which also drops what the camera wrote into them (where it was taken). They are files like a
  memo's recording (decision 6), referred to by hash.
- **A voice clip's text goes at the end of the entry**, after a blank line, when the worker has done it.
  The server's jobs work for any thing with recordings in it: core's `transcripts.ts` says, per type, where
  a recording is, whether it wants transcribing, and where its text goes.

### Search

- **Search runs over the documents on the device** (all of them are there and open: decision 5), with a
  full-text index (MiniSearch) built when the search page opens and kept up to date while it's open. No
  server is asked, so it works the same offline. Each type says what of it is searchable (core's
  `search.ts`): a list's title and cells, a note's title, text and tags, a memo's title and text, a journal
  entry's title, day and text.
- Words match from their start ("kött" finds "köttbullar"), allow a typo in longer words, and ignore case
  and accents ("kottbullar" finds "köttbullar" too).

### The lock

- **It's this device's**: off, the journal, or the whole app; unlocked with the fingerprint (or the
  phone's own PIN or pattern, as Android offers it) in the app, or with a PIN set on the device on the web.
  It locks again when the app has been in the background for a while (1, 5 or 15 minutes).
- **It hides; it doesn't encrypt.** The documents stay in the device's storage as before, so the lock
  keeps out someone picking up an unlocked phone, not someone with the phone and developer tools. Search
  leaves out what's locked.

## Consequences

- The journal is shared, synced and kept offline the same way as everything else, with no new machinery
  on the server beyond transcribing clips.
- Search is instant and offline, but only over what this device has: everything this person has, as long
  as it has synced here once.
- Encrypting what's on the device (and on the server) would be a decision of its own, with keys to lose;
  it isn't planned.
