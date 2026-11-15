import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isAppImage, updateFrom } from "../src/update.js";

const appImageBytes = (text) => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 0x02, 0, 0, 0, 0, 0]), Buffer.from(text)]);
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** a server offering `file` as `build` (or `offer` as it says it) */
async function serverWith(file, build, offer = {}) {
  const s = http.createServer((req, res) => {
    if (req.url === "/api/app/desktop") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ version: "0.1.0", build, url: "/app/noterat.AppImage", size: file.length, sha256: sha(file), ...offer }));
    } else if (req.url === "/app/noterat.AppImage") res.end(file);
    else res.writeHead(404).end();
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${s.address().port}/`, close: () => new Promise((r) => s.close(r)) };
}

function installed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "noterat-update-"));
  const file = path.join(dir, "noterat.AppImage");
  fs.writeFileSync(file, appImageBytes("old"), { mode: 0o755 });
  return { dir, file };
}

test("an AppImage is told by its magic", () => {
  assert.equal(isAppImage(appImageBytes("x")), true);
  assert.equal(isAppImage(Buffer.from("#!/bin/sh\necho no")), false);
});

test("a newer build replaces the AppImage, in place and runnable", async () => {
  const next = appImageBytes("new build");
  const server = await serverWith(next, 40);
  const { dir, file } = installed();
  try {
    assert.deepEqual(await updateFrom(server.url, { own: 39, appImage: file }), { status: "updated", build: 40 });
    assert.deepEqual(fs.readFileSync(file), next);
    assert.equal(fs.statSync(file).mode & 0o777, 0o755);
    assert.deepEqual(fs.readdirSync(dir), ["noterat.AppImage"]);
    // the same build again: nothing to do
    assert.deepEqual(await updateFrom(server.url, { own: 40, appImage: file }), { status: "current" });
  } finally {
    await server.close();
  }
});

test("a download that isn't what the server named, or isn't an AppImage, leaves the old one", async () => {
  const { dir, file } = installed();
  const wrong = await serverWith(appImageBytes("tampered"), 41, { sha256: sha(appImageBytes("something else")) });
  const script = await serverWith(Buffer.from("#!/bin/sh\necho not an appimage"), 41);
  try {
    await assert.rejects(updateFrom(wrong.url, { own: 39, appImage: file }), /isn't the one the server named/);
    await assert.rejects(updateFrom(script.url, { own: 39, appImage: file }), /isn't an AppImage/);
    assert.deepEqual(fs.readFileSync(file), appImageBytes("old"));
    assert.deepEqual(fs.readdirSync(dir), ["noterat.AppImage"]);
    await assert.rejects(updateFrom("file:///etc/", { own: 39, appImage: file }), /not a server's address/);
  } finally {
    await wrong.close();
    await script.close();
  }
});
