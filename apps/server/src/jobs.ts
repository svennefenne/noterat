import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
  canTranscribe,
  MAX_FILE_SIZE,
  putOcrResult,
  putTranscriptFor,
  readScan,
  recordingToTranscribe,
  setImportState,
  setOcrState,
  setTranscriptState,
  wantsTranscript,
  type JobKind,
  type TranscriberInfo,
  type Transcription,
  type WorkerJob,
} from "@noterat/core";
import type { DB } from "./db";
import { fileResponse, fileRow, keepFile, type FileStore } from "./files";
import { Fail, readBody, signedIn, text, type Env } from "./http";
import { objectRow, roleOf, type ObjectRow } from "./objects";
import type { Sync } from "./sync";

/**
 * Speech to text: jobs for the worker (decisions 6 and 7). A recording in a voice memo or a journal
 * entry, once it's on the server, gets a job; the worker asks for work (waiting up to `wait` for some),
 * says how far it's got, and hands back the text, which the server writes into the thing's document
 * (core's transcripts.ts says where), so it shows on every device at once. A scan's pages get a job
 * of the other kind, "ocr" (decision 8): the worker crops what isn't cropped yet, reads the pages,
 * and sends back the cropped pages and a searchable PDF as files of their own.
 * The worker has a job for `lease` from its last word; one that goes quiet longer loses it, and the job
 * is queued again (up to `maxTries` tries in all).
 */

interface JobRow {
  id: string;
  kind: JobKind;
  object_id: string;
  /** a transcription's recording; an OCR job's first page (the files are in files) */
  hash: string;
  files: string | null;
  /** JSON: a recipe job's { url } */
  input: string | null;
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
  /** what scans are read in ("swe+eng") */
  ocrLanguage?: string;
  /** a recipe the worker read, to be put in its document (recipes.ts) */
  onRecipe?: (objectId: string, recipe: Record<string, unknown>) => Promise<void>;
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

  /** Write how a job stands into its thing (unless that's been deleted meanwhile): a recording's transcription, a scan's reading. */
  async function stateOf(job: { object_id: string; hash: string; kind: JobKind }, t: Transcription) {
    const obj = objectRow(db, job.object_id);
    if (!obj || obj.deleted_at) return;
    if (job.kind === "ocr") {
      if (obj.type === "scan") await sync.changeObject("scan", obj.id, (d) => setOcrState(d, t));
    } else if (job.kind === "recipe") {
      if (obj.type === "recipe") await sync.changeObject("recipe", obj.id, (d) => setImportState(d, t));
    } else if (canTranscribe(obj.type)) await sync.changeObject(obj.type, obj.id, (d) => setTranscriptState(obj.type, d, job.hash, t));
  }

  const filesOf = (job: JobRow): { hash: string; crop: boolean }[] => (job.files ? (JSON.parse(job.files) as { hash: string; crop: boolean }[]) : [{ hash: job.hash, crop: false }]);

  /** Queue a recording to be transcribed (once: a job already waiting or working is kept). */
  async function enqueue(objectId: string, hash: string) {
    const had = db.prepare("select id from jobs where object_id = ? and hash = ? and status in ('queued', 'working')").get(objectId, hash);
    if (had) return;
    const t = Date.now();
    db.prepare("insert into jobs (id, kind, object_id, hash, files, language, status, created_at, updated_at) values (?, 'transcribe', ?, ?, ?, ?, 'queued', ?, ?)").run(
      randomUUID(),
      objectId,
      hash,
      JSON.stringify([{ hash, crop: false }]),
      o.language === "auto" ? null : o.language,
      t,
      t,
    );
    await stateOf({ object_id: objectId, hash, kind: "transcribe" }, { status: "queued", at: t });
    wake();
  }

  /** Queue a scan's pages to be read (once: a job already waiting or working is kept). */
  async function enqueueOcr(objectId: string, pages: { hash: string; crop: boolean }[]) {
    if (!pages.length) return;
    const had = db.prepare("select id from jobs where object_id = ? and kind = 'ocr' and status in ('queued', 'working')").get(objectId);
    if (had) return;
    const t = Date.now();
    db.prepare("insert into jobs (id, kind, object_id, hash, files, language, status, created_at, updated_at) values (?, 'ocr', ?, ?, ?, ?, 'queued', ?, ?)").run(
      randomUUID(),
      objectId,
      pages[0]!.hash,
      JSON.stringify(pages),
      o.ocrLanguage ?? "swe+eng",
      t,
      t,
    );
    await stateOf({ object_id: objectId, hash: pages[0]!.hash, kind: "ocr" }, { status: "queued", at: t });
    wake();
  }

  /** A recipe page the server couldn't read itself, for the worker (recipe-scrapers). */
  async function enqueueRecipe(objectId: string, htmlHash: string, url: string) {
    db.prepare("update jobs set status = 'cancelled', updated_at = ? where object_id = ? and kind = 'recipe' and status = 'queued'").run(Date.now(), objectId);
    const t = Date.now();
    db.prepare("insert into jobs (id, kind, object_id, hash, files, input, status, created_at, updated_at) values (?, 'recipe', ?, ?, ?, ?, 'queued', ?, ?)").run(
      randomUUID(),
      objectId,
      htmlHash,
      JSON.stringify([{ hash: htmlHash, crop: false }]),
      JSON.stringify({ url }),
      t,
      t,
    );
    await stateOf({ object_id: objectId, hash: htmlHash, kind: "recipe" }, { status: "queued", at: t });
    wake();
  }

  /** A scan that wants reading, once all its pages are on the server. */
  async function scanReady(objectId: string) {
    const pages = await sync.readObject("scan", objectId, (d) => {
      const s = readScan(d);
      return s.ocr?.status === "wanted" ? s.pages : null;
    });
    if (pages?.length && pages.every((p) => fileRow(db, p.hash))) await enqueueOcr(objectId, pages.map((p) => ({ hash: p.hash, crop: !p.cropped })));
  }

  /** Jobs whose worker went quiet: queued again, or failed after the last try. */
  function expire() {
    const t = Date.now();
    const lost = db.prepare("select * from jobs where status = 'working' and lease_until < ?").all(t) as JobRow[];
    for (const job of lost) {
      const again = job.tries < maxTries;
      db.prepare("update jobs set status = ?, error = 'the worker stopped answering', updated_at = ? where id = ?").run(again ? "queued" : "failed", t, job.id);
      void stateOf(job, again ? { status: "queued", at: t } : { status: "failed", error: "the worker stopped answering", at: t }).catch((err) => console.error("jobs:", err));
    }
  }

  /** The oldest waiting job of a kind the worker does, now this worker's. */
  function take(worker: string, kinds: JobKind[]): WorkerJob | null {
    expire();
    if (!kinds.length) return null;
    return db.transaction(() => {
      const job = db.prepare(`select * from jobs where status = 'queued' and kind in (${kinds.map(() => "?").join(",")}) order by created_at limit 1`).get(...kinds) as
        | JobRow
        | undefined;
      if (!job) return null;
      const wanted = filesOf(job);
      const files = wanted.map((f) => fileRow(db, f.hash));
      const t = Date.now();
      if (files.some((f) => !f)) {
        db.prepare("update jobs set status = 'failed', error = 'a file is missing', updated_at = ? where id = ?").run(t, job.id);
        return null;
      }
      db.prepare("update jobs set status = 'working', tries = tries + 1, worker = ?, lease_until = ?, updated_at = ? where id = ?").run(worker, t + lease, t, job.id);
      const ok = files.map((f) => ({ hash: f!.hash, type: f!.type, size: f!.size }));
      if (job.kind === "ocr") return { id: job.id, kind: "ocr" as const, files: ok, language: job.language ?? "swe+eng", crop: wanted.map((f) => f.crop) };
      if (job.kind === "recipe") return { id: job.id, kind: "recipe" as const, files: ok, url: String((JSON.parse(job.input ?? "{}") as { url?: unknown }).url ?? "") };
      return { id: job.id, kind: "transcribe" as const, file: ok[0]!, language: job.language };
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
      // (a worker from before scans says only "transcribe", or nothing)
      const kinds = (Array.isArray(body.kinds) ? body.kinds : ["transcribe"]).filter((k): k is JobKind => k === "transcribe" || k === "ocr" || k === "recipe");
      if (!kinds.length) return c.body(null, 204);
      let job = take(worker, kinds);
      if (!job) {
        polling++;
        try {
          await waitForWork(c.req.raw.signal);
        } finally {
          polling--;
          lastSeen = Date.now();
        }
        if (c.req.raw.signal.aborted) return c.body(null, 204);
        job = take(worker, kinds);
      }
      if (!job) return c.body(null, 204);
      await stateOf(jobRow(job.id)!, { status: "working", progress: 0, at: Date.now() });
      return c.json({ job });
    });

    // (only a file of a job waiting or being done)
    app.get("/api/worker/files/:hash", workerAuth, (c) => {
      const hash = c.req.param("hash");
      const row = fileRow(db, hash);
      const ofAJob = db
        .prepare(
          `select 1 from jobs where status in ('queued', 'working')
           and (hash = ? or exists (select 1 from json_each(jobs.files) where json_extract(json_each.value, '$.hash') = ?)) limit 1`,
        )
        .get(hash, hash);
      if (!row || !ofAJob) throw new Fail("not_found", 404);
      return fileResponse(o.store, row);
    });

    /** A file the worker made for a job (a cropped page, a PDF): kept, and the job's thing refers to it. */
    app.put("/api/worker/jobs/:id/files", workerAuth, async (c) => {
      const job = workingJob(c.req.param("id"));
      if (Number(c.req.header("content-length") ?? 0) > MAX_FILE_SIZE) throw new Fail("file_too_large", 413);
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_FILE_SIZE) throw new Fail("bad_request", 400);
      return c.json(keepFile(db, o.store, bytes, c.req.header("content-type") ?? "", job.object_id));
    });

    app.post("/api/worker/jobs/:id/progress", workerAuth, async (c) => {
      const job = workingJob(c.req.param("id"));
      const body = await readBody(c);
      const progress = Math.min(1, Math.max(0, Number(body.progress) || 0));
      const t = Date.now();
      db.prepare("update jobs set lease_until = ?, updated_at = ? where id = ?").run(t + lease, t, job.id);
      await stateOf(job, { status: "working", progress, at: t });
      return c.body(null, 204);
    });

    app.post("/api/worker/jobs/:id/done", workerAuth, async (c) => {
      const job = workingJob(c.req.param("id"));
      const body = await readBody(c);
      const result = text(body.text).trim().slice(0, 1_000_000);
      const obj = objectRow(db, job.object_id);
      if (job.kind === "recipe") {
        const recipe = body.recipe && typeof body.recipe === "object" ? (body.recipe as Record<string, unknown>) : null;
        if (!recipe) throw new Fail("bad_request", 400);
        db.prepare("update jobs set status = 'done', error = null, updated_at = ? where id = ?").run(Date.now(), job.id);
        if (obj && !obj.deleted_at && obj.type === "recipe") await o.onRecipe?.(obj.id, recipe);
        return c.body(null, 204);
      }
      if (job.kind === "ocr") {
        // (the pages and the PDF are files the server has: the scan's own, or ones the worker sent)
        const pages = (Array.isArray(body.pages) ? body.pages : []).map((p: unknown) => {
          const q = (p ?? {}) as { hash?: unknown; width?: unknown; height?: unknown };
          return { hash: text(q.hash), width: Number(q.width) || undefined, height: Number(q.height) || undefined };
        });
        const pdfHash = text((body.pdf as { hash?: unknown } | null)?.hash);
        if (pages.length !== filesOf(job).length || pages.some((p: { hash: string }) => !fileRow(db, p.hash)) || (pdfHash && !fileRow(db, pdfHash))) throw new Fail("bad_request", 400);
        db.prepare("update jobs set status = 'done', error = null, updated_at = ? where id = ?").run(Date.now(), job.id);
        if (obj && !obj.deleted_at && obj.type === "scan")
          await sync.changeObject("scan", obj.id, (d) =>
            putOcrResult(d, { text: result, pages, pdf: pdfHash ? { hash: pdfHash, size: fileRow(db, pdfHash)!.size } : null, language: text(body.language) || undefined }),
          );
        return c.body(null, 204);
      }
      db.prepare("update jobs set status = 'done', error = null, updated_at = ? where id = ?").run(Date.now(), job.id);
      if (obj && !obj.deleted_at && canTranscribe(obj.type))
        await sync.changeObject(obj.type, obj.id, (d) =>
          putTranscriptFor(obj.type, d, job.hash, result, { language: text(body.language) || undefined, model: text(body.model) || undefined }),
        );
      return c.body(null, 204);
    });

    app.post("/api/worker/jobs/:id/failed", workerAuth, async (c) => {
      const job = workingJob(c.req.param("id"));
      const body = await readBody(c);
      const error = text(body.error).slice(0, 500) || "unknown error";
      const again = body.retry !== false && job.tries < maxTries;
      const t = Date.now();
      db.prepare("update jobs set status = ?, error = ?, updated_at = ? where id = ?").run(again ? "queued" : "failed", error, t, job.id);
      await stateOf(job, again ? { status: "queued", at: t } : { status: "failed", error, at: t });
      if (again) wake();
      return c.body(null, 204);
    });

    /**
     * Transcribe a recording (again): a memo's, or (with { hash }) a journal entry's clip; by its owner or
     * an editor, once the recording is on the server.
     */
    app.post("/api/objects/:id/transcribe", auth, async (c) => {
      const body = await readBody(c).catch(() => ({}) as Record<string, unknown>);
      const obj = objectRow(db, c.req.param("id"));
      if (!obj) throw new Fail("not_synced", 404);
      if (obj.deleted_at) throw new Fail("not_found", 404);
      const role = roleOf(db, obj.id, c.get("user").id);
      if (!role) throw new Fail("forbidden", 403);
      if (role === "viewer") throw new Fail("forbidden", 403);
      if (!canTranscribe(obj.type)) throw new Fail("wrong_type", 400);
      const hash = await sync.readObject(obj.type, obj.id, (d) => recordingToTranscribe(obj.type, d, text(body.hash) || undefined));
      if (!hash || !fileRow(db, hash) || !db.prepare("select 1 from file_refs where object_id = ? and hash = ?").get(obj.id, hash)) throw new Fail("not_uploaded", 409);
      await enqueue(obj.id, hash);
      return c.body(null, 202);
    });

    /** Read a scan (again): its owner or an editor, once its pages are on the server. */
    app.post("/api/objects/:id/ocr", auth, async (c) => {
      const obj = objectRow(db, c.req.param("id"));
      if (!obj) throw new Fail("not_synced", 404);
      if (obj.deleted_at) throw new Fail("not_found", 404);
      const role = roleOf(db, obj.id, c.get("user").id);
      if (!role || role === "viewer") throw new Fail("forbidden", 403);
      if (obj.type !== "scan") throw new Fail("wrong_type", 400);
      const pages = await sync.readObject("scan", obj.id, (d) => readScan(d).pages);
      if (!pages.length || pages.some((p) => !fileRow(db, p.hash))) throw new Fail("not_uploaded", 409);
      await enqueueOcr(
        obj.id,
        pages.map((p) => ({ hash: p.hash, crop: !p.cropped })),
      );
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
    enqueueRecipe,
    /** whether there's a worker to give jobs to at all */
    hasWorker: () => !!o.workerToken,

    /** A file finished uploading: a thing that wants it transcribed, or a scan whose pages are all in, gets its job. */
    onUploaded(obj: ObjectRow, hash: string) {
      if (obj.type === "scan") return void scanReady(obj.id).catch((err) => console.error("jobs:", err));
      if (!canTranscribe(obj.type)) return;
      void sync
        .readObject(obj.type, obj.id, (d) => wantsTranscript(obj.type, d, hash))
        .then((wanted) => (wanted ? enqueue(obj.id, hash) : undefined))
        .catch((err) => console.error("jobs:", err));
    },

    /** Let waiting workers go (the server is stopping). */
    stop: wake,
  };
}
