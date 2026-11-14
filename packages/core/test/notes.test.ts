import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addTag,
  addTextRows,
  appendToNote,
  docTitle,
  homePrefs,
  initList,
  initMemo,
  initNote,
  memoText,
  noteBody,
  notePreview,
  noteTitle,
  putTranscript,
  readList,
  readMemo,
  readNote,
  removeTag,
  setPrefs,
  textLines,
} from "../src";

/** Two devices that have been apart meet: each gets what the other did. */
function meet(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
}

describe("a note", () => {
  it("goes by its title, else its first line, and shows a little of the rest", () => {
    const doc = new Y.Doc();
    initNote(doc, { body: "# Inköp till festen\n\n- **Chips**\n- [Dip](https://example.com)\n", by: 1 });
    const body = noteBody(doc).toString();
    expect(noteTitle(readNote(doc), body)).toBe("Inköp till festen");
    expect(notePreview(readNote(doc), body)).toBe("Chips Dip");
    expect(docTitle(doc)).toBe("Inköp till festen");
  });

  it("keeps tags once each, whatever their case, and loses them again", () => {
    const doc = new Y.Doc();
    initNote(doc, { title: "Recept", tags: ["#mat", "Mat", " middag "], by: 1 });
    expect(readNote(doc).tags).toEqual(["mat", "middag"]);
    expect(addTag(doc, "MIDDAG")).toBe(false);
    removeTag(doc, "MAT");
    expect(readNote(doc).tags).toEqual(["middag"]);
  });

  it("merges two people's writing offline, and shows a tag both added once", () => {
    const a = new Y.Doc();
    initNote(a, { title: "Planering", body: "Fredag\n", by: 1 });
    const b = new Y.Doc();
    meet(a, b);
    noteBody(a).insert(0, "Torsdag\n");
    noteBody(b).insert(noteBody(b).length, "Lördag\n");
    addTag(a, "helg");
    addTag(b, "Helg");
    meet(a, b);
    expect(noteBody(a).toString()).toBe("Torsdag\nFredag\nLördag\n");
    expect(noteBody(b).toString()).toBe(noteBody(a).toString());
    expect(readNote(a).tags).toHaveLength(1);
  });

  it("takes text at its end, after a blank line", () => {
    const doc = new Y.Doc();
    initNote(doc, { body: "Första stycket", by: 1 });
    appendToNote(doc, "  Andra stycket ");
    expect(noteBody(doc).toString()).toBe("Första stycket\n\nAndra stycket\n");
  });
});

describe("a voice memo", () => {
  const audio = { hash: "a".repeat(64), type: "audio/webm", size: 1000, duration: 3 };

  it("gets its transcript, and a later one goes after what someone wrote", () => {
    const doc = new Y.Doc();
    initMemo(doc, { audio, transcribe: true, by: 1 });
    expect(readMemo(doc)).toMatchObject({ audio, transcription: { status: "wanted" } });
    putTranscript(doc, "Hej hej", { language: "sv" });
    expect(memoText(doc).toString()).toBe("Hej hej");
    expect(docTitle(doc)).toBe("Hej hej");
    // done again, untouched: replaced
    putTranscript(doc, "Hej på dig", {});
    expect(memoText(doc).toString()).toBe("Hej på dig");
    // written in: kept, the new one after it
    memoText(doc).insert(0, "OBS: ");
    putTranscript(doc, "Tredje", {});
    expect(memoText(doc).toString()).toBe("OBS: Hej på dig\n\nTredje");
    expect(readMemo(doc).transcription).toMatchObject({ status: "done" });
  });

  it("becomes list rows, one per line, in the list's first text column", () => {
    const list = new Y.Doc();
    initList(list, { title: "Inköp", columns: [{ name: "Köpt", type: "check" }, { name: "Vara", type: "text" }], by: 1 });
    const lines = textLines("- Mjölk\n\n* Ägg\n1. Bröd\n");
    expect(lines).toEqual(["Mjölk", "Ägg", "Bröd"]);
    expect(addTextRows(list, lines, 1)).toBe(3);
    const view = readList(list);
    expect(view.rows.map((r) => r.cells[view.columns[1]!.id])).toEqual(["Mjölk", "Ägg", "Bröd"]);
  });
});

describe("how someone keeps their things", () => {
  it("is pinned or in a folder, and nothing when neither", () => {
    const home = new Y.Doc();
    setPrefs(home, "x", { pinned: true });
    setPrefs(home, "x", { folder: "  Jobb  " });
    expect(homePrefs(home).get("x")).toEqual({ pinned: true, folder: "Jobb" });
    setPrefs(home, "x", { pinned: false, folder: "" });
    expect(homePrefs(home).has("x")).toBe(false);
  });
});
