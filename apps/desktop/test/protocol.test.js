import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { isAppUrl, locate, mimeType } from "../src/protocol.js";

let root;
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "noterat-web-"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(root, "assets", "index-abc.js"), "");
  fs.writeFileSync(path.join(root, "assets", "my file.wasm"), "");
  // a file beside the web root, which no address may reach
  fs.writeFileSync(path.join(root, "..", `${path.basename(root)}-secret.txt`), "");
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(path.join(root, "..", `${path.basename(root)}-secret.txt`), { force: true });
});

const at = (p) => locate(root, `app://noterat${p}`);
const rel = async (p) => {
  const f = await at(p);
  return f && path.relative(root, f);
};

test("files are served as they are", async () => {
  assert.equal(await rel("/index.html"), "index.html");
  assert.equal(await rel("/assets/index-abc.js"), path.join("assets", "index-abc.js"));
  assert.equal(await rel("/assets/my%20file.wasm"), path.join("assets", "my file.wasm"));
  assert.equal(await rel("/assets/index-abc.js?v=1#x"), path.join("assets", "index-abc.js"));
});

test("the app's own paths get index.html", async () => {
  assert.equal(await rel("/"), "index.html");
  assert.equal(await rel(""), "index.html");
  assert.equal(await rel("/lists/0f8a-41"), "index.html");
  assert.equal(await rel("/notes/a.b/c"), "index.html");
  assert.equal(await rel("/assets"), "index.html");
});

test("a missing asset is not the page", async () => {
  assert.equal(await at("/assets/gone.js"), null);
  assert.equal(await at("/icon.png"), null);
});

test("nothing outside the web root, nor other hosts or schemes", async () => {
  const secret = `${path.basename(root)}-secret.txt`;
  for (const p of [`/../${secret}`, `/%2e%2e/${secret}`, `/%2E%2E%2F${secret}`, `/assets/..%2f..%2f${secret}`, `/..%5c${secret}`, "/%00", "/%E0%A4%A"]) {
    const f = await at(p);
    assert.ok(f === null || path.relative(root, f) === "index.html", `${p} gave ${f}`);
  }
  assert.equal(await locate(root, "app://other/index.html"), null);
  assert.equal(await locate(root, "file:///etc/passwd"), null);
  assert.equal(await locate(root, "https://noterat/index.html"), null);
});

test("types", () => {
  assert.equal(mimeType("a/index.html"), "text/html; charset=utf-8");
  assert.equal(mimeType("x.mjs"), "text/javascript; charset=utf-8");
  assert.equal(mimeType("x.WASM"), "application/wasm");
  assert.equal(mimeType("manifest.webmanifest"), "application/manifest+json; charset=utf-8");
  assert.equal(mimeType("x.woff2"), "font/woff2");
  assert.equal(mimeType("x.unknown"), "application/octet-stream");
});

test("the app's address", () => {
  assert.ok(isAppUrl("app://noterat/"));
  assert.ok(isAppUrl("app://noterat"));
  assert.ok(isAppUrl("app://noterat/lists/1"));
  assert.ok(!isAppUrl("app://noterat.evil/"));
  assert.ok(!isAppUrl("https://noterat/"));
  assert.ok(!isAppUrl("not a url"));
  assert.ok(!isAppUrl(""));
});
