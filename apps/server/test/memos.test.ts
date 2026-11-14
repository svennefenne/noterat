import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  addClip,
  CHUNK_SIZE,
  entryBody,
  initEntry,
  initMemo,
  memoText,
  newObjectId,
  objectDocName,
  readEntry,
  readMemo,
  type FileStatus,
  type ShareReply,
  type TranscriberInfo,
  type UploadReply,
  type WorkerJob,
} from "@noterat/core";
import { account, call, device, startServer, synced, until } from "./helpers";

/**
 * Voice memos on the server: a recording uploaded in pieces (and picked up where it stopped), read only
 * by those who have a memo that refers to it, and turned into text by a worker that asks for jobs over
 * HTTP, with the text showing in the memo on the devices (decision 6). The worker here is the test,
 * speaking the worker's protocol.
 */

const WORKER = "w".repeat(40);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function put(base: string, token: string, hash: string, o: { object: string; offset: number; size: number; body: Uint8Array }) {
  const res = await fetch(`${base}/api/files/${hash}?object=${o.object}&offset=${o.offset}&size=${o.size}&type=audio%2Fwebm%3Bcodecs%3Dopus`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
    body: o.body,
  });
  return { status: res.status, json: (await res.json()) as UploadReply & { error?: string; received?: number } };
}

/** Upload a whole file in pieces, from wherever the server has got to. */
async function upload(base: string, token: string, object: string, bytes: Uint8Array) {
  const hash = sha(bytes);
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const r = await put(base, token, hash, { object, offset, size: bytes.length, body: bytes.subarray(offset, offset + CHUNK_SIZE) });
    expect(r.status).toBe(200);
  }
  return hash;
}

const worker = (base: string, path: string, body?: unknown, token = WORKER) =>
  fetch(`${base}/api/worker${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function nextJob(base: string): Promise<WorkerJob | null> {
  const res = await worker(base, "/next", { worker: "test", kinds: ["transcribe"], model: "KBLab/kb-whisper-large" });
  if (res.status === 204) return null;
  expect(res.status).toBe(200);
  return ((await res.json()) as { job: WorkerJob }).job;
}

/** Ada records a memo on her phone (wanting it transcribed) and it reaches the server. */
async function recorded(o: { workerToken?: string; workerLease?: number } = {}) {
  const { db, base } = await startServer({ workerToken: o.workerToken ?? WORKER, workerLease: o.workerLease });
  const ada = await account(db, "ada");
  const bo = await account(db, "bo");
  const audio = new Uint8Array(randomBytes(CHUNK_SIZE * 2 + 1234));
  const id = newObjectId();
  const memo = device(base, ada.token)(objectDocName("memo", id));
  initMemo(memo.doc, { audio: { hash: sha(audio), type: "audio/webm", size: audio.length, duration: 12 }, transcribe: true, by: ada.user.id });
  await synced(memo.provider);
  return { db, base, ada, bo, id, audio, memo };
}

describe("a recording", () => {
  it("is uploaded in pieces, goes on where it stopped, and is checked against its hash", async () => {
    const { base, ada, id, audio } = await recorded();
    const hash = sha(audio);
    const size = audio.length;

    // (a memo the server hasn't got yet: the device tries again later)
    expect((await put(base, ada.token, hash, { object: newObjectId(), offset: 0, size, body: audio.subarray(0, CHUNK_SIZE) })).json.error).toBe("not_synced");

    expect((await put(base, ada.token, hash, { object: id, offset: 0, size, body: audio.subarray(0, CHUNK_SIZE) })).json).toEqual({ received: CHUNK_SIZE, complete: false });
    // the connection went; the device asks where to go on from, and doesn't send the first piece again
    const again = await put(base, ada.token, hash, { object: id, offset: 0, size, body: audio.subarray(0, CHUNK_SIZE) });
    expect(again).toMatchObject({ status: 409, json: { error: "upload_offset", received: CHUNK_SIZE } });
    expect((await call<FileStatus>(base, "GET", `/api/files/${hash}/status`, ada.token)).json).toEqual({ size, received: CHUNK_SIZE, complete: false });
    await put(base, ada.token, hash, { object: id, offset: CHUNK_SIZE, size, body: audio.subarray(CHUNK_SIZE, CHUNK_SIZE * 2) });
    const last = await put(base, ada.token, hash, { object: id, offset: CHUNK_SIZE * 2, size, body: audio.subarray(CHUNK_SIZE * 2) });
    expect(last.json).toEqual({ received: size, complete: true });

    const got = await fetch(`${base}/api/files/${hash}`, { headers: { Authorization: `Bearer ${ada.token}` } });
    expect(got.headers.get("content-type")).toBe("audio/webm");
    expect(sha(new Uint8Array(await got.arrayBuffer()))).toBe(hash);

    // bytes that aren't what the hash says aren't kept
    const other = new Uint8Array(randomBytes(1000));
    const wrong = await put(base, ada.token, "0".repeat(64), { object: id, offset: 0, size: other.length, body: other });
    expect(wrong.json.error).toBe("hash_mismatch");
    expect((await call(base, "GET", `/api/files/${"0".repeat(64)}/status`, ada.token)).status).toBe(404);
  });

  it("is read only by those who have its memo, and sent only by those who may change it", async () => {
    const { base, ada, bo, id, audio } = await recorded();
    const hash = await upload(base, ada.token, id, audio);
    const read = (token: string) => fetch(`${base}/api/files/${hash}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.status);
    expect(await read(bo.token)).toBe(404);
    // (sending it again for a memo of his own that he doesn't have isn't a way in)
    expect((await put(base, bo.token, hash, { object: id, offset: 0, size: audio.length, body: audio.subarray(0, 10) })).status).toBe(403);

    const link = await call<ShareReply>(base, "POST", `/api/objects/${id}/share`, ada.token, { role: "viewer", userId: bo.user.id });
    const invitation = link.json.kind === "invitation" ? link.json.id : "";
    await call(base, "POST", `/api/invitations/${invitation}/accept`, bo.token);
    expect(await read(bo.token)).toBe(200);

    await call(base, "DELETE", `/api/objects/${id}`, ada.token);
    expect(await read(bo.token)).toBe(404);
  });
});

describe("transcription", () => {
  it("starts when the recording is in, and the text shows in the memo on the device", async () => {
    const { base, ada, id, audio, memo } = await recorded();
    expect((await call<TranscriberInfo>(base, "GET", "/api/transcriber", ada.token)).json).toEqual({ state: "offline", queued: 0 });
    expect(readMemo(memo.doc).transcription?.status).toBe("wanted");

    const hash = await upload(base, ada.token, id, audio);
    await until(() => readMemo(memo.doc).transcription?.status === "queued", "the memo to be queued");

    expect((await worker(base, "/next", {}, "not the token")).status).toBe(401);
    const job = (await nextJob(base))!;
    expect(job).toMatchObject({ kind: "transcribe", file: { hash, type: "audio/webm", size: audio.length }, language: "sv" });
    expect((await call<TranscriberInfo>(base, "GET", "/api/transcriber", ada.token)).json).toEqual({ state: "online", queued: 1 });
    await until(() => readMemo(memo.doc).transcription?.status === "working", "the memo to be worked on");

    const file = await worker(base, `/files/${hash}`);
    expect(sha(new Uint8Array(await file.arrayBuffer()))).toBe(hash);

    expect((await worker(base, `/jobs/${job.id}/progress`, { progress: 0.5 })).status).toBe(204);
    await until(() => readMemo(memo.doc).transcription?.progress === 0.5, "the progress on the device");

    const text = "Köp mjölk och ägg.\n\nRing mormor på söndag.";
    expect((await worker(base, `/jobs/${job.id}/done`, { text, language: "sv", model: "KBLab/kb-whisper-large", duration: 12, segments: [] })).status).toBe(204);
    await until(() => memoText(memo.doc).toString() === text, "the text in the memo");
    expect(readMemo(memo.doc).transcription).toMatchObject({ status: "done", language: "sv", model: "KBLab/kb-whisper-large" });

    // nothing more to do: the worker's request waits a while, then gets nothing
    expect(await nextJob(base)).toBeNull();
  });

  it("can be done again, keeping what someone wrote in the text", async () => {
    const { base, ada, id, audio, memo } = await recorded();
    await upload(base, ada.token, id, audio);
    const first = (await nextJob(base))!;
    await worker(base, `/jobs/${first.id}/done`, { text: "Ett första försök" });
    await until(() => memoText(memo.doc).toString() === "Ett första försök", "the first text");

    memoText(memo.doc).insert(0, "Min rättelse. ");
    await synced(memo.provider);
    expect((await call(base, "POST", `/api/objects/${id}/transcribe`, ada.token)).status).toBe(202);
    const second = (await nextJob(base))!;
    await worker(base, `/jobs/${second.id}/done`, { text: "Ett andra försök" });
    await until(() => memoText(memo.doc).toString() === "Min rättelse. Ett första försök\n\nEtt andra försök", "the second text after the first");
  });

  it("is tried again when the worker fails, and says why when it gives up; a deleted memo's job stops", async () => {
    const { base, ada, id, audio, memo } = await recorded();
    await upload(base, ada.token, id, audio);
    const job = (await nextJob(base))!;
    await worker(base, `/jobs/${job.id}/failed`, { error: "out of memory", retry: true });
    await until(() => readMemo(memo.doc).transcription?.status === "queued", "the job queued again");

    const again = (await nextJob(base))!;
    expect(again.id).toBe(job.id);
    await worker(base, `/jobs/${again.id}/failed`, { error: "the file can't be read", retry: false });
    await until(() => readMemo(memo.doc).transcription?.status === "failed", "the memo to say it failed");
    expect(readMemo(memo.doc).transcription?.error).toBe("the file can't be read");

    await call(base, "POST", `/api/objects/${id}/transcribe`, ada.token);
    const third = (await nextJob(base))!;
    await call(base, "DELETE", `/api/objects/${id}`, ada.token);
    expect((await worker(base, `/jobs/${third.id}/progress`, { progress: 0.1 })).status).toBe(409);
    expect((await worker(base, `/files/${sha(audio)}`)).status).toBe(404);
  });

  it("goes to another worker when the first goes quiet", async () => {
    const { base, ada, id, audio, memo } = await recorded({ workerLease: 200 });
    await upload(base, ada.token, id, audio);
    const first = (await nextJob(base))!;
    await new Promise((r) => setTimeout(r, 300));
    // (the first worker is gone; the next one to ask gets the job, and the first can't finish it)
    const second = (await nextJob(base))!;
    expect(second.id).toBe(first.id);
    await worker(base, `/jobs/${second.id}/done`, { text: "Andra gången gillt" });
    await until(() => memoText(memo.doc).toString() === "Andra gången gillt", "the text from the second worker");
    expect((await worker(base, `/jobs/${first.id}/progress`, { progress: 0.9 })).status).toBe(409);
  });

  it("is off without a worker token, and a memo can't be transcribed before its recording is in", async () => {
    const { base, ada, id } = await recorded({ workerToken: "" });
    expect((await call<TranscriberInfo>(base, "GET", "/api/transcriber", ada.token)).json).toEqual({ state: "none", queued: 0 });
    expect((await worker(base, "/next", {})).status).toBe(503);
    expect((await call<{ error: string }>(base, "POST", `/api/objects/${id}/transcribe`, ada.token)).json.error).toBe("not_uploaded");
  });
});

describe("a journal entry's voice clip", () => {
  it("is transcribed like a memo, and its text goes at the end of the entry", async () => {
    const { db, base } = await startServer({ workerToken: WORKER });
    const ada = await account(db, "ada");
    const id = newObjectId();
    const entry = device(base, ada.token)(objectDocName("journal", id));
    initEntry(entry.doc, { date: "2026-11-14", body: "Lugn kväll.", by: ada.user.id });
    const first = new Uint8Array(randomBytes(5000));
    const second = new Uint8Array(randomBytes(6000));
    addClip(entry.doc, { hash: sha(first), type: "audio/webm", size: first.length, duration: 4 }, true);
    // (one that isn't wanted as text: it stays a recording)
    addClip(entry.doc, { hash: sha(second), type: "audio/webm", size: second.length, duration: 5 }, false);
    await synced(entry.provider);

    await upload(base, ada.token, id, first);
    await upload(base, ada.token, id, second);
    const clip = (h: string) => readEntry(entry.doc).clips.find((c) => c.hash === h)!;
    await until(() => clip(sha(first)).transcription?.status === "queued", "the first clip to be queued");
    expect(clip(sha(second)).transcription).toBeNull();

    const job = (await nextJob(base))!;
    expect(job.file.hash).toBe(sha(first));
    await worker(base, `/jobs/${job.id}/progress`, { progress: 0.25 });
    await until(() => clip(sha(first)).transcription?.progress === 0.25, "the clip's progress");
    await worker(base, `/jobs/${job.id}/done`, { text: "Vi grillade på altanen.", language: "sv" });
    await until(() => entryBody(entry.doc).toString() === "Lugn kväll.\n\nVi grillade på altanen.\n", "the text in the entry");
    expect(clip(sha(first)).transcription).toMatchObject({ status: "done", language: "sv" });

    // the other one, asked for afterwards
    expect((await call(base, "POST", `/api/objects/${id}/transcribe`, ada.token, { hash: sha(second) })).status).toBe(202);
    const later = (await nextJob(base))!;
    expect(later.file.hash).toBe(sha(second));
    await worker(base, `/jobs/${later.id}/done`, { text: "Sen kom regnet." });
    await until(() => entryBody(entry.doc).toString().endsWith("Vi grillade på altanen.\n\nSen kom regnet.\n"), "the second text after the first");
    // (a clip that isn't in the entry can't be asked for)
    expect((await call<{ error: string }>(base, "POST", `/api/objects/${id}/transcribe`, ada.token, { hash: "f".repeat(64) })).json.error).toBe("not_uploaded");
  });
});
