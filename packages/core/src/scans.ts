import * as Y from "yjs";
import { firstLine } from "./docs";
import type { Transcription, TranscriptionStatus } from "./memos";
import { readReceipt, type ReceiptGuess } from "./receipts";

/**
 * A scanned document or receipt (decision 8). Its document:
 *
 * - meta: title (may be empty), kind ("document" or "receipt"), createdBy, createdAt
 * - pages: a Y.Array of page images, by their file's hash; cropped: whether it's a straightened page
 *   already (the phone's scanner does it; a photo from the website waits for the worker)
 * - text: a Y.Text, what the pages say (the phone's reading at once, else the worker's), correctable
 * - ocr: how the worker's reading is coming along (as a memo's transcription)
 * - pdf: the searchable PDF the worker made of the pages
 * - receipt: the shop, day and total suggested from the text; edited once someone has changed it
 */

export type ScanKind = "document" | "receipt";

export interface Page {
  hash: string;
  type: string;
  width: number;
  height: number;
  cropped: boolean;
}

export interface Receipt extends ReceiptGuess {
  /** someone has corrected it: new readings don't replace it */
  edited?: boolean;
}

export interface ScanView {
  title: string;
  kind: ScanKind;
  createdBy: number | null;
  createdAt: number;
  pages: Page[];
  pdf: { hash: string; size: number } | null;
  ocr: Transcription | null;
  receipt: Receipt | null;
}

export const SCAN_TITLE_MAX = 120;
export const MAX_PAGES = 30;

const meta = (doc: Y.Doc) => doc.getMap<unknown>("meta");
const pagesArray = (doc: Y.Doc) => doc.getArray<Page>("pages");
const ocrMap = (doc: Y.Doc) => doc.getMap<unknown>("ocr");
const pdfMap = (doc: Y.Doc) => doc.getMap<unknown>("pdf");
const receiptMap = (doc: Y.Doc) => doc.getMap<unknown>("receipt");
export const scanText = (doc: Y.Doc) => doc.getText("text");

const STATUSES: TranscriptionStatus[] = ["wanted", "queued", "working", "done", "failed"];

export function initScan(doc: Y.Doc, o: { title?: string; kind: ScanKind; pages: Page[]; text?: string; read: boolean; by: number }) {
  doc.transact(() => {
    meta(doc).set("title", (o.title ?? "").replace(/\s+/g, " ").trim().slice(0, SCAN_TITLE_MAX));
    meta(doc).set("kind", o.kind);
    meta(doc).set("createdBy", o.by);
    meta(doc).set("createdAt", Date.now());
    pagesArray(doc).push(o.pages.slice(0, MAX_PAGES));
    if (o.text?.trim()) {
      scanText(doc).insert(0, o.text.trim());
      if (o.kind === "receipt") suggestReceipt(doc, o.text);
    }
    if (o.read) setOcrState(doc, { status: "wanted", at: Date.now() });
  });
}

export function readScan(doc: Y.Doc): ScanView {
  const m = meta(doc);
  const title = m.get("title");
  const by = m.get("createdBy");
  const at = m.get("createdAt");
  const o = ocrMap(doc);
  const status = o.get("status") as TranscriptionStatus;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const pdfHash = pdfMap(doc).get("hash");
  const r = receiptMap(doc);
  return {
    title: typeof title === "string" ? title : "",
    kind: m.get("kind") === "receipt" ? "receipt" : "document",
    createdBy: typeof by === "number" ? by : null,
    createdAt: typeof at === "number" ? at : 0,
    pages: pagesArray(doc)
      .toArray()
      .filter((p) => p && typeof p.hash === "string"),
    pdf: typeof pdfHash === "string" ? { hash: pdfHash, size: Number(pdfMap(doc).get("size")) || 0 } : null,
    ocr: STATUSES.includes(status)
      ? {
          status,
          progress: typeof o.get("progress") === "number" ? (o.get("progress") as number) : undefined,
          language: str(o.get("language")),
          error: str(o.get("error")),
          at: Number(o.get("at")) || 0,
        }
      : null,
    receipt: r.size
      ? {
          shop: str(r.get("shop")),
          date: str(r.get("date")),
          total: typeof r.get("total") === "number" ? (r.get("total") as number) : undefined,
          edited: r.get("edited") === true,
        }
      : null,
  };
}

export function setScanTitle(doc: Y.Doc, title: string) {
  meta(doc).set("title", title.replace(/\s+/g, " ").trim().slice(0, SCAN_TITLE_MAX));
}

export function setScanKind(doc: Y.Doc, kind: ScanKind) {
  doc.transact(() => {
    meta(doc).set("kind", kind);
    if (kind === "receipt" && !readScan(doc).receipt) suggestReceipt(doc, scanText(doc).toString());
  });
}

/** How the worker's reading stands, as a whole (what isn't given is cleared). */
export function setOcrState(doc: Y.Doc, t: Transcription) {
  const map = ocrMap(doc);
  doc.transact(() => {
    for (const k of [...map.keys()]) if (!(k in t)) map.delete(k);
    for (const [k, v] of Object.entries(t)) if (v !== undefined) map.set(k, v);
  });
}

/** A receipt's guess from its text, unless someone has corrected it. */
export function suggestReceipt(doc: Y.Doc, text: string) {
  const r = receiptMap(doc);
  if (r.get("edited") === true) return;
  const g = readReceipt(text);
  doc.transact(() => {
    for (const k of ["shop", "date", "total"] as const) {
      if (g[k] !== undefined) r.set(k, g[k]);
      else r.delete(k);
    }
  });
}

/** Someone corrected the receipt: kept as they wrote it from now on. */
export function setReceipt(doc: Y.Doc, patch: ReceiptGuess) {
  const r = receiptMap(doc);
  doc.transact(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "") r.delete(k);
      else r.set(k, v);
    }
    r.set("edited", true);
  });
}

/**
 * The worker's reading: pages it cropped get their new image, the PDF is kept, and its text goes in
 * if the scan has none yet (the phone's, or what someone wrote, stays).
 */
export function putOcrResult(
  doc: Y.Doc,
  r: { text: string; pages: { hash: string; width?: number; height?: number }[]; pdf: { hash: string; size: number } | null; language?: string },
) {
  doc.transact(() => {
    const arr = pagesArray(doc);
    const now = arr.toArray();
    r.pages.forEach((p, i) => {
      const was = now[i];
      // (a page the worker cropped is a new image; one where it found no page stays as it was)
      if (was && p.hash && p.hash !== was.hash) {
        arr.delete(i, 1);
        arr.insert(i, [{ ...was, hash: p.hash, type: "image/jpeg", cropped: true, width: p.width || was.width, height: p.height || was.height }]);
      }
    });
    if (r.pdf) {
      pdfMap(doc).set("hash", r.pdf.hash);
      pdfMap(doc).set("size", r.pdf.size);
    }
    const text = scanText(doc);
    if (!text.toString().trim() && r.text.trim()) {
      text.insert(0, r.text.trim());
      if (readScan(doc).kind === "receipt") suggestReceipt(doc, r.text);
    }
    setOcrState(doc, { status: "done", language: r.language, at: Date.now() });
  });
}

/** What a scan is called: its title, else a receipt's shop, else its text's first line. */
export function scanTitle(scan: ScanView, text: string): string {
  return scan.title || (scan.kind === "receipt" && scan.receipt?.shop) || firstLine(text, 80);
}
