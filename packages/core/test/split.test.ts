import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addExpense,
  addPayment,
  addPerson,
  balances,
  expenseFromReceipt,
  formatPhone,
  initSplit,
  readSplit,
  removePerson,
  settle,
  sharesOf,
  splitTotal,
  swishLink,
  updateExpense,
  swishMessage,
  swishNumber,
  swishQrText,
} from "../src";

/** The trip in the sketches: four people, five expenses, 13 904,50 kr. */
function trip() {
  const doc = new Y.Doc();
  initSplit(doc, { title: "Fjällresan", by: 1, me: { name: "Ada", phone: "070-111 22 33", email: "ada@example.com" } });
  const ada = readSplit(doc).people[0]!.id;
  const bo = addPerson(doc, { name: "Bo", userId: 2 });
  const cilla = addPerson(doc, { name: "Cilla Ek", phone: "0701234567", email: "cilla@example.com" });
  const david = addPerson(doc, { name: "David Lund", phone: "+46 73 555 12 90" });
  const all = { [ada]: 1, [bo]: 1, [cilla]: 1, [david]: 1 };
  addExpense(doc, { date: "2027-02-14", text: "Stugan", amount: 640000, paidBy: ada, mode: "equal", parts: all }, 1);
  addExpense(doc, { date: "2027-02-14", text: "Mat, ICA Åre", amount: 128450, paidBy: bo, mode: "equal", parts: all }, 2);
  addExpense(doc, { date: "2027-02-15", text: "Liftkort", amount: 312000, paidBy: cilla, mode: "exact", parts: { [cilla]: 156000, [david]: 156000 } }, 1);
  addExpense(doc, { date: "2027-02-15", text: "Middag på Werséns", amount: 216000, paidBy: david, mode: "equal", parts: all }, 1);
  addExpense(doc, { date: "2027-02-16", text: "Bensin", amount: 94000, paidBy: bo, mode: "shares", parts: { [ada]: 1, [bo]: 1 } }, 2);
  return { doc, ada, bo, cilla, david };
}

describe("splitting costs", () => {
  it("splits an expense to the öre, the remainder one öre each in the people's order", () => {
    expect([...sharesOf({ amount: 128450, mode: "equal", parts: { a: 1, b: 1, c: 1, d: 1 } }, ["a", "b", "c", "d"]).values()]).toEqual([32113, 32113, 32112, 32112]);
    expect([...sharesOf({ amount: 100, mode: "equal", parts: { a: 1, b: 1, c: 1 } }, ["a", "b", "c"]).values()]).toEqual([34, 33, 33]);
    // shares: a couple is two
    expect(Object.fromEntries(sharesOf({ amount: 90000, mode: "shares", parts: { a: 2, b: 1 } }, ["a", "b"]))).toEqual({ a: 60000, b: 30000 });
    // exact: as written, what's left over split among them
    expect(Object.fromEntries(sharesOf({ amount: 10000, mode: "exact", parts: { a: 7000, b: 2000 } }, ["a", "b"]))).toEqual({ a: 7500, b: 2500 });
    // someone not in the split (or nobody) pays nothing
    expect(sharesOf({ amount: 500, mode: "equal", parts: {} }, ["a"]).size).toBe(0);
  });

  it("works out everyone's balance and who pays whom, in as few payments as it takes", () => {
    const { doc, ada, bo, cilla, david } = trip();
    const v = readSplit(doc);
    expect(splitTotal(v)).toBe(1390450);
    const b = Object.fromEntries(balances(v).map((x) => [x.person.name, { paid: x.paid, share: x.share, net: x.net }]));
    expect(b).toEqual({
      Ada: { paid: 640000, share: 293113, net: 346887 },
      Bo: { paid: 222450, share: 293113, net: -70663 },
      "Cilla Ek": { paid: 312000, share: 402112, net: -90112 },
      "David Lund": { paid: 216000, share: 402112, net: -186112 },
    });
    expect(balances(v).reduce((s, x) => s + x.net, 0)).toBe(0);
    expect(settle(v)).toEqual([
      { from: david, to: ada, amount: 186112 },
      { from: cilla, to: ada, amount: 90112 },
      { from: bo, to: ada, amount: 70663 },
    ]);

    // David pays: he's even, and only the others are left
    addPayment(doc, { from: david, to: ada, amount: 186112, date: "2027-02-20" });
    expect(settle(readSplit(doc)).map((t) => t.from)).toEqual([cilla, bo]);
    // a person in an expense can't be removed
    expect(removePerson(doc, cilla)).toBe(false);
    expect(readSplit(doc).people).toHaveLength(4);
  });

  it("takes a scanned receipt as an expense, tied to the scan", () => {
    const { doc, bo } = trip();
    const v = readSplit(doc);
    const input = expenseFromReceipt(v, "scan-1", { shop: "ICA Åre", date: "2027-02-15", total: 48250 }, bo, "2027-02-20");
    expect(input).toMatchObject({ date: "2027-02-15", text: "ICA Åre", amount: 48250, paidBy: bo, mode: "equal", scan: "scan-1" });
    expect(Object.keys(input.parts)).toHaveLength(4);
    const id = addExpense(doc, input, 2);
    expect(readSplit(doc).expenses.find((e) => e.id === id)!.scan).toBe("scan-1");
    // an edit that doesn't mention the receipt keeps it; one that clears it, clears it
    updateExpense(doc, id, { ...input, scan: undefined, text: "Mat" });
    expect(readSplit(doc).expenses.find((e) => e.id === id)).toMatchObject({ text: "Mat", scan: "scan-1" });
    updateExpense(doc, id, { ...input, scan: "" });
    expect(readSplit(doc).expenses.find((e) => e.id === id)!.scan).toBe("");
    // no date or total read: today, and an amount to fill in
    expect(expenseFromReceipt(v, "scan-2", {}, bo, "2027-02-20")).toMatchObject({ date: "2027-02-20", text: "", amount: 0 });
  });

  it("settles a chain without a detour", () => {
    // A paid 300 for A, B, C; B paid 300 for A, B, C: C owes 100 to each
    const doc = new Y.Doc();
    initSplit(doc, { title: "Middag", by: 1, me: { name: "A" } });
    const a = readSplit(doc).people[0]!.id;
    const b = addPerson(doc, { name: "B" });
    const c = addPerson(doc, { name: "C" });
    const all = { [a]: 1, [b]: 1, [c]: 1 };
    addExpense(doc, { date: "2027-01-01", text: "x", amount: 30000, paidBy: a, mode: "equal", parts: all }, 1);
    addExpense(doc, { date: "2027-01-01", text: "y", amount: 30000, paidBy: b, mode: "equal", parts: all }, 1);
    expect(settle(readSplit(doc))).toEqual([
      { from: c, to: a, amount: 10000 },
      { from: c, to: b, amount: 10000 },
    ]);
  });

  it("writes Swish numbers, QR codes and links as Swish takes them", () => {
    expect(swishNumber("070-123 45 67")).toBe("0701234567");
    expect(swishNumber("+46 70 123 45 67")).toBe("0701234567");
    expect(swishNumber("0046701234567")).toBe("0701234567");
    expect(swishNumber("46701234567")).toBe("0701234567");
    expect(swishNumber("123 456 78 90")).toBe("1234567890");
    expect(swishNumber("08-123 456")).toBe("");
    expect(formatPhone("+46701234567")).toBe("070-123 45 67");
    expect(swishMessage("Fjällresan <Åre> 2027 & mer")).toBe("Fjällresan Åre 2027 mer");
    expect(swishMessage("x".repeat(80))).toHaveLength(50);
    expect(swishQrText({ to: "070-123 45 67", amount: 186112, message: "Fjällresan" })).toBe("C0701234567;1861,12;Fjallresan;0");
    expect(swishQrText({ to: "0701234567", amount: 5, message: "a" })).toBe("C0701234567;0,05;a;0");
    expect(swishLink({ to: "0701234567", amount: 186112, message: "Fjällresan" })).toBe("https://app.swish.nu/1/p/sw/?sw=0701234567&amt=1861.12&cur=SEK&msg=Fj%C3%A4llresan&src=qr");
  });
});
