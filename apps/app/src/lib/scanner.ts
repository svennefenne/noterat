import { Capacitor } from "@capacitor/core";
import { DocumentScanner } from "@capacitor-mlkit/document-scanner";
import { TextRecognition } from "@capacitor-mlkit/text-recognition";
import { MAX_PAGES } from "@noterat/core";
import { isNative } from "./api";
import { shrinkPhoto } from "./images";

/**
 * Scanning (decision 8). In the Android app: ML Kit's document scanner, which finds the page's edges,
 * lets you adjust the crop, straightens the page (and takes pages from the gallery too), and ML Kit's
 * text recognition, which reads each page on the phone, offline too. On the website: photos as they
 * are, a little smaller, for the worker to crop and read.
 */

export interface ScannedPage {
  blob: Blob;
  width: number;
  height: number;
  /** a straightened page already (else the worker looks for the page in the photo) */
  cropped: boolean;
  /** what the phone read on it ("" when it didn't) */
  text: string;
}

export const canScanOnPhone = isNative && Capacitor.getPlatform() === "android";

/** ML Kit's scanner comes from Google Play services; the first time, it may have to be downloaded. */
async function scannerReady(): Promise<void> {
  if ((await DocumentScanner.isGoogleDocumentScannerModuleAvailable()).available) return;
  await DocumentScanner.installGoogleDocumentScannerModule();
  for (let i = 0; i < 120; i++) {
    if ((await DocumentScanner.isGoogleDocumentScannerModuleAvailable()).available) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the scanner couldn't be installed");
}

/** Scan with the phone's camera (or gallery). An empty list: cancelled. */
export async function scanOnPhone(): Promise<ScannedPage[]> {
  await scannerReady();
  let uris: string[];
  try {
    uris = (await DocumentScanner.scanDocument({ galleryImportAllowed: true, pageLimit: MAX_PAGES, resultFormats: "JPEG", scannerMode: "FULL" })).scannedImages ?? [];
  } catch (err) {
    if (/cancel/i.test(String((err as Error)?.message ?? err))) return [];
    throw err;
  }
  const pages: ScannedPage[] = [];
  for (const uri of uris) {
    const blob = await (await fetch(Capacitor.convertFileSrc(uri))).blob();
    const bitmap = await createImageBitmap(blob);
    const text = await TextRecognition.processImage({ path: uri }).then(
      (r) => r.text,
      () => "",
    );
    pages.push({ blob, width: bitmap.width, height: bitmap.height, cropped: true, text });
    bitmap.close();
  }
  return pages;
}

/** Photos picked or taken on the website: kept large enough to read (3000 px), for the worker. */
export async function photosAsPages(files: File[]): Promise<ScannedPage[]> {
  const pages: ScannedPage[] = [];
  for (const f of files.slice(0, MAX_PAGES)) {
    const shrunk = await shrinkPhoto(f, 3000, 0.9);
    if (shrunk) pages.push({ ...shrunk, cropped: false, text: "" });
  }
  return pages;
}
