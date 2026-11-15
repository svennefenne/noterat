# 15. A start page with the latest of each section

Date: 2026-11-15 · Status: accepted

## Context

The app opened on the lists (`/` sent you there). To see what was new or coming you had to go through
the sections one by one.

## Decision

- **`/` is the start page**: a greeting and the day, then a card for each section with its latest things,
  each a link to the thing, the card's head a link to the section. "Latest" is what makes sense for each:
  - Calendar: what's coming in the next two weeks, in the calendars shown.
  - Lists and notes: changed last (lists by their rows' times).
  - Voice memos and documents: recorded and scanned last, a document with its first page and a receipt's
    total.
  - Recipes: added last.
  - Journal: the latest entries, and nothing while the journal is locked.
  - Money: this month in the latest budgets, and the latest cost splits with where you stand.
- **The household's admin sets it up** (Administration → Start page; decision 14): which sections show,
  in what order, and 1, 3 or 5 of each one's latest. The journal and money are off until the admin
  turns them on: they're more private than the rest.
- It reads only what's on the device (every document in someone's home is), so it's there offline too.

## Consequences

- Things are "latest" by when this person got them (created, or shared with them) where a thing keeps no
  time of its own; lists, notes and journal entries go by when they were changed.
- An empty section says so, with the way there.
