import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { initScan, newObjectId, objectDocName, readScan, scanText, type ShareReply, type WorkerJob } from "@noterat/core";
import { account, call, device, sha, startServer, synced, until, upload, worker, WORKER } from "./helpers";

/**
 * Scans on the server (decision 8): once all of a scan's pages are in, the worker gets an OCR job, crops
 * what isn't cropped, sends back the cropped pages and a PDF as files of their own, and its text goes
 * into the scan on the devices, unless the phone read it already. The worker here is the test.
 */

type OcrJob = Extract<WorkerJob, { kind: "ocr" }>;

async function nextOcr(base: string, kinds = ["transcribe", "ocr"]): Promise<OcrJob | null> {
  const res = await worker(base, "/next", { worker: "test", kinds });
  if (res.status === 204) return null;
  return ((await res.json()) as { job: OcrJob }).job;
}

const sendFile = (base: string, jobId: string, bytes: Uint8Array, type: string) =>
  fetch(`${base}/api/worker/jobs/${jobId}/files`, { method: "PUT", headers: { Authorization: `Bearer ${WORKER}`, "Content-Type": type }, body: bytes }).then(
    (r) => r.json() as Promise<{ hash: string; size: number; type: string }>,
  );

async function scanned(o: { text?: string; kind?: "receipt" | "document" } = {}) {
  const { db, base } = await startServer({ workerToken: WORKER });
  const ada = await account(db, "ada");
  const bo = await account(db, "bo");
  const photo = new Uint8Array(randomBytes(3000));
  const cropped = new Uint8Array(randomBytes(2000));
  const id = newObjectId();
  const scan = device(base, ada.token)(objectDocName("scan", id));
  initScan(scan.doc, {
    kind: o.kind ?? "receipt",
    pages: [
      { hash: sha(photo), type: "image/jpeg", width: 3000, height: 4000, cropped: false },
      { hash: sha(cropped), type: "image/jpeg", width: 1200, height: 1800, cropped: true },
    ],
    text: o.text,
    read: true,
    by: ada.user.id,
  });
  await synced(scan.provider);
  return { base, ada, bo, id, scan, photo, cropped };
}

describe("a scan", () => {
  it("is read once all its pages are in: cropped, a PDF made, its text and receipt in the scan", async () => {
    const { base, ada, bo, id, scan, photo, cropped } = await scanned();
    await upload(base, ada.token, id, photo);
    // (one page in isn't enough)
    expect(await nextOcr(base)).toBeNull();
    await upload(base, ada.token, id, cropped);
    await until(() => readScan(scan.doc).ocr?.status === "queued", "the scan to be queued");

    // a worker from before scans gets no OCR job
    expect(await nextOcr(base, ["transcribe"])).toBeNull();
    const job = (await nextOcr(base))!;
    expect(job).toMatchObject({ kind: "ocr", language: "swe+eng", crop: [true, false] });
    expect(job.files.map((f) => f.hash)).toEqual([sha(photo), sha(cropped)]);
    await until(() => readScan(scan.doc).ocr?.status === "working", "the scan to be worked on");
    for (const f of job.files) expect((await worker(base, `/files/${f.hash}`)).status).toBe(200);

    const page = await sendFile(base, job.id, new Uint8Array(randomBytes(1500)), "image/jpeg");
    const pdf = await sendFile(base, job.id, new Uint8Array(randomBytes(5000)), "application/pdf");
    expect(pdf).toMatchObject({ size: 5000, type: "application/pdf" });
    const text = "ICA Nära Ekhagen\n2026-11-14\nTotalt 71,80";
    const done = await worker(base, `/jobs/${job.id}/done`, { text, language: "swe+eng", pages: [{ hash: page.hash, text, cropped: true, width: 1100, height: 2400 }, { hash: sha(cropped), text: "", cropped: true, width: 1200, height: 1800 }], pdf: { hash: pdf.hash }, model: "tesseract 5.5.0" });
    expect(done.status).toBe(204);

    await until(() => readScan(scan.doc).ocr?.status === "done", "the scan to be read");
    const s = readScan(scan.doc);
    expect(s.pages.map((p) => [p.hash, p.cropped, p.width, p.height])).toEqual([
      [page.hash, true, 1100, 2400],
      [sha(cropped), true, 1200, 1800],
    ]);
    expect(s.pdf).toEqual({ hash: pdf.hash, size: 5000 });
    expect(scanText(scan.doc).toString()).toBe(text);
    expect(s.receipt).toMatchObject({ shop: "ICA Nära Ekhagen", date: "2026-11-14", total: 7180 });

    // the worker's files belong to the scan: someone it's shared with can read them
    const shared = await call<ShareReply>(base, "POST", `/api/objects/${id}/share`, ada.token, { role: "viewer", userId: bo.user.id });
    await call(base, "POST", `/api/invitations/${shared.json.kind === "invitation" ? shared.json.id : ""}/accept`, bo.token);
    for (const h of [page.hash, pdf.hash]) expect((await fetch(`${base}/api/files/${h}`, { headers: { Authorization: `Bearer ${bo.token}` } })).status).toBe(200);
  });

  it("keeps the phone's text, turns down pages that aren't files, and can be read again", async () => {
    const { base, ada, id, scan, photo, cropped } = await scanned({ text: "Läst på telefonen", kind: "document" });
    await upload(base, ada.token, id, photo);
    await upload(base, ada.token, id, cropped);
    const job = (await nextOcr(base))!;
    expect((await worker(base, `/jobs/${job.id}/done`, { text: "x", pages: [{ hash: "0".repeat(64) }, { hash: sha(cropped) }], pdf: null })).status).toBe(400);
    expect((await worker(base, `/jobs/${job.id}/done`, { text: "Läst av workern", pages: [{ hash: sha(photo) }, { hash: sha(cropped) }], pdf: null })).status).toBe(204);
    await until(() => readScan(scan.doc).ocr?.status === "done", "the scan to be read");
    expect(scanText(scan.doc).toString()).toBe("Läst på telefonen");

    expect((await call(base, "POST", `/api/objects/${id}/ocr`, ada.token)).status).toBe(202);
    expect((await nextOcr(base))?.kind).toBe("ocr");
  });
});
