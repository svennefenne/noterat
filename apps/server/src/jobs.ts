import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { putTranscript, readMemo, setTranscription, type TranscriberInfo, type WorkerJob } from "@noterat/core";
import type { DB } from "./db";
import { fileResponse, fileRow, type FileStore } from "./files";
import { Fail, readBody, signedIn, text, type Env } from "./http";
import { objectRow, roleOf, type ObjectRow } from "./objects";
import type { Sync } from "./sync";

/**
 * Speech to text: jobs for the worker (decision 6). A voice memo's recording, once it's on the server,
 * gets a job; the worker asks for work (waiting up to `wait` for some), says how far it's got, and hands
 * back the text, which the server writes into the memo's document, so it shows on every device at once.
 * The worker has a job for `lease` from its last word; one that goes quiet longer loses it, and the job
 * is queued again (up to `maxTries` tries in all).
 */

interface JobRow {
  id: string;
  kind: "transcribe";
  object_id: string;
  hash: string;
  language: string | null;
  status: "queued" | "working" | "done" | "failed" | "cancelled";
  tries: number;
}

export interface JobOptions {
  db: DB;
  sync: Sync;
  store: FileStore;
  /** the worker's token; "" = no worker, transcription off */
  workerToken: string;
  /** "sv", or "auto" to let the model tell */
  language: string;
  lease?: number;
  maxTries?: number;
  wait?: number;
}

export type Jobs = ReturnType<typeof createJobs>;

export function createJobs(o: JobOptions) {
  const { db, sync } = o;
  const lease = o.lease ?? 10 * 60_000;
  const maxTries = o.maxTries ?? 3;
  const wait = o.wait ?? 25_000;
  const waiters = new Set<() => void>();
  let lastSeen = 0;
  let polling = 0;

  const jobRow = (id: string) => (db.prepare("select * from jobs where id = ?").get(id) as JobRow | undefined) ?? null;
  const wake = () => {
    for (const w of [...waiters]) w();
  };

  /** Write how a memo's transcription stands into it (unless it's been deleted meanwhile). */
  async function memoState(objectId: string, change: Parameters<typeof sync.changeObject>[2]) {
    const obj = objectRow(db, objectId);
    if (!obj || obj.deleted_at || obj.type !== "memo") return;
    await sync.changeObject("memo", objectId, change);
  }

  /** Queue a memo's recording to be transcribed (once: a job already waiting or working is kept). */
  async function enqueue(objectId: string, hash: string) {
    const had = db.prepare("select id from jobs where object_id = ? and hash = ? and status in ('queued', 'working')").get(objectId, hash);
    if (had) return;
    const t = Date.now();
    db.prepare("insert into jobs (id, kind, object_id, hash, language, status, created_at, updated_at) values (?, 'transcribe', ?, ?, ?, 'queued', ?, ?)").run(
      randomUUID(),
      objectId,
      hash,
      o.language === "auto" ? null : o.language,
      t,
      t,
    );
    await memoState(objectId, (d) => setTranscription(d, { status: "queued", at: t }));
    wake();
  }

  /** Jobs whose worker went quiet: queued again, or failed after the last try. */
  function expire() {
    const t = Date.now();
    const lost = db.prepare("select * from jobs where status = 'working' and lease_until < ?").all(t) as JobRow[];
    for (const job of lost) {
      const again = job.tries < maxTries;
      db.prepare("update jobs set status = ?, error = 'the worker stopped answering', updated_at = ? where id = ?").run(again ? "queued" : "failed", t, job.id);
      void memoState(job.object_id, (d) =>
        setTranscription(d, again ? { status: "queued", at: t } : { status: "failed", error: "the transcriber stopped answering", at: t }),
      ).catch((err) => console.error("jobs:", err));
    }
  }

  /** The oldest waiting job, now this worker's. */
  function take(worker: string): WorkerJob | null {
    expire();
    return db.transaction(() => {
      const job = db.prepare("select * from jobs where status = 'queued' order by created_at limit 1").get() as JobRow | undefined;
      if (!job) return null;
      const file = fileRow(db, job.hash);
      const t = Date.now();
      if (!file) {
        db.prepare("update jobs set status = 'failed', error = 'the recording is missing', updated_at = ? where id = ?").run(t, job.id);
        return null;
      }
      db.prepare("update jobs set status = 'working', tries = tries + 1, worker = ?, lease_until = ?, updated_at = ? where id = ?").run(worker, t + lease, t, job.id);
      return { id: job.id, kind: "transcribe" as const, file: { hash: file.hash, type: file.type, size: file.size }, language: job.language };
    })();
  }

  function waitForWork(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, wait);
      waiters.add(done);
      signal.addEventListener("abort", done);
    });
  }

  /** The worker's own routes: its token, not a person's session. */
  const workerAuth = createMiddleware<Env>(async (c, next) => {
    if (!o.workerToken) throw new Fail("no_transcriber", 503);
    const m = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    const given = Buffer.from(m?.[1] ?? "");
    const want = Buffer.from(o.workerToken);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new Fail("unauthorized", 401);
    lastSeen = Date.now();
    await next();
  });

  /** A job the worker is still meant to be doing (else 409: it stops). */
  function workingJob(id: string): JobRow {
    const job = jobRow(id);
    if (!job || job.status !== "working") throw new Fail("not_found", 409);
    return job;
  }

  function routes(app: Hono<Env>) {
    const auth = signedIn(db);

    app.post("/api/worker/next", workerAuth, async (c) => {
      const body = await readBody(c).catch(() => ({}) as Record<string, unknown>);
      const worker = text(body.worker).slice(0, 60) || "worker";
      if (Array.isArray(body.kinds) && !body.kinds.includes("transcribe")) return c.body(null, 204);
      let job = take(worker);
      if (!job) {
        polling++;
        try {
          await waitForWork(c.req.raw.signal);
        } finally {
          polling--;
          lastSeen = Date.now();
        }
        if (c.req.raw.signal.aborted) return c.body(null, 204);
        job = take(worker);
      }
      if (!job) return c.body(null, 204);
      const objectId = jobRow(job.id)!.object_id;
      await memoState(objectId, (d) => setTranscription(d, { status: "working", progress: 0, at: Date.now() }));
      return c.json({ job });
    });

    // (only a recording with a job waiting or being done)
    app.get("/api/worker/files/:hash", workerAuth, (c) => {
      const hash = c.req.param("hash");
      const row = fileRow(db, hash);
      if (!row || !db.prepare("select 1 from jobs where hash = ? and status in ('queued', 'working')").get(hash)) throw new Fail("not_found", 404);
      return fileResponse(o.store, row);
    });

    app.post("/api/worker/jobs/:id/progress", workerAuth, async (c) => {
      const job = workingJob(c.req.param("id"));
      const body = await readBody(c);
      const progress = Math.min(1, Math.max(0, Number(body.progress) || 0));
      const t = Date.now();
      db.prepare("update jobs set lease_until = ?, updated_at = ? where id = ?").run(t + lease, t, job.id);
      await memoState(job.object_id, (d) => setTranscription(d, { status: "working", progress, at: t }));
      return c.body(null, 204);
    });

    app.post("/api/worker/jobs/:id/done", workerAuth, async (c) => {
      const job = workingJob(c.req.param("id"));
      const body = await readBody(c);
      const result = text(body.text).trim().slice(0, 1_000_000);
      db.prepare("update jobs set status = 'done', error = null, updated_at = ? where id = ?").run(Date.now(), job.id);
      await memoState(job.object_id, (d) => {
        // (the memo might have had another recording put in meanwhile: then this text isn't its)
        if (readMemo(d).audio?.hash === job.hash) putTranscript(d, result, { language: text(body.language) || undefined, model: text(body.model) || undefined });
      });
      return c.body(null, 204);
    });

    app.post("/api/worker/jobs/:id/failed", workerAuth, async (c) => {
      const job = workingJob(c.req.param("id"));
      const body = await readBody(c);
      const error = text(body.error).slice(0, 500) || "unknown error";
      const again = body.retry !== false && job.tries < maxTries;
      const t = Date.now();
      db.prepare("update jobs set status = ?, error = ?, updated_at = ? where id = ?").run(again ? "queued" : "failed", error, t, job.id);
      await memoState(job.object_id, (d) => setTranscription(d, again ? { status: "queued", at: t } : { status: "failed", error, at: t }));
      if (again) wake();
      return c.body(null, 204);
    });

    /** Transcribe a memo (again): its owner or an editor, once its recording is on the server. */
    app.post("/api/objects/:id/transcribe", auth, async (c) => {
      const obj = objectRow(db, c.req.param("id"));
      if (!obj) throw new Fail("not_synced", 404);
      if (obj.deleted_at) throw new Fail("not_found", 404);
      const role = roleOf(db, obj.id, c.get("user").id);
      if (!role) throw new Fail("forbidden", 403);
      if (role === "viewer") throw new Fail("forbidden", 403);
      if (obj.type !== "memo") throw new Fail("wrong_type", 400);
      const hash = await sync.readObject("memo", obj.id, (d) => readMemo(d).audio?.hash ?? null);
      if (!hash || !fileRow(db, hash) || !db.prepare("select 1 from file_refs where object_id = ? and hash = ?").get(obj.id, hash)) throw new Fail("not_uploaded", 409);
      await enqueue(obj.id, hash);
      return c.body(null, 202);
    });

    app.get("/api/transcriber", auth, (c) => {
      const queued = (db.prepare("select count(*) as n from jobs where status in ('queued', 'working')").get() as { n: number }).n;
      const state = !o.workerToken ? "none" : polling > 0 || Date.now() - lastSeen < 60_000 ? "online" : "offline";
      return c.json({ state, queued } satisfies TranscriberInfo);
    });
  }

  return {
    routes,
    enqueue,

    /** A recording finished uploading: a memo that wants it transcribed gets its job. */
    onUploaded(obj: ObjectRow, hash: string) {
      if (obj.type !== "memo") return;
      void sync
        .readObject("memo", obj.id, (d) => {
          const m = readMemo(d);
          return m.audio?.hash === hash && m.transcription?.status === "wanted";
        })
        .then((wanted) => (wanted ? enqueue(obj.id, hash) : undefined))
        .catch((err) => console.error("jobs:", err));
    },

    /** Let waiting workers go (the server is stopping). */
    stop: wake,
  };
}
