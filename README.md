# Noterat

A shared notes, journal, voice memo, lists, finances, calendar, recipes and receipt and document
scanning app. Self-hosted in a Docker container (made for Unraid), with an Android app that keeps a copy
of everything on the phone: it works offline and catches up when it's back online. Nothing is shared
until you share it, and what you share is live for everyone in it.

**Status: all 8 phases: Lists, notes, voice memos, the journal, documents, recipes, the calendar, the
budget, search, push notifications, and a desktop app.** Lists of your own making (as in Hooden); notes
in Markdown, written together live; voice memos, turned into text by KB-Whisper on the server's GPU; a
journal with text, photos and voice clips; a scanner for documents and receipts; recipes imported from a
link, scaled and put on the shopping list; calendars, shared (a family calendar) or subscribed to (any
ICS address, and the phone's own), with repeats, reminders and a private feed for other calendar apps;
a household budget, month by month (envelopes or zero-based), filled from the bank's CSV export and
from receipts; and shared costs for a trip or a dinner, worked out and mailed to everyone with Swish QR
codes. Search finds words in all of it, offline too; the journal (or the whole app) can be locked
with the fingerprint. Push notifications go through your own Firebase project; the Linux desktop app
works offline like the phone; see [the plan](docs/PLAN.md) and [the decisions behind it](docs/decisions/).

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

CI builds the APK and the desktop app's AppImage on every push to `main` and puts both into the server's
image ([decision 16](docs/decisions/0016-updates-and-signing.md)). On its first screen the app asks for the server's address; a server at home can be plain
`http://192.168.x.x:3300` on the local network. The APK is built for 64-bit ARM phones only (all from
the last several years), which keeps it small: ML Kit's text recognition is a large native library.

**Updates** come with the server: update the container, and every phone and computer on an older build
gets the new one by itself. The phone downloads it and offers to install it (Android always asks); the
desktop app replaces its AppImage and starts again. The account menu shows which build you have. A newer
APK or AppImage put in the appdata folder's `app/` (named as CI names them,
`noterat-android-0.1.0-40.apk`) is offered too. APKs are signed with the key in the repository's secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`; keep a copy of it safe.

**Push notifications** go through your own (free) Firebase project, so nothing about Firebase is built
into the APK. As the admin, open *Administration* in the account menu → *Push* and follow the three steps: create a
project with an Android app named `io.github.svennefenne.noterat`, then pick its `google-services.json`
and a service account's private key (Project settings → Service accounts). The phones start Firebase
with it at their next start and ask for permission. Each person picks what they're told about, and
quiet hours, under *Notifications…*; a push only ever says that something happened, never what's in it.
The desktop app shows the same notifications while it runs (in the tray too), with or without Firebase.

**Mail** (for sending out shared costs) goes through your own SMTP server. As the admin, open
*Administration* → *Mail*, fill in the server and send yourself a test mail; with Gmail that's
`smtp.gmail.com`, STARTTLS, your Gmail address as user and sender, and an app password. Or set
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`starttls`, `tls` or `none`), `SMTP_USER`, `SMTP_PASS`,
`SMTP_FROM` and `SMTP_FROM_NAME` on the container; what's saved in the app takes over from them.

**Administration** (the account menu, for admins; [decision 14](docs/decisions/0014-household-settings-and-admin.md))
holds the household's accounts (add someone, rename, make an admin, a new password, log out everywhere,
remove), its look (Noterat's colours or any of Hooden's 98 colour schemes, light, dark or auto; anyone can
pick their own under *Appearance…*), how days and times are written and the time zone the server goes by,
Swish on or off for shared costs, push, mail, and which builds of the apps the server offers.

### The desktop app (Linux)

The Desktop workflow builds an AppImage (under Actions). It has the app inside it, so it opens and works
offline like the phone, asks for the server's address the first time, lives in the tray and can start at
log-in. See [`apps/desktop`](apps/desktop/README.md).

## Develop

Node 22 or newer.

```bash
npm install
npm run dev        # the server on :3000 and the app on http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Server (restarts on changes) and app (Vite), side by side |
| `npm test` | The tests (Vitest): the models of lists, notes, memos, journal entries, scans, receipts and recipes (scaling, schema.org), and what's searched in them; and the server for real, with devices syncing over its WebSocket (offline and back), uploads in pieces, and a worker's jobs (speech to text and OCR) |
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
  worker/     Python: speech to text (faster-whisper, KB-Whisper, on the GPU), reading scans
              (OpenCV, OCRmyPDF, Tesseract) and recipe pages (recipe-scrapers) (optional)
packages/
  core/       what the server and the app share: the API's shapes and checks, document names,
              the home document, files, the models of lists, notes, memos, journal entries and
              scans, receipts, what's transcribed where, and what's searchable
docker/       the image's entrypoint (runs as PUID:PGID)
unraid/       the Unraid template
docs/         the plan and the decisions
```

The server keeps everything in `DATA_DIR` (`.data/` in development, `/data` in the container).
