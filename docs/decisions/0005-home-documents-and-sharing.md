# 5. Home documents, things made on first sync, and the list's new row

Date: 2026-11-14 · Status: accepted (phase 1)

## Context

With one Yjs document per thing (decision 1), the app also needs to know which things a person has,
including ones shared with them, offline as well as online, and to learn at once when someone shares
something with them. Phase 1's test of two phones changing a shared shopping list offline also showed
that the list's "empty row last", kept in the document as Hooden keeps it on its server, made two
people's new items land in the same row, and one of them was lost.

## Decision

- **A home document per person** (`home/<user id>`), opened only by them and the server:
  - `items`: what they have, by id, with their role on each. The device adds what it makes (offline
    too); the server adds what's shared with them, changes their role when the owner does, and removes
    what they no longer have. The app keeps everything in it open, so it's all on the device.
  - `invitations`: someone on the server wants to share something with them. The server writes it there,
    so it shows at once on every device that's online. Accepting or declining goes through the API.
  This gives the app its index and its in-app notifications with the same sync as everything else,
  and no second channel.
- **A thing is made on the server the first time it's synced**, owned by whoever synced it, so things
  can be made offline. The app only opens things in the home document, so visiting a stray id doesn't
  make one. A deleted thing keeps a row (`deleted_at`), so a device that still has it is told "deleted"
  instead of making it anew.
- **Access changes reach open connections at once**: a new role switches the connection between
  read-only and not; being removed, or the thing being deleted, closes that document on the connection
  with the reason ("forbidden", "deleted"), and the app lets it go from the device.
- **Only the owner shares**: invites people, makes links, changes roles, takes the thing back, deletes it.
  A member can leave. Links work once, for 14 days; invitations for 30.
- **A list's new row is not in the document.** The app shows it last (in "rows as needed" lists), and
  writing in it adds a row with its own id. Two people adding at once, offline or not, get two rows.

## Consequences

- The automated test of the phase-1 goal (two phones offline, a shared list, merging afterwards) runs
  against the real server and passes; so does the same thing by hand in two browsers.
- The role in the home document is what the app goes by offline; the server still decides, per
  connection, from its own records.
- A list with "rows as needed" starts empty; one with a fixed number of rows keeps them in the document,
  so two people filling in the same empty row at once can still collide (the last one wins), as on paper.
