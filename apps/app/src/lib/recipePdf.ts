import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * A recipe as a PDF (decision 9), made on the device, offline too: its title, photo, servings and time,
 * the ingredients (scaled as shown) and the steps, on A4 pages. pdf-lib's built-in fonts speak Latin-1
 * (å, ä, ö, ½, ¼, ¾); what they can't write is written another way (⅓ → 1/3).
 */

const SWAP: Record<string, string> = { "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8", "⅕": "1/5", "’": "'", "‘": "'", "“": '"', "”": '"', "−": "-" };
const latin1 = (s: string) =>
  [...s]
    .map((c) => SWAP[c] ?? c)
    .join("")
    // (WinAnsi has these few beyond Latin-1; anything else can't be written)
    .replace(/[^\x20-\x7e\xa0-\xff\n\u2013\u2014\u2026\u2022\u20ac]/g, "?");

export interface RecipeForPdf {
  title: string;
  meta: string;
  ingredients: string[];
  steps: string;
  photo?: { bytes: Uint8Array; type: string };
  footer: string;
}

export async function recipePdf(r: RecipeForPdf): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin1(r.title));
  pdf.setCreator("Noterat");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H, M] = [595.28, 841.89, 56];
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const room = (h: number) => {
    if (y - h >= M) return;
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const para of latin1(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  };
  const write = (text: string, o: { font?: PDFFont; size?: number; indent?: number; gap?: number; color?: number } = {}) => {
    const font = o.font ?? regular;
    const size = o.size ?? 11;
    const x = M + (o.indent ?? 0);
    for (const line of wrap(text, font, size, W - M - x)) {
      room(size * 1.4);
      page.drawText(line, { x, y: y - size, size, font, color: rgb(o.color ?? 0.12, o.color ?? 0.11, o.color ?? 0.1) });
      y -= size * 1.4;
    }
    y -= o.gap ?? 0;
  };

  write(r.title, { font: bold, size: 22, gap: 4 });
  if (r.meta) write(r.meta, { size: 10, color: 0.4, gap: 10 });
  if (r.photo && /jpe?g|png/.test(r.photo.type)) {
    try {
      const img = /png/.test(r.photo.type) ? await pdf.embedPng(r.photo.bytes) : await pdf.embedJpg(r.photo.bytes);
      const scale = Math.min((W - 2 * M) / img.width, 260 / img.height, 1);
      room(img.height * scale + 12);
      page.drawImage(img, { x: M, y: y - img.height * scale, width: img.width * scale, height: img.height * scale });
      y -= img.height * scale + 16;
    } catch {
      // (a photo pdf-lib can't read: the recipe without it)
    }
  }
  if (r.ingredients.length) {
    write("Ingredienser", { font: bold, size: 14, gap: 4 });
    for (const line of r.ingredients) {
      if (/:$/.test(line)) write(line, { font: bold, size: 11 });
      else write(`•  ${line}`, { indent: 6 });
    }
    y -= 10;
  }
  if (r.steps.trim()) {
    write("Gör så här", { font: bold, size: 14, gap: 4 });
    for (const para of r.steps.split("\n").filter((l) => l.trim())) write(para.replace(/^#+\s*/, "").replace(/\*\*|__/g, ""), { gap: 4 });
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(latin1(`${r.footer}${pages.length > 1 ? `  ·  ${i + 1}/${pages.length}` : ""}`), { x: M, y: 28, size: 8, font: regular, color: rgb(0.55, 0.55, 0.55) }));
  return new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" });
}
