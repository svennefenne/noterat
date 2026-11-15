import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";
import type { Env } from "./http";

/**
 * The apps' updates, from the server (decisions 12 and 16; as Hooden does it). The Android app and the
 * desktop app built with this server come in its image (BUNDLED_DIR, /app/bundled), named as CI names
 * them: `noterat-android-0.1.0-35.apk`, `noterat-desktop-0.1.0-35.AppImage` (the version, then the build).
 * One put in DATA_DIR/app by hand is offered too, when its build is newer. The apps ask for the newest,
 * check it against its SHA-256 and install it themselves; no store, no account. (The files are no secret:
 * they're served without a session, as the phone's installer and the AppImage's download have none.)
 */

export interface AppRelease {
  version: string;
  build: number;
  url: string;
  size: number;
  sha256: string;
}

interface Found {
  version: string;
  build: number;
  file: string;
  size: number;
  mtime: number;
}

const KINDS = {
  android: { name: /^noterat-android-(\d+(?:\.\d+)*)-(\d+)\.apk$/, url: "/app/noterat.apk", type: "application/vnd.android.package-archive" },
  desktop: { name: /^noterat-desktop-(\d+(?:\.\d+)*)-(\d+)\.AppImage$/, url: "/app/noterat.AppImage", type: "application/vnd.appimage" },
} as const;

type Kind = keyof typeof KINDS;

/** The newest build of one app in these folders (the first folder's, when two have the same build). */
export function newestApp(dirs: string[], kind: Kind): Found | null {
  let best: Found | null = null;
  for (const dir of dirs) {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of names) {
      const m = KINDS[kind].name.exec(f);
      if (!m || (best && Number(m[2]) <= best.build)) continue;
      const file = path.join(dir, f);
      try {
        const st = fs.statSync(file);
        if (st.isFile()) best = { version: m[1]!, build: Number(m[2]), file, size: st.size, mtime: st.mtimeMs };
      } catch {
        // (gone meanwhile)
      }
    }
  }
  return best;
}

/** a file's SHA-256, worked out once (an AppImage is some 125 MB) */
const sums = new Map<string, string>();

async function sha256Of(f: Found): Promise<string> {
  const key = `${f.file}:${f.size}:${f.mtime}`;
  const known = sums.get(key);
  if (known) return known;
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(f.file)) hash.update(chunk as Buffer);
  const sum = hash.digest("hex");
  sums.set(key, sum);
  return sum;
}

export function appUpdateRoutes(app: Hono<Env>, o: { dataDir: string; bundledDir?: string | null }) {
  const dirs = [path.join(o.dataDir, "app"), ...(o.bundledDir ? [o.bundledDir] : [])];

  const release = async (kind: Kind): Promise<AppRelease | null> => {
    const f = newestApp(dirs, kind);
    return f ? { version: f.version, build: f.build, url: KINDS[kind].url, size: f.size, sha256: await sha256Of(f) } : null;
  };

  /** The newest Android build, or null. (versionName and versionCode: what older apps read.) */
  app.get("/api/app/android", async (c) => {
    const r = await release("android");
    return c.json(r ? { ...r, versionName: r.version, versionCode: r.build } : null);
  });

  /** The newest desktop build (the AppImage), or null. */
  app.get("/api/app/desktop", async (c) => c.json(await release("desktop")));

  const serve = (kind: Kind) => () => {
    const f = newestApp(dirs, kind);
    if (!f) return new Response("Not on this server.", { status: 404 });
    return new Response(Readable.toWeb(fs.createReadStream(f.file)) as ReadableStream, {
      headers: {
        "Content-Type": KINDS[kind].type,
        "Content-Length": String(f.size),
        "Content-Disposition": `attachment; filename="${path.basename(f.file)}"`,
        "Cache-Control": "no-cache",
      },
    });
  };
  app.get(KINDS.android.url, serve("android"));
  app.get(KINDS.desktop.url, serve("desktop"));
}
