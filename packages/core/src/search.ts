import type * as Y from "yjs";
import type { ObjectType } from "./docs";
import { entryBody, entryTitle, readEntry } from "./journal";
import { readList } from "./lists";
import { memoText, memoTitle, readMemo } from "./memos";
import { noteBody, noteTitle, readNote } from "./notes";

/**
 * What of each kind of thing can be searched for (decision 7): the search index on the device is
 * built from these. title is what the thing is called (it may be empty: the app names it), text the
 * rest of its words, one line per field or row.
 */

export interface Searchable {
  id: string;
  type: ObjectType;
  title: string;
  text: string;
  tags: string[];
  /** when it's about or was last changed, to sort by (ms) */
  at: number;
}

export function searchable(type: ObjectType, id: string, doc: Y.Doc): Searchable {
  switch (type) {
    case "list": {
      const l = readList(doc);
      // (what's written in the cells: text, numbers, choices, dates; not ticks or people)
      const words = l.columns.filter((c) => c.type !== "check" && c.type !== "person");
      const lines = l.rows.map((r) =>
        words
          .map((c) => r.cells[c.id])
          .filter((v) => typeof v === "string" || typeof v === "number")
          .join(" · "),
      );
      return { id, type, title: l.title, text: [l.columns.map((c) => c.name).join(" · "), ...lines].filter(Boolean).join("\n"), tags: [], at: 0 };
    }
    case "note": {
      const n = readNote(doc);
      const body = noteBody(doc).toString();
      return { id, type, title: noteTitle(n, body), text: body, tags: n.tags, at: n.updatedAt };
    }
    case "memo": {
      const m = readMemo(doc);
      const text = memoText(doc).toString();
      return { id, type, title: memoTitle(m, text), text, tags: [], at: m.createdAt };
    }
    case "journal": {
      const e = readEntry(doc);
      const body = entryBody(doc).toString();
      return { id, type, title: entryTitle(e, body), text: `${e.date}\n${body}`, tags: [], at: Date.parse(`${e.date}T12:00:00`) || e.createdAt };
    }
  }
}

/**
 * A word as it's matched: lower case, without accents, so "Köttbullar" and "kottbullar" are the same
 * word to search. Character by character, so a folded text lines up with the original (for snippets).
 */
export function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    const low = ch.toLowerCase();
    const base = low.normalize("NFD")[0] ?? low;
    // (only what keeps its length: "İ" lower-cases to two characters, and stays as it is)
    out += base.length === ch.length ? base : low.length === ch.length ? low : ch;
  }
  return out;
}
