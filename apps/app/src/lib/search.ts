import MiniSearch from "minisearch";
import type * as Y from "yjs";
import { fold, searchable, type ObjectType, type Searchable } from "@noterat/core";

/**
 * Search over the documents on this device (decision 7): a full-text index of what each thing says
 * (core's searchable), so it works the same offline. Words match from their start, a longer word may
 * have a typo, and case and accents don't matter ("kottbullar" finds "Köttbullar").
 */

export interface Hit extends Searchable {
  score: number;
  /** the index's words that matched (folded), for marking them in the snippet */
  terms: string[];
}

export function buildIndex(things: { id: string; type: ObjectType; doc: Y.Doc }[]) {
  const index = new MiniSearch<Searchable>({
    fields: ["title", "text", "tags"],
    storeFields: ["id", "type", "title", "text", "tags", "at"],
    extractField: (doc, field) => (field === "tags" ? doc.tags.join(" ") : String(doc[field as keyof Searchable] ?? "")),
    processTerm: (term) => fold(term) || null,
    searchOptions: {
      prefix: true,
      fuzzy: (term) => (term.length > 4 ? 0.2 : false),
      boost: { title: 3, tags: 2 },
      combineWith: "AND",
    },
  });
  index.addAll(things.map((t) => searchable(t.type, t.id, t.doc)));
  return {
    search(query: string): Hit[] {
      if (!query.trim()) return [];
      return index.search(query).map((r) => ({ ...(r as unknown as Searchable), score: r.score, terms: r.terms }));
    },
  };
}

/**
 * A little of the text around the first word that matched, as pieces to show, the matching words
 * marked. Folding keeps a text's length, so where a word is in the folded text is where it is in the text.
 */
export function snippet(text: string, terms: string[], room = 70): { text: string; mark: boolean }[] {
  const flat = text.replace(/\s+/g, " ");
  const folded = fold(flat);
  const at = (from: number) => {
    let best: [number, number] | null = null;
    for (const t of terms) {
      const i = folded.indexOf(t, from);
      if (i >= 0 && (!best || i < best[0])) best = [i, t.length];
    }
    return best;
  };
  const first = at(0);
  if (!first) return [{ text: flat.slice(0, room * 2) + (flat.length > room * 2 ? "…" : ""), mark: false }];
  const start = Math.max(0, first[0] - room);
  const end = Math.min(flat.length, first[0] + room);
  const pieces: { text: string; mark: boolean }[] = [];
  if (start > 0) pieces.push({ text: "…", mark: false });
  let pos = start;
  for (let m = at(start); m && m[0] < end; m = at(m[0] + m[1])) {
    // (the whole word a prefix starts, marked)
    let wordEnd = m[0] + m[1];
    while (wordEnd < end && /[\p{L}\p{N}]/u.test(flat[wordEnd]!)) wordEnd++;
    if (m[0] < pos) continue;
    pieces.push({ text: flat.slice(pos, m[0]), mark: false }, { text: flat.slice(m[0], wordEnd), mark: true });
    pos = wordEnd;
  }
  pieces.push({ text: flat.slice(pos, end) + (end < flat.length ? "…" : ""), mark: false });
  return pieces.filter((p) => p.text);
}
