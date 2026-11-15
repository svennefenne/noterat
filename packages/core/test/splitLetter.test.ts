import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { PDFDocument } from "pdf-lib";
import { addExpense, addPerson, initSplit, readSplit } from "../src";
import { dateSpan, kronor, splitMail, splitPdf } from "../src/splitLetter";

function trip() {
  const doc = new Y.Doc();
  initSplit(doc, { title: "Fjällresan", by: 1, me: { name: "Ada Andersson", phone: "070-111 22 33", email: "ada@example.com" } });
  const ada = readSplit(doc).people[0]!.id;
  const bo = addPerson(doc, { name: "Bo", userId: 2 });
  const david = addPerson(doc, { name: "David Lund", phone: "+46 73 555 12 90", email: "david@example.com" });
  const all = { [ada]: 1, [bo]: 1, [david]: 1 };
  addExpense(doc, { date: "2027-02-14", text: "Stugan", amount: 600000, paidBy: ada, mode: "equal", parts: all }, 1);
  addExpense(doc, { date: "2027-02-16", text: "Middag på Werséns", amount: 90000, paidBy: bo, mode: "equal", parts: all }, 2);
  return { v: readSplit(doc), ada, bo, david };
}

describe("the summary each person gets", () => {
  it("writes amounts and dates as Swedes do", () => {
    expect(kronor(186112)).toBe("1 861,12");
    expect(kronor(-5)).toBe("-0,05");
    expect(kronor(186112, "en")).toBe("1,861.12");
    expect(dateSpan("2027-02-14", "2027-02-16")).toBe("14–16 feb. 2027".replace("feb.", "feb"));
    expect(dateSpan("2027-02-14", "2027-02-14")).toBe("14 feb 2027");
  });

  it("tells someone who owes what to pay and to whom, with a Swish link", () => {
    const { v, david } = trip();
    // David's share: 2 000 + 300 = 2 300; he paid nothing: 2 300 to Ada (who is owed 4 000 − 300)
    const m = splitMail(v, david, { lang: "sv", by: "Ada Andersson" });
    expect(m.subject).toBe("Fjällresan: du ska betala 2 300,00 kr");
    expect(m.text).toContain("Hej David!");
    expect(m.text).toContain("2 300,00 kr till Ada Andersson, Swish 070-111 22 33");
    expect(m.text).toContain("https://app.swish.nu/1/p/sw/?sw=0701112233&amt=2300.00&cur=SEK&msg=Fj%C3%A4llresan&src=qr");
    expect(m.html).toContain('<a href="https://app.swish.nu/1/p/sw/?sw=0701112233&amp;amt=2300.00');
    expect(m.filename).toBe("fjallresan-david-lund.pdf");
  });

  it("tells someone who's owed what comes back, and from whom", () => {
    const { v, ada } = trip();
    const m = splitMail(v, ada, { lang: "en", by: "Ada Andersson" });
    expect(m.subject).toBe("Fjällresan: you get 3,700.00 kr back");
    expect(m.text).toContain("2,300.00 kr from David Lund");
    expect(m.text).toContain("1,400.00 kr from Bo");
  });

  it("makes a PDF with a QR code and a tappable Swish link for each payment", async () => {
    const { v, david, ada } = trip();
    const bytes = await splitPdf(v, david, { lang: "sv", by: "Ada Andersson", now: new Date("2027-02-17T10:00:00") });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe("Fjällresan: Sammanställning för David Lund");
    const annots = pdf.getPage(0).node.Annots();
    expect(annots?.size()).toBe(1);
    const uri = String(pdf.context.lookup(annots!.get(0))?.toString());
    expect(uri).toContain("app.swish.nu");
    // Ada gets one too, with nothing to pay: no QR codes, no links
    const hers = await PDFDocument.load(await splitPdf(v, ada, { lang: "sv", by: "Ada Andersson" }));
    expect(hers.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });
});
