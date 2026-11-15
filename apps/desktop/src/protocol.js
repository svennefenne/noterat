// The app's web build served as app://noterat/ (main.js registers it). Nothing here needs Electron, so
// the rules can be tested with plain Node (test/protocol.test.js).
import fs from "node:fs/promises";
import path from "node:path";

export const SCHEME = "app";
export const HOST = "noterat";
export const ORIGIN = `${SCHEME}://${HOST}`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
};

export const mimeType = (file) => TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** Whether an address is the app's own (app://noterat/…). (Node's URL gives such an origin as "null".) */
export function isAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === `${SCHEME}:` && u.host === HOST;
  } catch {
    return false;
  }
}

const isFile = (file) =>
  fs.stat(file).then(
    (s) => s.isFile(),
    () => false,
  );

/**
 * The file in `root` that answers a request for `url`: the file itself; index.html for anything else
 * that isn't a file (the app's own paths, such as /lists/<id>: it routes them itself); null when it's
 * not the app's address, leads outside `root`, or is a missing file of a kind the build has (a .js, a
 * .png: a missing asset is a 404, not the page).
 */
export async function locate(root, url) {
  if (!isAppUrl(url)) return null;
  let rel;
  try {
    rel = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  const base = path.resolve(root);
  const file = path.join(base, rel);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  if (await isFile(file)) return file;
  const ext = path.extname(rel).toLowerCase();
  if (ext && ext in TYPES) return null;
  const index = path.join(base, "index.html");
  return (await isFile(index)) ? index : null;
}
