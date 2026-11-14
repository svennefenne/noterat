import { dayOf, initEntry, memoToEntry, objectDocName, readMemo, type EntryView } from "@noterat/core";
import type { Sync } from "../lib/sync";

/**
 * A voice memo into the journal: its recording becomes a clip in the entry and its text goes at the
 * end (core's memoToEntry), and the server is told the entry refers to the recording too, so whoever
 * has the entry can play it. Without an entry, a new one is made for the day the memo was recorded.
 * Returns the entry's id.
 */
export function memoIntoJournal(sync: Sync, memoId: string, o: { entryId?: string; by: number }): string | null {
  const memo = sync.doc(objectDocName("memo", memoId));
  const m = readMemo(memo);
  if (!m.audio) return null;
  const entryId = o.entryId ?? sync.create("journal", (doc) => initEntry(doc, { date: dayOf(m.createdAt || Date.now()), title: m.title, by: o.by }));
  memoToEntry(memo, sync.doc(objectDocName("journal", entryId)));
  void sync.files.link({ hash: m.audio.hash, objectId: entryId, type: m.audio.type, size: m.audio.size });
  return entryId;
}

/** Journal entries in the order the journal shows them: newest day first. */
export const byDay = (a: { entry: EntryView }, b: { entry: EntryView }) => b.entry.date.localeCompare(a.entry.date) || b.entry.createdAt - a.entry.createdAt;
