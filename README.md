# Noterat

A shared notes, journal, voice memo, lists, finances, calendar, recipes and receipt and document
scanning app. Self-hosted in a Docker container (made for Unraid), with an Android app that keeps a copy
of everything on the phone: it works offline and catches up when it's back online. Nothing is shared
until you share it, and what you share is live for everyone in it.

**Status: phase 4 of 8: Lists, notes, voice memos, the journal, documents, and search.** Lists of your
own making (as in Hooden); notes in Markdown, written together live; voice memos, turned into text by
KB-Whisper on the server's GPU; a journal with text, photos and voice clips; and a scanner for documents
and receipts: on the phone the page is found, cropped and read at once (ML Kit), and the server makes a
searchable PDF and suggests a receipt's shop, date and total. Search finds words in all of it, on the
device and offline; the journal (or the whole app) can be locked with the fingerprint. Everything is
kept on the device and synced live, shared by a link or with someone on the same server. Next are
recipes; see [the plan](docs/PLAN.md) and [the decisions behind it](docs/decisions/).

## Run it

### On Unraid

Add the template from [`unraid/noterat.xml`](unraid/noterat.xml) (Docker → Add Container → Template
URL: `https://raw.githubusercontent.com/svennefenne/noterat/main/unraid/noterat.xml`), or make a
container from `ghcr.io/svennefenne/noterat:latest` with:

- port 3000 in the container (3300 on the server by default),
- `/data` → `/mnt/user/appdata/noterat`,
- `PUBLIC_URL`: the address people use, e.g. `https://noterat.example.com`.

Put your reverse proxy (SWAG, Nginx Proxy Manager…) in front of it with HTTPS, so phones reach it from
anywhere and share links work. It has to let WebSockets through: the live sync is one, at `/sync` (in
Nginx Proxy Manager, turn on "Websockets Support"; SWAG's and Caddy's defaults do it). Open the
address: the first account you make is the admin.

**Speech to text** (optional, an Nvidia GPU): give Noterat a `WORKER_TOKEN` (a long random string),
and add the worker from [`unraid/noterat-worker.xml`](unraid/noterat-worker.xml) with the same token and
Noterat's address. It needs Unraid's Nvidia Driver plugin; see [`apps/worker`](apps/worker/README.md).
Without it, voice memos are recorded and played, but not turned into text.

### With Docker Compose

```bash
cp .env.example .env    # then edit .env
docker compose up -d    # http://<server>:3300; add --profile https for Caddy with your own domain,
                        # --profile gpu for speech to text (set WORKER_TOKEN in .env)
```

### The Android app

The Android workflow builds an APK on every push to `main` (under Actions, and as a GitHub release once
the signing key is set up: see [`.github/workflows/android.yml`](.github/workflows/android.yml)). On
its first screen the app asks for the server's address; a server at home can be plain
`http://192.168.x.x:3300` on the local network. The APK is built for 64-bit ARM phones only (all from
the last several years), which keeps it small: ML Kit's text recognition is a large native library.

## Develop

Node 22 or newer.

```bash
npm install
npm run dev        # the server on :3000 and the app on http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Server (restarts on changes) and app (Vite), side by side |
| `npm test` | The tests (Vitest): the models of lists, notes, memos, journal entries and scans, receipts, and what's searched in them; and the server for real, with devices syncing over its WebSocket (offline and back), uploads in pieces, and a worker's jobs (speech to text and OCR) |
| `npm run typecheck` | TypeScript, every package |
| `npm run lint` | ESLint, the whole repository |
| `npm run build` | The server bundle (`apps/server/dist`) and the app (`apps/app/dist`) |
| `npm run android -w @noterat/app` | Builds the app and copies it into the Android project; then open `apps/app/android` in Android Studio, or `./gradlew assembleDebug` there (JDK 21) |
| `docker compose build` | The image, as CI builds it |

```
apps/
  server/     Node + Hono + SQLite: the API, sharing, files, the worker's jobs, and the live sync
              (Hocuspocus at /sync)
  app/        React + Vite: the app for the web, and inside Capacitor (android/) for Android;
              everything kept in IndexedDB on the device (lib/sync.ts, lib/files.ts)
  worker/     Python: speech to text (faster-whisper, KB-Whisper, on the GPU) and reading scans
              (OpenCV, OCRmyPDF, Tesseract) (optional)
packages/
  core/       what the server and the app share: the API's shapes and checks, document names,
              the home document, files, the models of lists, notes, memos, journal entries and
              scans, receipts, what's transcribed where, and what's searchable
docker/       the image's entrypoint (runs as PUID:PGID)
unraid/       the Unraid template
docs/         the plan and the decisions
```

The server keeps everything in `DATA_DIR` (`.data/` in development, `/data` in the container).
