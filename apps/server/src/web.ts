import fs from "node:fs";
import path from "node:path";
import type { MiddlewareHandler } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const isFile = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;

/**
 * The app's built files (WEB_DIR). Any other path gets the app's page (index.html), so reloading
 * on a page deep in the app works. Vite's assets/ have a hash in their names, so they're kept a
 * year; the page itself is asked for again each time, so a new version shows at once.
 */
export function webFiles(root: string): MiddlewareHandler {
  const base = path.resolve(root);
  const page = path.join(base, "index.html");
  return async (c) => {
    let file = page;
    try {
      const wanted = path.resolve(base, "." + decodeURIComponent(new URL(c.req.url).pathname));
      if (wanted.startsWith(base + path.sep) && isFile(wanted)) file = wanted;
    } catch {
      // (a path that isn't valid percent-encoding: the page)
    }
    if (!isFile(file)) return c.notFound();
    const hashed = file.startsWith(path.join(base, "assets") + path.sep);
    return c.body(await fs.promises.readFile(file), 200, {
      "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    });
  };
}
