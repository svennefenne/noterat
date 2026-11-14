# Noterat

A shared notes, journal, voice memo, lists, finances, calendar, recipes and receipt and document
scanning app. Self-hosted in a Docker container (made for Unraid), with an Android app that keeps a copy
of everything on the phone: it works offline and catches up when it's back online. Nothing is shared
until you share it, and what you share is live for everyone in it.

**Status: phase 0 of 8.** The server, accounts and log-in, the app's first screens (web and Android),
the Docker image, the Unraid template and CI. The sections arrive phase by phase, Lists first; see
[the plan](docs/PLAN.md) and [the decisions behind it](docs/decisions/).

## Run it

### On Unraid

Add the template from [`unraid/noterat.xml`](unraid/noterat.xml) (Docker → Add Container → Template
URL: `https://raw.githubusercontent.com/svennefenne/noterat/main/unraid/noterat.xml`), or make a
container from `ghcr.io/svennefenne/noterat:latest` with:

- port 3000 in the container (3300 on the server by default),
- `/data` → `/mnt/user/appdata/noterat`,
- `PUBLIC_URL`: the address people use, e.g. `https://noterat.example.com`.

Put your reverse proxy (SWAG, Nginx Proxy Manager…) in front of it with HTTPS, so phones reach it from
anywhere and share links work. Open the address: the first account you make is the admin.

### With Docker Compose

```bash
cp .env.example .env    # then edit .env
docker compose up -d    # http://<server>:3300; add --profile https for Caddy with your own domain
```

### The Android app

The Android workflow builds an APK on every push to `main` (under Actions, and as a GitHub release once
the signing key is set up: see [`.github/workflows/android.yml`](.github/workflows/android.yml)). On
its first screen the app asks for the server's address; a server at home can be plain
`http://192.168.x.x:3300` on the local network.

## Develop

Node 22 or newer.

```bash
npm install
npm run dev        # the server on :3000 and the app on http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Server (restarts on changes) and app (Vite), side by side |
| `npm test` | The server's tests (Vitest) |
| `npm run typecheck` | TypeScript, every package |
| `npm run lint` | ESLint, the whole repository |
| `npm run build` | The server bundle (`apps/server/dist`) and the app (`apps/app/dist`) |
| `npm run android -w @noterat/app` | Builds the app and copies it into the Android project; then open `apps/app/android` in Android Studio, or `./gradlew assembleDebug` there (JDK 21) |
| `docker compose build` | The image, as CI builds it |

```
apps/
  server/     Node + Hono + SQLite: the API (and, from phase 1, the live sync)
  app/        React + Vite: the app for the web, and inside Capacitor (android/) for Android
packages/
  core/       what the server and the app share: the API's shapes and its checks
docker/       the image's entrypoint (runs as PUID:PGID)
unraid/       the Unraid template
docs/         the plan and the decisions
```

The server keeps everything in `DATA_DIR` (`.data/` in development, `/data` in the container).
