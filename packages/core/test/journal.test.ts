import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addClip,
  addPhoto,
  dayOf,
  docTitle,
  entryBody,
  entryPreview,
  entryTitle,
  fold,
  initEntry,
  initList,
  initMemo,
  initNote,
  memoText,
  memoToEntry,
  putTranscriptFor,
  readEntry,
  readMemo,
  removePhoto,
  searchable,
  setEntryDate,
  setTranscriptState,
  wantsTranscript,
  addRow,
  readList,
} from "../src";

const h = (c: string) => c.repeat(64);

describe("a journal entry", () => {
  it("is about a day, goes by its title or first line, and keeps photos once each", () => {
    const doc = new Y.Doc();
    initEntry(doc, { date: "2026-07-12", body: "# Midsommar på landet\n\nSill och jordgubbar.", by: 1 });
    const e = readEntry(doc);
    expect(e.date).toBe("2026-07-12");
    expect(entryTitle(e, entryBody(doc).toString())).toBe("Midsommar på landet");
    expect(entryPreview(e, entryBody(doc).toString())).toBe("Sill och jordgubbar.");
    expect(docTitle(doc)).toBe("Midsommar på landet");
    setEntryDate(doc, "not a day");
    expect(readEntry(doc).date).toBe("2026-07-12");

    const photo = { hash: h("a"), type: "image/jpeg", size: 1000, width: 2048, height: 1536 };
    expect(addPhoto(doc, photo)).toBe(true);
    expect(addPhoto(doc, photo)).toBe(false);
    removePhoto(doc, h("a"));
    expect(readEntry(doc).photos).toEqual([]);
    expect(dayOf(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });

  it("gets a clip's text at its end, and two devices' clips both stay", () => {
    const a = new Y.Doc();
    initEntry(a, { body: "Morgon.", by: 1 });
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    addClip(a, { hash: h("1"), type: "audio/webm", size: 10, duration: 3 }, true);
    addClip(b, { hash: h("2"), type: "audio/webm", size: 10, duration: 4 }, false);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    expect(readEntry(a).clips.map((c) => c.hash).sort()).toEqual([h("1"), h("2")]);

    expect(wantsTranscript("journal", a, h("1"))).toBe(true);
    expect(wantsTranscript("journal", a, h("2"))).toBe(false);
    setTranscriptState("journal", a, h("1"), { status: "working", progress: 0.5, at: 1 });
    expect(readEntry(a).clips.find((c) => c.hash === h("1"))!.transcription).toMatchObject({ status: "working", progress: 0.5 });
    putTranscriptFor("journal", a, h("1"), "Fåglarna sjöng.", { language: "sv" });
    expect(entryBody(a).toString()).toBe("Morgon.\n\nFåglarna sjöng.\n");
    expect(readEntry(a).clips.find((c) => c.hash === h("1"))!.transcription).toMatchObject({ status: "done", language: "sv" });
  });

  it("and a memo take their text the same way", () => {
    const memo = new Y.Doc();
    initMemo(memo, { audio: { hash: h("3"), type: "audio/webm", size: 1, duration: 1 }, transcribe: true, by: 1 });
    expect(wantsTranscript("memo", memo, h("3"))).toBe(true);
    // (another recording's text isn't this memo's)
    putTranscriptFor("memo", memo, h("4"), "fel", {});
    expect(memoText(memo).toString()).toBe("");
    putTranscriptFor("memo", memo, h("3"), "rätt", {});
    expect(memoText(memo).toString()).toBe("rätt");
    expect(readMemo(memo).transcription?.status).toBe("done");
  });
});

describe("what's searchable", () => {
  it("is each kind's words", () => {
    const list = new Y.Doc();
    initList(list, { title: "Inköp", columns: [{ name: "Köpt", type: "check" }, { name: "Vara", type: "text" }, { name: "Vem", type: "person" }], by: 1 });
    const cols = readList(list).columns;
    addRow(list, { cells: { [cols[1]!.id]: "Köttbullar", [cols[2]!.id]: 1, [cols[0]!.id]: true }, by: 1 });
    expect(searchable("list", "l", list)).toMatchObject({ title: "Inköp", text: "Köpt · Vara · Vem\nKöttbullar" });

    const note = new Y.Doc();
    initNote(note, { body: "# Recept\nSås", tags: ["mat"], by: 1 });
    expect(searchable("note", "n", note)).toMatchObject({ title: "Recept", text: "# Recept\nSås", tags: ["mat"] });

    const entry = new Y.Doc();
    initEntry(entry, { date: "2026-11-14", body: "Snö!", by: 1 });
    expect(searchable("journal", "j", entry)).toMatchObject({ title: "Snö!", text: "2026-11-14\nSnö!" });
  });

  it("matches without case or accents, and keeps the text's length", () => {
    expect(fold("Köttbullar ÅÄÖ é")).toBe("kottbullar aao e");
    const odd = "İstanbul 😀 Ö";
    expect(fold(odd)).toHaveLength(odd.length);
  });
});

describe("a voice memo moved to the journal", () => {
  const audio = { hash: h("m"), type: "audio/webm", size: 2000, duration: 9 };

  it("becomes a clip, with its text at the end of the entry", () => {
    const memo = new Y.Doc();
    initMemo(memo, { audio, transcribe: true, by: 1 });
    putTranscriptFor("memo", memo, h("m"), "Köp blommor till mormor.", { language: "sv", model: "kb" });
    const entry = new Y.Doc();
    initEntry(entry, { body: "En lång dag.", by: 1 });
    expect(memoToEntry(memo, entry)).toBe(true);
    expect(entryBody(entry).toString()).toBe("En lång dag.\n\nKöp blommor till mormor.\n");
    expect(readEntry(entry).clips).toMatchObject([{ hash: h("m"), duration: 9, transcription: { status: "done", language: "sv" } }]);
    // (once: the entry has that recording already)
    expect(memoToEntry(memo, entry)).toBe(false);
  });

  it("wants its text in the entry when the memo is still waiting for it", () => {
    const memo = new Y.Doc();
    initMemo(memo, { audio, transcribe: true, by: 1 });
    const entry = new Y.Doc();
    initEntry(entry, { by: 1 });
    memoToEntry(memo, entry);
    expect(wantsTranscript("journal", entry, h("m"))).toBe(true);

    const plain = new Y.Doc();
    initMemo(plain, { audio: { ...audio, hash: h("p") }, transcribe: false, by: 1 });
    memoToEntry(plain, entry);
    expect(readEntry(entry).clips.find((c) => c.hash === h("p"))!.transcription).toBeNull();
  });
});
