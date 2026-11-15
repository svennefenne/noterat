// The desktop app's updates from its own server (decision 16). The server offers the AppImage built with
// it (/api/app/desktop: its build, size and SHA-256); a newer one is downloaded beside the running file,
// checked (its size, its SHA-256, and that it is an AppImage), and renamed over it. The running copy goes
// on from the old file, which stays readable while it's open; the next start is the new one. The path
// stays the same, so the menu entry and starting at log-in still point at it.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_SIZE = 1024 * 1024 * 1024;

/** What the server says it offers, if it reads as one. */
function release(json) {
  if (!json || typeof json !== "object") return null;
  const { build, size, sha256, url } = json;
  if (!Number.isInteger(build) || build <= 0) return null;
  if (!Number.isInteger(size) || size <= 0 || size > MAX_SIZE) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (typeof url !== "string" || !url.startsWith("/app/")) return null;
  return { build, size, sha256, url };
}

/** An AppImage (type 2): an ELF file with "AI\x02" after the ELF magic. */
export function isAppImage(head) {
  return head.length >= 11 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46 && head[8] === 0x41 && head[9] === 0x49 && head[10] === 0x02;
}

/**
 * Updates the AppImage at `appImage` from the server at `server`, if it offers a build newer than `own`.
 * Returns {status: "current"} or {status: "updated", build}; throws when it can't.
 */
export async function updateFrom(server, { own, appImage, fetch = globalThis.fetch }) {
  const base = new URL(server);
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("not a server's address");
  const asked = await fetch(new URL("/api/app/desktop", base.origin));
  if (!asked.ok) throw new Error(`the server answered ${asked.status}`);
  const r = release(await asked.json());
  if (!r || r.build <= own) return { status: "current" };

  const part = path.join(path.dirname(appImage), `.${path.basename(appImage)}.update`);
  const res = await fetch(new URL(r.url, base.origin));
  if (!res.ok || !res.body) throw new Error(`the download answered ${res.status}`);
  const hash = createHash("sha256");
  let size = 0;
  let head = Buffer.alloc(0);
  try {
    await pipeline(
      Readable.fromWeb(res.body),
      async function* (chunks) {
        for await (const chunk of chunks) {
          size += chunk.length;
          if (size > r.size) throw new Error("the download is bigger than the server said");
          if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16 - head.length)]);
          hash.update(chunk);
          yield chunk;
        }
      },
      fs.createWriteStream(part, { mode: 0o755 }),
    );
    if (size !== r.size) throw new Error("the download was cut short");
    if (hash.digest("hex") !== r.sha256) throw new Error("the download isn't the one the server named");
    if (!isAppImage(head)) throw new Error("the download isn't an AppImage");
    fs.chmodSync(part, 0o755);
    fs.renameSync(part, appImage);
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw e;
  }
  return { status: "updated", build: r.build };
}

/**
 * Starts the AppImage again once this process has ended (it holds the single-instance lock until then),
 * with the same arguments; `hidden`: in the tray. The AppImage's own variables are left out, as they point
 * into this copy's mount, which goes with it; so are the files this process has open (the AppImage's
 * runtime keeps the old mount until the last copy of its keep-alive pipe is closed).
 */
export function startAgainAfter(pid, appImage, args, hidden) {
  const env = { ...process.env };
  const mount = env.APPDIR;
  for (const k of ["APPDIR", "APPIMAGE", "ARGV0", "OWD"]) delete env[k];
  if (mount) for (const [k, v] of Object.entries(env)) if (typeof v === "string" && v.includes(mount)) delete env[k];
  const rest = args.filter((a) => a !== "--hidden");
  if (hidden) rest.push("--hidden");
  // (bash closes any descriptor; a plain sh, only 3 to 9)
  const bash = ["/bin/bash", "/usr/bin/bash"].find((b) => fs.existsSync(b));
  const fds = bash ? "0|1|2) ;; *" : "[3-9]";
  const script = `pid=$1; shift
for f in /proc/$$/fd/*; do n=\${f##*/}; case $n in ${fds}) eval "exec $n>&-" 2>/dev/null ;; esac; done
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
exec "$@"`;
  spawn(bash ?? "/bin/sh", ["-c", script, "sh", String(pid), appImage, ...rest], { detached: true, stdio: "ignore", env, cwd: path.dirname(appImage) }).unref();
}
