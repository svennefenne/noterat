import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { Hono } from "hono";
import type { Env } from "./http";

/**
 * The Android app's updates, from the server (decision 12; as Hooden does): the newest APK put in
 * DATA_DIR/app, named as CI names it (`noterat-android-0.1.0-23.apk`: the version, then the build), is
 * offered to every phone running an older build, and downloaded from here. No store, no account.
 */

export interface AndroidRelease {
  versionName: string;
  versionCode: number;
  url: string;
  size: number;
}

const NAME = /^noterat-android-(\d+(?:\.\d+)*)-(\d+)\.apk$/;

export function newestApk(dir: string): (AndroidRelease & { file: string }) | null {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let best: (AndroidRelease & { file: string }) | null = null;
  for (const f of names) {
    const m = NAME.exec(f);
    if (!m || (best && Number(m[2]) <= best.versionCode)) continue;
    const file = path.join(dir, f);
    best = { versionName: m[1]!, versionCode: Number(m[2]), url: "/app/noterat.apk", size: fs.statSync(file).size, file };
  }
  return best;
}

export function appUpdateRoutes(app: Hono<Env>, o: { dataDir: string }) {
  const dir = path.join(o.dataDir, "app");

  /** The newest build, or null (none put there). */
  app.get("/api/app/android", (c) => {
    const r = newestApk(dir);
    return c.json(r ? { versionName: r.versionName, versionCode: r.versionCode, url: r.url, size: r.size } : null);
  });

  /** (opened in the phone's browser, which has no session: an APK is no secret) */
  app.get("/app/noterat.apk", () => {
    const r = newestApk(dir);
    if (!r) return new Response("No APK on this server.", { status: 404 });
    return new Response(Readable.toWeb(fs.createReadStream(r.file)) as ReadableStream, {
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Length": String(r.size),
        "Content-Disposition": `attachment; filename="${path.basename(r.file)}"`,
        "Cache-Control": "no-cache",
      },
    });
  });
}
