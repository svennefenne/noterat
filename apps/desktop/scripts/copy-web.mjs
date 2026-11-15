// The app's web build (apps/app/dist) into web/, which the desktop app serves as app://noterat/.
// Build it first at the repository's root: npm run build -w @noterat/app
import fs from "node:fs";
import path from "node:path";

const here = path.resolve(import.meta.dirname, "..");
const from = path.resolve(here, "..", "app", "dist");
const to = path.join(here, "web");

if (!fs.existsSync(path.join(from, "index.html"))) {
  console.error(`No web build in ${from}: run "npm run build -w @noterat/app" at the repository's root first.`);
  process.exit(1);
}
fs.rmSync(to, { recursive: true, force: true });
// (without the source maps: most of the build's size, and nothing the app needs)
fs.cpSync(from, to, { recursive: true, filter: (src) => !src.endsWith(".map") });
console.log(`copied ${path.relative(here, from)} to web/`);
