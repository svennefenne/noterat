import type * as Y from "yjs";
import type { ObjectType } from "./docs";
import { entryBody, entryTitle, readEntry } from "./journal";
import { readCalendar } from "./calendar";
import { readList } from "./lists";
import { formatAmount } from "./receipts";
import { readRecipe, recipeIngredients, recipeSteps, recipeTitle } from "./recipes";
import { readScan, scanText, scanTitle } from "./scans";
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
    case "scan": {
      const sc = readScan(doc);
      const text = scanText(doc).toString();
      const r = sc.receipt;
      const extra = r ? [r.shop, r.date, r.total !== undefined ? formatAmount(r.total) : ""].filter(Boolean).join(" · ") : "";
      return { id, type, title: scanTitle(sc, text), text: [extra, text].filter(Boolean).join("\n"), tags: [], at: sc.createdAt };
    }
    case "recipe": {
      const r = readRecipe(doc);
      const ingredients = recipeIngredients(doc).toString();
      return { id, type, title: recipeTitle(r, ingredients), text: [r.description, ingredients, recipeSteps(doc).toString()].filter(Boolean).join("\n"), tags: r.tags, at: r.createdAt };
    }
    case "calendar": {
      const c = readCalendar(doc);
      return { id, type, title: c.title, text: c.events.map((e) => [e.start.slice(0, 10), e.title, e.location, e.notes].filter(Boolean).join(" · ")).join("\n"), tags: [], at: 0 };
    }
    case "journal": {
      const e = readEntry(doc);
      const body = entryBody(doc).toString();
      return { id, type, title: entryTitle(e, body), text: `${e.date}\n${body}`, tags: [], at: Date.parse(`${e.date}T12:00:00`) || e.createdAt };
    }
  }
}
