# 3. The core in one container, with SQLite; heavy work in an optional second one

Date: 2026-11-14 · Status: accepted

## Context

Noterat runs on an Unraid server at home, for a household. It should install like any Unraid app and
keep everything in one appdata folder that's easy to back up. Speech to text and OCR need big models
and want the server's GPU (an RTX 3070 Ti).

## Decision

- **noterat** (the core): one container with the Node server, its SQLite database (better-sqlite3, WAL)
  and the app's web build. Everything it keeps is in `/data`. It runs as PUID:PGID (99:100 on Unraid),
  like Hooden.
- **noterat-worker** (phase 2): an optional Python container for speech to text (faster-whisper with
  KB-Whisper), OCR (OCRmyPDF/Tesseract), recipe import and PDFs, given the GPU with `--runtime=nvidia`.
  The core works without it; its jobs wait until it's there.
- Images are built by GitHub Actions and published on ghcr.io; an Unraid template lives in `unraid/`.

## Consequences

- SQLite is plenty for a household and needs no database container; one folder holds everything.
- The core stays small and starts fast; the worker's big image and GPU are only needed for the sections
  that use them.
