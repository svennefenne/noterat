import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { formatAmount, initScan, parseAmount, putOcrResult, readReceipt, readScan, scanText, scanTitle, searchable, setReceipt, setScanKind } from "../src";

const h = (c: string) => c.repeat(64);
const page = (c: string, cropped = true) => ({ hash: h(c), type: "image/jpeg", width: 1000, height: 1500, cropped });

const ICA = `ICA Nära Ekhagen
Ekhagsvägen 12, 123 45 Stockholm
Org.nr 556677-8899
Kvitto 2026-11-14 17:42
Mjölk 1,5 l          16,90
Kaffe 500 g          59,90
Delsumma             76,80
Rabatt               -5,00
Totalt               71,80
Kort                 71,80
Moms 12%              7,69`;

const COOP = `COOP KONSUM
Tel 08-123 45 67
14.11.2026  09:12
BRÖD                 34,50
OST                 112,00
ATT BETALA:
  146,50 kr`;

const SYSTEMET = `Systembolaget
261114 1201
Vin 750 ml          1 129,00
Summa               1 129,00 SEK`;

describe("a receipt's text", () => {
  it("gives its shop, day and total", () => {
    expect(readReceipt(ICA)).toEqual({ shop: "ICA Nära Ekhagen", date: "2026-11-14", total: 7180 });
    expect(readReceipt(COOP)).toEqual({ shop: "COOP KONSUM", date: "2026-11-14", total: 14650 });
    expect(readReceipt(SYSTEMET)).toMatchObject({ shop: "Systembolaget", total: 112900 });
  });

  it("gives nothing it can't find", () => {
    expect(readReceipt("12\n---\n#")).toEqual({});
  });

  it("amounts go between öre and text both ways", () => {
    expect(formatAmount(7180)).toBe("71,80");
    expect(parseAmount("71,8")).toBe(7180);
    expect(parseAmount("1 129 kr")).toBe(112900);
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("a scan", () => {
  it("read on the phone is a receipt with its guess at once, and wants the worker's PDF", () => {
    const doc = new Y.Doc();
    initScan(doc, { kind: "receipt", pages: [page("a")], text: ICA, read: true, by: 1 });
    const s = readScan(doc);
    expect(s.receipt).toMatchObject({ shop: "ICA Nära Ekhagen", total: 7180 });
    expect(s.ocr?.status).toBe("wanted");
    expect(scanTitle(s, scanText(doc).toString())).toBe("ICA Nära Ekhagen");
    expect(searchable("scan", "s", doc).text).toContain("71,80");
  });

  it("gets the worker's cropped pages and PDF, and its text only when it has none", () => {
    const doc = new Y.Doc();
    initScan(doc, { kind: "document", pages: [page("a", false), page("b")], read: true, by: 1 });
    putOcrResult(doc, { text: "Hyresavtal\nLägenhet 3 rok", pages: [{ hash: h("c") }, { hash: h("b") }], pdf: { hash: h("d"), size: 9000 }, language: "swe+eng" });
    const s = readScan(doc);
    expect(s.pages.map((p) => [p.hash, p.cropped])).toEqual([
      [h("c"), true],
      [h("b"), true],
    ]);
    expect(s.pdf).toEqual({ hash: h("d"), size: 9000 });
    expect(scanText(doc).toString()).toBe("Hyresavtal\nLägenhet 3 rok");
    expect(s.ocr?.status).toBe("done");

    // read again: what's there stays
    putOcrResult(doc, { text: "något annat", pages: [{ hash: h("c") }, { hash: h("b") }], pdf: null });
    expect(scanText(doc).toString()).toBe("Hyresavtal\nLägenhet 3 rok");
  });

  it("keeps a receipt someone corrected", () => {
    const doc = new Y.Doc();
    initScan(doc, { kind: "document", pages: [page("a")], text: COOP, read: false, by: 1 });
    expect(readScan(doc).receipt).toBeNull();
    setScanKind(doc, "receipt");
    expect(readScan(doc).receipt).toMatchObject({ shop: "COOP KONSUM", total: 14650 });
    setReceipt(doc, { total: 15000 });
    expect(readScan(doc).receipt).toMatchObject({ shop: "COOP KONSUM", total: 15000, edited: true });
  });
});
