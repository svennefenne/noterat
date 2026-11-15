import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addTransaction, findColumns, importRows, initBudget, monthSummary, parseCsv, readAmount, readBudget, readDate, receiptMatches, searchable, setPlan, spendingReport, suggestCategory, toTransactions, updateTransaction } from "../src";

const SWEDBANK = `* Transaktioner Period 2026-10-01 – 2026-11-14 Skapad 2026-11-14 18:02
Radnummer,Clearingnummer,Kontonummer,Produkt,Valuta,Bokföringsdag,Transaktionsdag,Valutadag,Referens,Beskrivning,Belopp,Bokfört saldo
1,8327-9,123456789,Privatkonto,SEK,2026-11-14,2026-11-13,2026-11-14,ICA NARA EKHAGEN,ICA NARA EKHAGEN,-129.25,10234.50
2,8327-9,123456789,Privatkonto,SEK,2026-11-12,2026-11-12,2026-11-12,SL,SL,-970.00,10363.75
3,8327-9,123456789,Privatkonto,SEK,2026-10-25,2026-10-25,2026-10-25,LÖN,LÖN,32500.00,11333.75
`;

const SEB = `Bokförd;Valutadatum;Verifikationsnummer;Text;Belopp;Saldo
2026-11-13;2026-11-13;5484381424;ICA NARA EKHAGEN;-129,25;1 234,50
2026-11-13;2026-11-13;5484381425;ICA NARA EKHAGEN;-129,25;1 105,25
`;

describe("a bank's CSV", () => {
  it("is read whatever its separator, and its rows found by their column names", () => {
    const rows = parseCsv(SWEDBANK);
    const { headerRow, columns } = findColumns(rows);
    expect(headerRow).toBe(1);
    const tx = toTransactions(rows, headerRow, columns!);
    expect(tx.map((t) => [t.date, t.amount, t.text])).toEqual([
      ["2026-11-13", -12925, "ICA NARA EKHAGEN"],
      ["2026-11-12", -97000, "SL"],
      ["2026-10-25", 3250000, "LÖN"],
    ]);
    // (two equal rows the same day are two purchases, and keep apart)
    const seb = parseCsv(SEB);
    const s = findColumns(seb);
    const st = toTransactions(seb, s.headerRow, s.columns!);
    expect(st).toHaveLength(2);
    expect(new Set(st.map((t) => t.key)).size).toBe(2);
  });

  it("amounts and dates in the ways banks write them", () => {
    expect(readAmount("-1 234,50")).toBe(-123450);
    expect(readAmount("1.234,50")).toBe(123450);
    expect(readAmount("−12.5 kr")).toBe(-1250);
    expect(readAmount("abc")).toBeNull();
    expect(readDate("14.11.2026")).toBe("2026-11-14");
    expect(readDate("20261114")).toBe("2026-11-14");
    expect(readDate("26-11-14")).toBe("2026-11-14");
  });
});

describe("a budget", () => {
  it("takes an import once, and suggests a category its text had before", () => {
    const doc = new Y.Doc();
    initBudget(doc, { title: "Hushållet", method: "envelope", by: 1 });
    const food = readBudget(doc).categories.find((c) => c.name === "Mat & hushåll")!.id;
    const rows = parseCsv(SWEDBANK);
    const { headerRow, columns } = findColumns(rows);
    expect(importRows(doc, toTransactions(rows, headerRow, columns!))).toEqual({ added: 3, skipped: 0 });
    expect(importRows(doc, toTransactions(rows, headerRow, columns!))).toEqual({ added: 0, skipped: 3 });
    const ica = readBudget(doc).transactions.find((t) => t.text.startsWith("ICA"))!;
    updateTransaction(doc, ica.id, { category: food });
    expect(suggestCategory(readBudget(doc), "ICA NARA EKHAGEN")).toBe(food);
  });

  it("carries what's left over to the next month (envelope), and sums a month up", () => {
    const doc = new Y.Doc();
    initBudget(doc, { title: "Hushållet", method: "envelope", by: 1 });
    const v = readBudget(doc);
    const food = v.categories.find((c) => c.name === "Mat & hushåll")!.id;
    const salary = v.categories.find((c) => c.name === "Lön")!.id;
    setPlan(doc, "2026-10", food, 600000);
    setPlan(doc, "2026-11", food, 600000);
    addTransaction(doc, { date: "2026-10-03", amount: -450000, text: "ICA", category: food });
    addTransaction(doc, { date: "2026-11-02", amount: -100000, text: "Coop", category: food });
    addTransaction(doc, { date: "2026-11-25", amount: 3250000, text: "Lön", category: salary });
    addTransaction(doc, { date: "2026-11-05", amount: -5000, text: "Okänd" });
    const nov = monthSummary(readBudget(doc), "2026-11");
    const f = nov.categories.find((c) => c.category.id === food)!;
    expect(f).toMatchObject({ planned: 600000, spent: 100000, available: 650000 });
    expect(nov).toMatchObject({ income: 3250000, spending: 105000, planned: 600000, toAssign: 2650000, uncategorized: 1 });
    expect(spendingReport(readBudget(doc), "2026-11", 2)).toEqual({ months: ["2026-10", "2026-11"], rows: [{ category: expect.objectContaining({ id: food }), perMonth: [450000, 100000] }] });
  });

  it("finds the transaction a receipt is", () => {
    const doc = new Y.Doc();
    initBudget(doc, { title: "H", method: "zero", by: 1 });
    const id = addTransaction(doc, { date: "2026-11-14", amount: -12925, text: "ICA NARA EKHAGEN" });
    addTransaction(doc, { date: "2026-11-01", amount: -12925, text: "ICA" });
    expect(receiptMatches(readBudget(doc), { date: "2026-11-13", total: 12925 }).map((t) => t.id)).toEqual([id]);
  });

  it("is searchable by what was bought", () => {
    const doc = new Y.Doc();
    initBudget(doc, { title: "Hushållet", method: "envelope", by: 1 });
    addTransaction(doc, { date: "2026-11-14", amount: -12925, text: "ICA Nära Ekhagen" });
    const s = searchable("budget", "b", doc);
    expect(s.title).toBe("Hushållet");
    expect(s.text).toContain("ICA Nära Ekhagen");
    expect(s.text).toContain("129,25");
  });
});
