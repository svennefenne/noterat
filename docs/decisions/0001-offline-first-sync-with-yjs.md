# 1. Offline first, with one Yjs document per thing

Date: 2026-11-14 · Status: accepted

## Context

Noterat has to work without a connection and upload what was done once it's back, and things two people
share (a shopping list) have to be live: each sees the other's change at once. Both may change the same
thing while offline.

## Decision

- The app reads and writes a local copy only; syncing runs in the background.
- Every thing (a list, a note, a recipe, a journal entry, a calendar, a budget) is one **Yjs** document
  with an id made on the device. Yjs is a CRDT: changes from any number of devices merge without
  conflicts, in any order.
- The server runs **Hocuspocus** (a Yjs server) over a WebSocket, checks each connection's access to
  each document, and stores the documents in SQLite.
- Files (audio, photos, scans) aren't in the documents: they upload separately through a queue and are
  referred to by their hash.
- A document is also the unit of sharing: sharing a list gives someone access to that document.

## Consequences

- Offline editing and live collaboration come from the same mechanism; there's no separate "conflict" UI.
- The server can't easily check single changes inside a document (they arrive as Yjs updates), so
  access is per document (owner, can edit, can view). Finer rules, like Hooden's "own rows" in lists,
  are kept by the app at first.
- Lists across documents (search, a calendar's month, budget reports) need indexes: the device keeps
  its own, and the server can keep one by reading the documents it stores.
- Documents keep their history; old ones may need compacting now and then.
