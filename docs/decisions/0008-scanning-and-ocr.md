# 8. Scanning on the phone, reading text twice, and receipts suggested from it

Date: 2026-11-15 · Status: accepted (phase 4)

## Context

Phase 4 brings the scanner: a photographed document or receipt should be cropped by itself, straightened,
and become searchable text, and a receipt should suggest its shop, date and total (for the budget in
phase 7). Both phones are Android; the app also runs as a website.

## Decision

### A scan is a document of its own

`scan/<id>`: `meta` (title, `kind`: `document` or `receipt`, createdBy, createdAt), `pages` (a `Y.Array` of
`{ hash, type, width, height, cropped }`, the page images as files by hash, decision 6), `text` (a
`Y.Text`: what the pages say, which people can correct), `ocr` (how the reading is coming along, as a
memo's transcription), `pdf` (the searchable PDF's file, once there is one) and `receipt` (the shop, day
and total suggested from the text, which people can correct; amounts in öre).

### On the phone: ML Kit

- **Capture**: ML Kit's document scanner (`@capacitor-mlkit/document-scanner`): it finds the page's
  edges, suggests a crop to accept or adjust, straightens the page, and can take pages from the gallery.
  Its pages are `cropped: true`.
- **Text at once**: ML Kit's text recognition (`@capacitor-mlkit/text-recognition`) reads each page on
  the phone, offline too, so the scan is searchable straight away and a receipt's suggestion shows at
  once.

### On the web, and for everything: the worker

- A photo taken or picked on the website is uploaded as it is (`cropped: false`). The worker finds the
  page in it and straightens it (OpenCV), conservatively: when it can't find a clear page, it leaves the
  photo as it is.
- The worker **reads every scan** with Tesseract (Swedish and English) through OCRmyPDF and makes a
  **searchable PDF** of its pages. Its text goes into the scan only if the scan has none yet (the phone's
  ML Kit reads receipts better than Tesseract, and what someone corrected stays).
- **Receipts** are read the same way on both sides: core's `receipts.ts` finds the shop, the day and the
  total in the text.

### The worker's protocol, for scans

The same as for transcription (decision 6), with:

| Request | Answer |
|---|---|
| `POST /api/worker/next` `{ worker, kinds: ["transcribe", "ocr"], model }` | Only kinds the worker names (one that says only `transcribe` gets no OCR jobs). An OCR job: `{ id, kind: "ocr", files: [{ hash, type, size }], language: "swe+eng", crop: [bool per file] }`; `crop` is true for a photo that isn't a cropped page yet. |
| `GET /api/worker/files/:hash` | Any file of a job that's waiting or being done. |
| `PUT /api/worker/jobs/:id/files` (the bytes; `Content-Type`) | `200 { hash, size, type }`: the server keeps the file (a cropped page, the PDF), and the job's thing refers to it. `409` if the job isn't the worker's any more. |
| `POST /api/worker/jobs/:id/done` `{ text, language?, pages: [{ hash, text }], pdf: { hash } \| null }` | `pages` in the job's order: each page's hash (a new one if the worker cropped it) and its text. |

Progress, failing, leases and retries are as for transcription.

## Consequences

- On the phone a receipt is cropped, straightened and searchable before it has even been uploaded; the
  PDF follows when the worker has had it.
- On the website scanning works too, with the cropping done by the worker, a little later.
- The worker image grows by Tesseract with Swedish, OCRmyPDF and OpenCV.
- Two more native plugins in the Android app (Google Play services' ML Kit, which downloads its scanner
  module on first use).
