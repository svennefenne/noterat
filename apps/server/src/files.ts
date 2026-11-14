import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { Context, Hono } from "hono";
import { CHUNK_SIZE, cleanFileType, isFileHash, isObjectId, MAX_FILE_SIZE, type FileStatus, type UploadReply } from "@noterat/core";
import type { DB } from "./db";
import { Fail, signedIn, type Env } from "./http";
import { objectRow, roleOf, type ObjectRow } from "./objects";

/**
 * Files people add (recordings; later photos and scans), named by the SHA-256 of their bytes
 * (decision 6). They come in pieces of up to CHUNK_SIZE, each sent where the last one ended, so an
 * upload that's cut off goes on where it stopped; the last piece in, the server checks the hash and
 * keeps the file. An upload is always for a thing (an owner or editor of it sends it), and the thing
 * then refers to the file: anyone who has it may read the file.
 */

export interface FileStore {
  /** where a complete file is */
  path(hash: string): string;
  /** where a file being uploaded waits, and what it said it would be (size, type) */
  part(hash: string): string;
  partInfo(hash: string): string;
}

export function fileStore(dataDir: string): FileStore {
  const files = path.join(dataDir, "files");
  const uploads = path.join(dataDir, "uploads");
  fs.mkdirSync(files, { recursive: true });
  fs.mkdirSync(uploads, { recursive: true });
  return {
    path: (hash) => path.join(files, hash.slice(0, 2), hash),
    part: (hash) => path.join(uploads, `${hash}.part`),
    partInfo: (hash) => path.join(uploads, `${hash}.json`),
  };
}

interface FileRow {
  hash: string;
  size: number;
  type: string;
}

export const fileRow = (db: DB, hash: string) => (db.prepare("select hash, size, type from files where hash = ?").get(hash) as FileRow | undefined) ?? null;

/** Whether someone may read a file: they have a thing that refers to it, or they sent it. */
function mayRead(db: DB, hash: string, userId: number): boolean {
  const viaThing = db
    .prepare(
      `select 1 from file_refs r join members m on m.object_id = r.object_id join objects o on o.id = r.object_id
       where r.hash = ? and m.user_id = ? and o.deleted_at is null limit 1`,
    )
    .get(hash, userId);
  return !!viaThing || !!db.prepare("select 1 from files where hash = ? and uploaded_by = ?").get(hash, userId);
}

const addRef = (db: DB, objectId: string, hash: string) =>
  db.prepare("insert or ignore into file_refs (object_id, hash, added_at) values (?, ?, ?)").run(objectId, hash, Date.now());

async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** A whole file made on the server's side (by the worker: a cropped page, a PDF), kept and referred to by a thing. */
export function keepFile(db: DB, store: FileStore, bytes: Uint8Array, type: string, objectId: string): { hash: string; size: number; type: string } {
  const hash = createHash("sha256").update(bytes).digest("hex");
  const clean = cleanFileType(type);
  if (!fileRow(db, hash)) {
    const to = store.path(hash);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, bytes);
    db.prepare("insert or ignore into files (hash, size, type, uploaded_by, created_at) values (?, ?, ?, null, ?)").run(hash, bytes.length, clean, Date.now());
  }
  addRef(db, objectId, hash);
  return { hash, size: bytes.length, type: fileRow(db, hash)!.type };
}

export function fileRoutes(app: Hono<Env>, o: { db: DB; store: FileStore; onUploaded: (obj: ObjectRow, hash: string) => void }) {
  const { db, store } = o;
  const auth = signedIn(db);
  // (one piece at a time per file: a retry can't overtake the request it retries)
  const busy = new Map<string, Promise<unknown>>();

  const hashOf = (c: Context<Env>) => {
    const hash = c.req.param("hash") ?? "";
    if (!isFileHash(hash)) throw new Fail("not_found", 404);
    return hash;
  };

  app.get("/api/files/:hash/status", auth, (c) => {
    const hash = hashOf(c);
    const done = fileRow(db, hash);
    if (done) return c.json({ size: done.size, received: done.size, complete: true } satisfies FileStatus);
    if (!fs.existsSync(store.part(hash))) throw new Fail("not_found", 404);
    const info = JSON.parse(fs.readFileSync(store.partInfo(hash), "utf8")) as { size: number };
    return c.json({ size: info.size, received: fs.statSync(store.part(hash)).size, complete: false } satisfies FileStatus);
  });

  app.put("/api/files/:hash", auth, async (c) => {
    const hash = hashOf(c);
    const user = c.get("user");
    const objectId = c.req.query("object") ?? "";
    const offset = Number(c.req.query("offset"));
    const size = Number(c.req.query("size"));
    if (!isObjectId(objectId) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size <= 0) throw new Fail("bad_request", 400);
    if (size > MAX_FILE_SIZE) throw new Fail("file_too_large", 413);
    if (Number(c.req.header("content-length") ?? 0) > CHUNK_SIZE * 2) throw new Fail("file_too_large", 413);
    const obj = objectRow(db, objectId);
    if (!obj) throw new Fail("not_synced", 404);
    if (obj.deleted_at) throw new Fail("not_found", 404);
    const role = roleOf(db, obj.id, user.id);
    if (role !== "owner" && role !== "editor") throw new Fail("forbidden", 403);

    const before = busy.get(hash) ?? Promise.resolve();
    const work = before.catch(() => {}).then(async (): Promise<UploadReply> => {
      // (already here, sent by this device earlier or by someone else: only the reference is new)
      if (fileRow(db, hash)) {
        addRef(db, obj.id, hash);
        o.onUploaded(obj, hash);
        return { received: size, complete: true };
      }
      const part = store.part(hash);
      const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
      if (offset !== have) throw Object.assign(new Fail("upload_offset", 409), { received: have });
      const piece = new Uint8Array(await c.req.arrayBuffer());
      if (piece.length > CHUNK_SIZE * 2 || have + piece.length > size) throw new Fail("bad_request", 400);
      if (have === 0) fs.writeFileSync(store.partInfo(hash), JSON.stringify({ size, type: cleanFileType(c.req.query("type")) }));
      fs.appendFileSync(part, piece);
      const received = have + piece.length;
      if (received < size) return { received, complete: false };

      const got = await sha256(part);
      const info = JSON.parse(fs.readFileSync(store.partInfo(hash), "utf8")) as { size: number; type: string };
      if (got !== hash) {
        fs.rmSync(part, { force: true });
        fs.rmSync(store.partInfo(hash), { force: true });
        throw new Fail("hash_mismatch", 400);
      }
      const to = store.path(hash);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(part, to);
      fs.rmSync(store.partInfo(hash), { force: true });
      db.transaction(() => {
        db.prepare("insert or ignore into files (hash, size, type, uploaded_by, created_at) values (?, ?, ?, ?, ?)").run(hash, size, info.type, user.id, Date.now());
        addRef(db, obj.id, hash);
      })();
      o.onUploaded(obj, hash);
      return { received, complete: true };
    });
    busy.set(hash, work);
    try {
      return c.json(await work);
    } catch (err) {
      if (err instanceof Fail && err.code === "upload_offset") return c.json({ error: err.code, received: (err as Fail & { received: number }).received }, 409);
      throw err;
    } finally {
      if (busy.get(hash) === work) busy.delete(hash);
    }
  });

  app.get("/api/files/:hash", auth, (c) => {
    const hash = hashOf(c);
    const row = fileRow(db, hash);
    if (!row || !mayRead(db, hash, c.get("user").id)) throw new Fail("not_found", 404);
    return fileResponse(store, row);
  });
}

/** A kept file as an answer (to the app, or to the worker). */
export function fileResponse(store: FileStore, row: { hash: string; size: number; type: string }) {
  const stream = Readable.toWeb(fs.createReadStream(store.path(row.hash))) as ReadableStream;
  return new Response(stream, {
    headers: {
      "Content-Type": row.type,
      "Content-Length": String(row.size),
      // (a file's name is its content: it never changes)
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
