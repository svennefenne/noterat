# 6. Notes as Markdown text, files by hash, and a worker that asks for jobs

Date: 2026-11-14 · Status: accepted (phase 2)

## Context

Phase 2 brings notes, voice memos and speech to text. A note is Markdown, edited together live and
offline. A voice memo is a recording, made offline as often as not, that has to reach the server and be
turned into text by KB-Whisper on the server's GPU, and that text should be easy to move on to a note or
a list. The plan (decision 1) already says files sync apart from the documents and are referred to by
hash, and that the speech to text runs in a separate, optional container (`noterat-worker`).

## Decision

### Notes

- **A note's text is Markdown, kept as it's written**: a `Y.Text` ("body") in the note's document, next
  to `meta` (title, createdBy, createdAt) and `tags` (a `Y.Array` of strings, the same for everyone the
  note is shared with). The app edits it with **CodeMirror 6** bound to the `Y.Text`
  (`y-codemirror.next`): characters merge as people type, others' cursors show, and Markdown is
  highlighted as it's written (headings larger, bold bold), with a toolbar for the phone and a preview
  (marked, cleaned by DOMPurify).
- Not Tiptap, which the plan first named: a rich-text editor keeps a tree, and every way out of it
  (search, Markdown export, moving a memo's text in, the server reading a title) would need converting.
  Kept as Markdown, all of those are plain text. CodeMirror 6 is also what Obsidian runs on, phones
  included.
- **What's only one person's way of keeping things** (pinned, which folder) is theirs, in their home
  document's `prefs` map (id → `{ pinned?, folder? }`), apart from `items`, which the server writes.
  Tags belong to the note.

### Files

- A file (a recording; later photos and scans) is named by the **SHA-256 of its bytes**. A document
  refers to it by that hash, so a memo can point at a recording that hasn't finished uploading.
- The device keeps the file in IndexedDB and uploads it when online, **in 1 MB pieces**, so an upload
  that's cut off goes on where it stopped:
  - `GET /api/files/:hash/status` → `{ size, received, complete }` (404 if the server has none of it)
  - `PUT /api/files/:hash?object=<id>&offset=<n>&size=<total>&type=<mime>` with a piece as the body →
    `{ received, complete }`. Only by an owner or editor of that thing; `not_synced` (404) until the
    thing has reached the server; `upload_offset` (409, with `received`) if the piece doesn't start
    where the server's copy ends. When the last piece is in, the server checks the hash and keeps it.
  - `GET /api/files/:hash`: for anyone who has a thing that refers to it (the reference is made by the
    upload, per thing).
- On the server: `DATA_DIR/files/ab/abcdef…` (pieces wait in `DATA_DIR/uploads/`), and the tables
  `files` and `file_refs` (migration 3).

### Voice memos

- A memo's document: `meta` (title, createdBy, createdAt), `audio` (`{ hash, type, size, duration }`),
  `text` (a `Y.Text`: the transcript, which people can correct) and `transcription`
  (`{ status, progress?, language?, model?, error?, at }`, status `wanted` → `queued` → `working` →
  `done` or `failed`).
- A memo recorded offline says `wanted`. When its recording has been uploaded, the server queues a job
  (the app also asks, `POST /api/objects/:id/transcribe`, which is also "try again"). The server writes
  the job's progress and the text into the memo's document, so it shows on every device at once.
- **Move to…**: a new note, the end of an existing note, or rows in a list (one per line). The memo
  stays, unless the person chooses to delete it.

### The worker

The worker never sees the database or the documents. It asks the server for work over HTTP, with a
token both are given (`WORKER_TOKEN`; without one on the server, transcription is off). Everything below
is under `/api/worker` with `Authorization: Bearer <WORKER_TOKEN>`; a wrong token gets 401.

| Request | Answer |
|---|---|
| `POST /next` `{ worker, kinds: ["transcribe"], model }` | Waits up to 25 s for a job. `200 { job: { id, kind: "transcribe", file: { hash, type, size }, language } }` (language `"sv"`, or null to detect it), or `204` when there's none. The job is the worker's for 10 minutes from its last progress. |
| `GET /files/:hash` | The recording's bytes. |
| `POST /jobs/:id/progress` `{ progress }` (0–1) | `204`, and the job is the worker's for another 10 minutes. `409` if it isn't any more (taken back, or the memo was deleted): stop. |
| `POST /jobs/:id/done` `{ text, language, duration, model, segments: [{ start, end, text }] }` | `204`. The text goes into the memo. |
| `POST /jobs/:id/failed` `{ error, retry }` | `204`. With retry, the job is queued again (three tries in all). |

A job whose worker went quiet for 10 minutes is queued again. The server says whether a worker has
asked for work in the last minute (`GET /api/transcriber`, signed in), so the app can say "waiting for
the transcriber" rather than leave a memo looking stuck.

The worker is Python with **faster-whisper** and **KB-Whisper** (`KBLab/kb-whisper-large`, the National
Library of Sweden's Whisper trained on Swedish, published in CTranslate2's format, so faster-whisper
loads it as it is): float16 on the GPU, int8 on a CPU. The model is downloaded on first start into a
volume (`/models`, about 3 GB).

## Consequences

- Notes, memos and lists all sync the same way; a memo's text moves to a note as text.
- Files are deduplicated by hash for free; a file the server has already got isn't sent again.
- Without a GPU (or with no worker at all) the app still records and plays memos; they wait, saying why.
- The token is the worker's only check: it should be long and random, and the worker's API isn't for
  anything else.
