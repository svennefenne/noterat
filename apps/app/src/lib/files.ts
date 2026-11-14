import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { CHUNK_SIZE, cleanFileType, type ApiErrorBody, type FileStatus, type UploadReply } from "@noterat/core";

/**
 * Files on this device, and on their way to the server (decision 6). A file (a recording) is kept in
 * IndexedDB under the SHA-256 of its bytes, and a note that it's to be uploaded for a thing. Whenever
 * there's a connection, what's waiting goes up in pieces, each where the server's copy ends, so an upload
 * that was cut off goes on where it stopped. A file from someone else is fetched from the server the
 * first time it's wanted and kept from then on.
 */

export interface Upload {
  hash: string;
  objectId: string;
  type: string;
  size: number;
}

export interface UploadState {
  received: number;
  size: number;
  /** waiting: the thing hasn't reached the server yet, or there's no connection */
  waiting: boolean;
}

export type FilesState = Record<string, UploadState>;

// ───────────── a little IndexedDB ─────────────

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function openDb(name: string): Promise<IDBDatabase> {
  const r = indexedDB.open(name, 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("blobs");
    r.result.createObjectStore("uploads", { keyPath: "hash" });
  };
  return req(r);
}

/** The SHA-256 of a file's bytes, read a few megabytes at a time. */
export async function hashOf(blob: Blob): Promise<string> {
  const h = sha256.create();
  for (let at = 0; at < blob.size; at += 4 * CHUNK_SIZE) h.update(new Uint8Array(await blob.slice(at, at + 4 * CHUNK_SIZE).arrayBuffer()));
  return bytesToHex(h.digest());
}

export class Files {
  private readonly db: Promise<IDBDatabase>;
  private readonly listeners = new Set<() => void>();
  private state: FilesState = {};
  private running = false;
  private again: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly o: {
      base: string;
      token: string;
      /** this server's and person's IndexedDB name prefix */
      prefix: string;
      /** a file is on the server: its thing may want something done with it */
      onUploaded: (upload: Upload) => void;
    },
  ) {
    this.db = openDb(`${o.prefix}files`);
    void this.refresh();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(next: FilesState) {
    this.state = next;
    for (const l of this.listeners) l();
  }

  private async store(name: "blobs" | "uploads", mode: IDBTransactionMode) {
    return (await this.db).transaction(name, mode).objectStore(name);
  }

  private async uploads(): Promise<Upload[]> {
    return req((await this.store("uploads", "readonly")).getAll() as IDBRequest<Upload[]>);
  }

  private async refresh() {
    const next: FilesState = {};
    for (const u of await this.uploads()) next[u.hash] = this.state[u.hash] ?? { received: 0, size: u.size, waiting: true };
    this.set(next);
  }

  /** Keep a file on the device and send it to the server for a thing (now, or once there's a connection). */
  async add(blob: Blob, objectId: string): Promise<Upload> {
    const hash = await hashOf(blob);
    const upload: Upload = { hash, objectId, type: cleanFileType(blob.type), size: blob.size };
    await req((await this.store("blobs", "readwrite")).put(blob, hash));
    await req((await this.store("uploads", "readwrite")).put(upload));
    await this.refresh();
    this.kick();
    return upload;
  }

  /**
   * A file this device or the server already has, for one more thing (a memo's recording put in a
   * journal entry): the server is told the thing refers to it too, now or once there's a connection.
   */
  async link(upload: Upload) {
    await req((await this.store("uploads", "readwrite")).put(upload));
    await this.refresh();
    this.kick();
  }

  /** A file: from the device, else fetched from the server (and kept). Null if it can't be had now. */
  async get(hash: string): Promise<Blob | null> {
    const here = (await req((await this.store("blobs", "readonly")).get(hash))) as Blob | undefined;
    if (here) return here;
    try {
      const res = await fetch(`${this.o.base}/api/files/${hash}`, { headers: { Authorization: `Bearer ${this.o.token}` } });
      if (!res.ok) return null;
      const blob = await res.blob();
      await req((await this.store("blobs", "readwrite")).put(blob, hash));
      return blob;
    } catch {
      return null;
    }
  }

  /** Send what's waiting (if it isn't being sent already). */
  kick = () => {
    if (this.again) clearTimeout(this.again);
    this.again = null;
    if (!this.running && !this.stopped) void this.run();
  };

  private async run() {
    this.running = true;
    let later = false;
    try {
      for (const u of await this.uploads()) {
        if (this.stopped) return;
        const r = await this.send(u);
        if (r === "later") later = true;
      }
    } finally {
      this.running = false;
      await this.refresh().catch(() => {});
      // (no connection, or a thing not on the server yet: try again in a while; a connection coming back kicks it sooner)
      if (later && !this.stopped) this.again = setTimeout(this.kick, 30_000);
    }
  }

  private async send(u: Upload): Promise<"done" | "later" | "dropped"> {
    const at = <T>(path: string, init: RequestInit = {}) => this.call<T>(path, init);
    const progress = (received: number, waiting: boolean) => this.set({ ...this.state, [u.hash]: { received, size: u.size, waiting } });
    try {
      let received = 0;
      const status = await at<FileStatus>(`/api/files/${u.hash}/status`).catch((err: unknown) => {
        if (err instanceof Failed && err.status === 404) return null;
        throw err;
      });
      if (status && !status.complete) received = status.received;
      const blob = (await req((await this.store("blobs", "readonly")).get(u.hash))) as Blob | undefined;
      // (not on this device: fine if the server has it; otherwise the device that has it hasn't sent it yet)
      if (!blob && !status?.complete) return progress(0, true), "later";
      // (a file the server already has gets one empty request, which makes this thing refer to it)
      let empty = !!status?.complete;
      do {
        progress(received, false);
        const piece = empty || !blob ? new Blob([]) : blob.slice(received, received + CHUNK_SIZE);
        empty = false;
        const q = new URLSearchParams({ object: u.objectId, offset: String(received), size: String(u.size), type: u.type });
        try {
          const r = await at<UploadReply>(`/api/files/${u.hash}?${q}`, { method: "PUT", body: piece, headers: { "Content-Type": "application/octet-stream" } });
          received = r.complete ? u.size : r.received;
          if (r.complete) break;
        } catch (err) {
          // (the server's copy ends elsewhere: go on from there)
          if (err instanceof Failed && err.body.error === "upload_offset") received = Number((err.body as { received?: number }).received) || 0;
          else throw err;
        }
      } while (received < u.size);
      await req((await this.store("uploads", "readwrite")).delete(u.hash));
      this.o.onUploaded(u);
      return "done";
    } catch (err) {
      if (err instanceof Failed) {
        if (err.body.error === "not_synced") return progress(0, true), "later";
        // (the thing is gone, or not this person's to add to; or the file on the device is damaged)
        if (["not_found", "forbidden", "hash_mismatch", "file_too_large"].includes(err.body.error)) return this.drop(u);
      }
      progress(this.state[u.hash]?.received ?? 0, true);
      return "later";
    }
  }

  private async drop(u: Upload): Promise<"dropped"> {
    await req((await this.store("uploads", "readwrite")).delete(u.hash));
    return "dropped";
  }

  private async call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(this.o.base + path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${this.o.token}` },
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await res.json().catch(() => ({}))) as unknown;
    if (!res.ok) throw new Failed(res.status, body as ApiErrorBody);
    return body as T;
  }

  /** Logging out: stop, and (forget) remove the files from the device. */
  async destroy(o: { forget: boolean }) {
    this.stopped = true;
    if (this.again) clearTimeout(this.again);
    this.listeners.clear();
    const db = await this.db.catch(() => null);
    db?.close();
    if (o.forget) await req(indexedDB.deleteDatabase(`${this.o.prefix}files`)).catch(() => {});
  }
}

class Failed extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body?.error ?? String(status));
  }
}
