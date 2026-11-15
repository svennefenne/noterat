import { PDFDocument, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { encode } from "uqr";
import { balances, formatPhone, settle, sharesOf, splitDates, splitTotal, swishLink, swishNumber, swishQrText, type SplitView, type Transfer } from "./split";

/**
 * What each person in a cost split gets (decision 13): a mail saying what they pay or get back, and a PDF
 * with everything: their part first, with a Swish QR code for each payment (and a link to tap, for someone
 * reading on their phone), then every expense with their share of it, everyone's balance, and who pays
 * whom. Made here so the server mails the same PDF the app shows. A4, pdf-lib's Helvetica (Latin-1:
 * å, ä, ö), amounts in kronor.
 */

export type LetterLang = "sv" | "en";

const T = {
  sv: {
    summaryFor: (name: string) => `Sammanställning för ${name}`,
    sentBy: (date: string, by: string) => `Skickad ${date} av ${by}`,
    youPay: (amount: string) => `Du ska betala ${amount} kr`,
    youGet: (amount: string) => `Du får tillbaka ${amount} kr`,
    youEven: "Du är kvitt. Inget att betala eller få tillbaka.",
    to: (name: string) => `Till ${name}`,
    from: (name: string) => `Från ${name}`,
    swish: (phone: string) => `Swish ${phone}`,
    scan: "Skanna koden med Swish-appen.",
    tap: "På telefonen: tryck här för att öppna Swish",
    noSwish: (name: string) => `${name} har inget Swish-nummer i delningen. Fråga hur du ska betala.`,
    expenses: "Alla utgifter",
    date: "Datum",
    what: "Vad",
    paidBy: "Betalt av",
    amount: "Belopp",
    yourShare: "Din andel",
    total: "Totalt",
    perPerson: "Per person",
    person: "Person",
    paid: "Betalat",
    share: "Andel",
    balance: "Saldo",
    howSettled: "Så görs det upp",
    alreadyPaid: "Redan betalt",
    payer: "Betalar",
    payee: "Till",
    nothing: "Ingen behöver betala något.",
    footer: "Gjord med Noterat",
    subjectPay: (title: string, amount: string) => `${title}: du ska betala ${amount} kr`,
    subjectGet: (title: string, amount: string) => `${title}: du får tillbaka ${amount} kr`,
    subjectEven: (title: string) => `${title}: du är kvitt`,
    hello: (name: string) => `Hej ${name}!`,
    intro: (title: string, by: string) => `Här är sammanställningen av ${title} från ${by}. Allt står i PDF:en.`,
    payLine: (amount: string, name: string) => `${amount} kr till ${name}`,
    getLine: (amount: string, name: string) => `${amount} kr från ${name}`,
    openSwish: "Öppna i Swish",
    regards: (by: string) => `Hälsningar\n${by}, via Noterat`,
    file: "sammanstallning",
  },
  en: {
    summaryFor: (name: string) => `Summary for ${name}`,
    sentBy: (date: string, by: string) => `Sent ${date} by ${by}`,
    youPay: (amount: string) => `You pay ${amount} kr`,
    youGet: (amount: string) => `You get ${amount} kr back`,
    youEven: "You're even. Nothing to pay or get back.",
    to: (name: string) => `To ${name}`,
    from: (name: string) => `From ${name}`,
    swish: (phone: string) => `Swish ${phone}`,
    scan: "Scan the code with the Swish app.",
    tap: "On your phone: tap here to open Swish",
    noSwish: (name: string) => `${name} has no Swish number in the split. Ask how to pay.`,
    expenses: "All expenses",
    date: "Date",
    what: "What",
    paidBy: "Paid by",
    amount: "Amount",
    yourShare: "Your share",
    total: "Total",
    perPerson: "Per person",
    person: "Person",
    paid: "Paid",
    share: "Share",
    balance: "Balance",
    howSettled: "How it's settled",
    alreadyPaid: "Already paid",
    payer: "Pays",
    payee: "To",
    nothing: "Nobody needs to pay anything.",
    footer: "Made with Noterat",
    subjectPay: (title: string, amount: string) => `${title}: you pay ${amount} kr`,
    subjectGet: (title: string, amount: string) => `${title}: you get ${amount} kr back`,
    subjectEven: (title: string) => `${title}: you're even`,
    hello: (name: string) => `Hi ${name}!`,
    intro: (title: string, by: string) => `Here's the summary of ${title} from ${by}. It's all in the PDF.`,
    payLine: (amount: string, name: string) => `${amount} kr to ${name}`,
    getLine: (amount: string, name: string) => `${amount} kr from ${name}`,
    openSwish: "Open in Swish",
    regards: (by: string) => `Best\n${by}, via Noterat`,
    file: "summary",
  },
};

/** 186112 → "1 861,12" (sv) or "1,861.12"; the sign written as a plain hyphen-minus, which Helvetica has. */
export function kronor(ore: number, lang: LetterLang = "sv"): string {
  const s = new Intl.NumberFormat(lang === "sv" ? "sv-SE" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(ore) / 100);
  return (ore < 0 ? "-" : "") + s.replace(/\u202f/g, "\u00a0");
}

function day(date: string, lang: LetterLang, year = true): string {
  if (!date) return "";
  return new Intl.DateTimeFormat(lang === "sv" ? "sv-SE" : "en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) }).format(new Date(`${date}T12:00:00`)).replace(/\.(?=\s|$)/g, "");
}

/** "14–16 feb 2027", "30 jan – 2 feb 2027", or one day. */
export function dateSpan(from: string, to: string, lang: LetterLang = "sv"): string {
  if (!from) return "";
  if (from === to) return day(from, lang);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${day(to, lang)}`;
  return `${day(from, lang, from.slice(0, 4) !== to.slice(0, 4))} – ${day(to, lang)}`;
}

/** One person's side of it: what they pay to whom, what they get from whom. */
export function personPart(v: SplitView, personId: string) {
  const transfers = settle(v);
  const pay = transfers.filter((t) => t.from === personId);
  const get = transfers.filter((t) => t.to === personId);
  return { transfers, pay, get, payTotal: pay.reduce((s, t) => s + t.amount, 0), getTotal: get.reduce((s, t) => s + t.amount, 0) };
}

const nameOf = (v: SplitView, id: string) => v.people.find((p) => p.id === id)?.name ?? "?";

// ───────────── the mail ─────────────

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]!);

export function splitMail(v: SplitView, personId: string, o: { lang: LetterLang; by: string; now?: Date }) {
  const t = T[o.lang];
  const me = v.people.find((p) => p.id === personId)!;
  const part = personPart(v, personId);
  const title = v.title || (o.lang === "sv" ? "Delningen" : "The split");
  const subject = part.payTotal > 0 ? t.subjectPay(title, kronor(part.payTotal, o.lang)) : part.getTotal > 0 ? t.subjectGet(title, kronor(part.getTotal, o.lang)) : t.subjectEven(title);
  const payee = (tr: Transfer) => v.people.find((p) => p.id === tr.to);
  const lines: string[] = [t.hello(me.name.split(" ")[0] || me.name), "", t.intro(title, o.by), ""];
  const html: string[] = [`<p>${esc(t.hello(me.name.split(" ")[0] || me.name))}</p>`, `<p>${esc(t.intro(title, o.by))}</p>`];
  if (part.payTotal > 0) {
    lines.push(t.youPay(kronor(part.payTotal, o.lang)));
    html.push(`<p><strong>${esc(t.youPay(kronor(part.payTotal, o.lang)))}</strong></p><ul>`);
    for (const tr of part.pay) {
      const p = payee(tr)!;
      const number = swishNumber(p.phone);
      const link = number ? swishLink({ to: number, amount: tr.amount, message: title }) : "";
      lines.push(`- ${t.payLine(kronor(tr.amount, o.lang), p.name)}${number ? `, ${t.swish(formatPhone(number))}` : ""}${link ? `\n  ${t.openSwish}: ${link}` : ""}`);
      html.push(
        `<li>${esc(t.payLine(kronor(tr.amount, o.lang), p.name))}${number ? `, ${esc(t.swish(formatPhone(number)))} · <a href="${esc(link)}">${esc(t.openSwish)}</a>` : ""}</li>`,
      );
    }
    html.push("</ul>");
  } else if (part.getTotal > 0) {
    lines.push(t.youGet(kronor(part.getTotal, o.lang)));
    html.push(`<p><strong>${esc(t.youGet(kronor(part.getTotal, o.lang)))}</strong></p><ul>`);
    for (const tr of part.get) {
      lines.push(`- ${t.getLine(kronor(tr.amount, o.lang), nameOf(v, tr.from))}`);
      html.push(`<li>${esc(t.getLine(kronor(tr.amount, o.lang), nameOf(v, tr.from)))}</li>`);
    }
    html.push("</ul>");
  } else {
    lines.push(t.youEven);
    html.push(`<p>${esc(t.youEven)}</p>`);
  }
  lines.push("", t.regards(o.by));
  html.push(`<p>${esc(t.regards(o.by)).replace("\n", "<br>")}</p>`);
  const slug = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || t.file;
  return { subject, text: lines.join("\n"), html: html.join("\n"), filename: `${slug(title)}-${slug(me.name)}.pdf` };
}

// ───────────── the PDF ─────────────

/** What Helvetica (WinAnsi) can write: Latin-1 and a few more; anything else as "?". */
const latin1 = (s: string) =>
  s
    .replace(/[−‐‑]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e\xa0-\xff–—…•€]/g, "?");

const C = {
  text: rgb(0.122, 0.114, 0.102),
  muted: rgb(0.412, 0.392, 0.357),
  line: rgb(0.878, 0.859, 0.82),
  accent: rgb(0.184, 0.365, 0.314),
  accentSoft: rgb(0.886, 0.922, 0.906),
  danger: rgb(0.639, 0.149, 0.11),
  dangerSoft: rgb(0.969, 0.894, 0.882),
  paper: rgb(0.961, 0.949, 0.925),
  white: rgb(1, 1, 1),
};

const W = 595.28;
const H = 841.89;
const M = 48;

export async function splitPdf(v: SplitView, personId: string, o: { lang: LetterLang; by: string; now?: Date }): Promise<Uint8Array> {
  const t = T[o.lang];
  const k = (n: number) => kronor(n, o.lang);
  const me = v.people.find((p) => p.id === personId)!;
  const part = personPart(v, personId);
  const title = v.title || (o.lang === "sv" ? "Delningen" : "The split");
  const now = o.now ?? new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const pdf = await PDFDocument.create();
  pdf.setTitle(latin1(`${title}: ${t.summaryFor(me.name)}`));
  pdf.setCreator("Noterat");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const room = (h: number) => {
    if (y - h < M + 20) newPage();
  };
  const write = (s: string, x: number, size: number, font: PDFFont = regular, color: RGB = C.text) => page.drawText(latin1(s), { x, y, size, font, color });
  const widthOf = (s: string, size: number, font: PDFFont = regular) => font.widthOfTextAtSize(latin1(s), size);
  const right = (s: string, xRight: number, size: number, font: PDFFont = regular, color: RGB = C.text) => write(s, xRight - widthOf(s, size, font), size, font, color);
  /** cut to fit a column */
  const fit = (s: string, max: number, size: number, font: PDFFont = regular) => {
    let out = latin1(s);
    while (out.length > 1 && font.widthOfTextAtSize(out, size) > max) out = out.slice(0, -1);
    return out === latin1(s) ? out : `${out.slice(0, -1)}…`;
  };
  const rule = (color: RGB = C.line, thickness = 0.75) => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness, color });
  const link = (url: string, x: number, yBottom: number, w: number, h: number) => {
    const annot = pdf.context.register(
      pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [x, yBottom, x + w, yBottom + h], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(url) } }),
    );
    page.node.addAnnot(annot);
  };
  const qr = (text: string, x: number, yTop: number, size: number) => {
    const code = encode(text, { ecc: "M", border: 0 });
    const cell = size / code.size;
    page.drawRectangle({ x: x - 6, y: yTop - size - 6, width: size + 12, height: size + 12, color: C.white });
    code.data.forEach((row, r) =>
      row.forEach((on, c) => {
        if (on) page.drawRectangle({ x: x + c * cell, y: yTop - (r + 1) * cell, width: cell + 0.02, height: cell + 0.02, color: C.text });
      }),
    );
  };

  // the head
  y -= 24;
  write(title, M, 24, bold);
  y -= 20;
  const dates = splitDates(v);
  write([t.summaryFor(me.name), dateSpan(dates.from, dates.to, o.lang)].filter(Boolean).join("  •  "), M, 11, regular, C.muted);
  y -= 14;
  write(t.sentBy(day(today, o.lang), o.by), M, 9, regular, C.muted);
  y -= 22;

  // your part
  const tone = part.payTotal > 0 ? { bg: C.dangerSoft, fg: C.danger } : part.getTotal > 0 ? { bg: C.accentSoft, fg: C.accent } : { bg: C.paper, fg: C.text };
  const rows = part.payTotal > 0 ? part.pay : part.get;
  const rowH = part.payTotal > 0 ? 124 : 22;
  const boxH = 50 + (rows.length ? rows.length * rowH : 0);
  room(boxH + 10);
  page.drawRectangle({ x: M, y: y - boxH, width: W - 2 * M, height: boxH, color: tone.bg });
  y -= 30;
  write(part.payTotal > 0 ? t.youPay(k(part.payTotal)) : part.getTotal > 0 ? t.youGet(k(part.getTotal)) : t.youEven, M + 16, part.payTotal || part.getTotal ? 18 : 13, bold, tone.fg);
  y -= 16;
  for (const tr of rows) {
    if (part.payTotal > 0) {
      const p = v.people.find((x) => x.id === tr.to)!;
      const number = swishNumber(p.phone);
      const top = y - 4;
      if (number) {
        qr(swishQrText({ to: number, amount: tr.amount, message: title }), M + 22, top, 96);
        y = top - 14;
        write(t.to(p.name), M + 136, 12, bold);
        y -= 20;
        write(`${k(tr.amount)} kr`, M + 136, 16, bold, C.danger);
        y -= 16;
        write(t.swish(formatPhone(number)), M + 136, 10.5, regular, C.muted);
        y -= 14;
        write(t.scan, M + 136, 10.5, regular, C.muted);
        y -= 18;
        const url = swishLink({ to: number, amount: tr.amount, message: title });
        write(t.tap, M + 136, 10.5, bold, C.accent);
        const w = widthOf(t.tap, 10.5, bold);
        page.drawLine({ start: { x: M + 136, y: y - 2 }, end: { x: M + 136 + w, y: y - 2 }, thickness: 0.75, color: C.accent });
        link(url, M + 132, y - 6, w + 8, 18);
        y = top - rowH + 4;
      } else {
        y -= 14;
        write(t.to(p.name), M + 16, 12, bold);
        right(`${k(tr.amount)} kr`, W - M - 16, 12, bold, C.danger);
        y -= 16;
        write(t.noSwish(p.name), M + 16, 10.5, regular, C.muted);
        y = top - rowH + 4;
      }
    } else {
      y -= 4;
      write(t.from(nameOf(v, tr.from)), M + 16, 11.5);
      right(`${k(tr.amount)} kr`, W - M - 16, 11.5, bold, C.accent);
      y -= 18;
    }
  }
  y = Math.min(y, H) - 26;

  // every expense, with their share of it
  const order = v.people.map((p) => p.id);
  const col = { date: M, what: M + 58, paidBy: M + 270, amount: W - M - 82, share: W - M };
  const heading = (s: string) => {
    room(60);
    write(s, M, 13, bold);
    y -= 10;
  };
  heading(t.expenses);
  const header = () => {
    y -= 14;
    write(t.date, col.date, 9, bold, C.muted);
    write(t.what, col.what, 9, bold, C.muted);
    write(t.paidBy, col.paidBy, 9, bold, C.muted);
    right(t.amount, col.amount, 9, bold, C.muted);
    right(t.yourShare, col.share, 9, bold, C.muted);
    y -= 6;
    rule();
  };
  header();
  for (const e of v.expenses) {
    if (y - 18 < M + 20) {
      newPage();
      header();
    }
    y -= 16;
    const mine = sharesOf(e, order).get(personId) ?? 0;
    write(day(e.date, o.lang, false), col.date, 10);
    write(fit(e.text || "—", col.paidBy - col.what - 10, 10), col.what, 10);
    write(fit(nameOf(v, e.paidBy), col.amount - col.paidBy - 70, 10), col.paidBy, 10);
    right(k(e.amount), col.amount, 10);
    right(mine ? k(mine) : "–", col.share, 10, mine ? bold : regular, mine ? C.text : C.muted);
    y -= 6;
    rule();
  }
  y -= 16;
  write(t.total, col.what, 10, bold);
  right(k(splitTotal(v)), col.amount, 10, bold);
  const myBalance = balances(v).find((b) => b.person.id === personId);
  right(k(myBalance?.share ?? 0), col.share, 10, bold);
  y -= 30;

  // everyone
  heading(t.perPerson);
  y -= 14;
  const pc = { name: M, paid: M + 300, share: M + 390, balance: W - M };
  write(t.person, pc.name, 9, bold, C.muted);
  right(t.paid, pc.paid, 9, bold, C.muted);
  right(t.share, pc.share, 9, bold, C.muted);
  right(t.balance, pc.balance, 9, bold, C.muted);
  y -= 6;
  rule();
  for (const b of balances(v)) {
    room(24);
    y -= 16;
    write(fit(b.person.name, pc.paid - 120, 10.5), pc.name, 10.5, b.person.id === personId ? bold : regular);
    right(k(b.paid), pc.paid, 10.5);
    right(k(b.share), pc.share, 10.5);
    right(`${b.net > 0 ? "+" : ""}${k(b.net)}`, pc.balance, 10.5, bold, b.net > 0 ? C.accent : b.net < 0 ? C.danger : C.muted);
    y -= 6;
    rule();
  }
  y -= 30;

  // who pays whom: kept on one page when it fits on one
  const rowsHigh = 26 + 22 * Math.max(1, part.transfers.length);
  if (rowsHigh < H - 2 * M - 80) room(rowsHigh + 40);
  heading(t.howSettled);
  if (part.transfers.length === 0) {
    y -= 16;
    write(t.nothing, M, 10.5, regular, C.muted);
  }
  const tc = { from: M, to: M + 200, date: M + 400, amount: W - M };
  const pairs = (list: { from: string; to: string; amount: number; date?: string }[], quiet: boolean) => {
    y -= 14;
    write(t.payer, tc.from, 9, bold, C.muted);
    write(t.payee, tc.to, 9, bold, C.muted);
    right(t.amount, tc.amount, 9, bold, C.muted);
    y -= 6;
    rule();
    for (const tr of list) {
      room(24);
      y -= 16;
      const mine = !quiet && (tr.from === personId || tr.to === personId);
      const font = mine ? bold : regular;
      const color = quiet ? C.muted : C.text;
      write(fit(nameOf(v, tr.from), tc.to - tc.from - 12, 10.5, font), tc.from, 10.5, font, color);
      write(fit(nameOf(v, tr.to), tc.date - tc.to - 12, 10.5, font), tc.to, 10.5, font, color);
      if (tr.date) write(day(tr.date, o.lang, false), tc.date, 10.5, regular, C.muted);
      right(`${k(tr.amount)} kr`, tc.amount, 10.5, font, color);
      y -= 6;
      rule();
    }
  };
  if (part.transfers.length) pairs(part.transfers, false);
  if (v.payments.length) {
    y -= 30;
    heading(t.alreadyPaid);
    pairs(v.payments, true);
  }

  // the footer, on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(latin1(`${title}  •  ${t.footer}${pages.length > 1 ? `  •  ${i + 1}/${pages.length}` : ""}`), { x: M, y: 28, size: 8, font: regular, color: C.muted });
  });
  return pdf.save();
}
