import { Check, Mic } from "lucide-react";
import type * as Y from "yjs";
import { memoText, memoTitle, readMemo } from "@noterat/core";
import { useDates } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useDocsValues, useHomeItems, useSession } from "../lib/sync-react";
import { when } from "../memos/MemosScreen";
import { clock } from "../memos/parts";
import { memoIntoJournal } from "./fromMemo";

const readCard = (doc: Y.Doc) => ({ memo: readMemo(doc), text: memoText(doc).toString() });

/** Voice memos to put in a journal entry: picking one adds its recording as a clip, and its text. */
export function FromMemos({ entryId, has, onDone }: { entryId: string; has: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const dates = useDates();
  const { sync, user } = useSession();
  const items = useHomeItems().filter(([, i]) => i.type === "memo");
  const docs = sync.docsOf("memo", items.map(([id]) => id));
  const cards = useDocsValues(docs, readCard);
  const memos = items
    .map(([id], n) => ({ id, ...cards[n]! }))
    .filter((m) => m.memo.audio)
    .sort((a, b) => b.memo.createdAt - a.memo.createdAt);

  if (memos.length === 0) return <p className="muted">{t("fromMemos.none")}</p>;
  return (
    <ul className="pick-list">
      {memos.map((m) => {
        const there = has.includes(m.memo.audio!.hash);
        return (
          <li key={m.id}>
            <button
              type="button"
              className="pick"
              disabled={there}
              onClick={() => {
                memoIntoJournal(sync, m.id, { entryId, by: user.id });
                onDone();
              }}
            >
              {there ? <Check aria-hidden size={18} /> : <Mic aria-hidden size={18} />}
              <span className="pick-main">
                <span className="pick-title">{memoTitle(m.memo, m.text) || when(m.memo.createdAt, t, dates)}</span>
                <span className="muted small-text">
                  {when(m.memo.createdAt, t, dates)} · {clock(m.memo.audio!.duration)}
                  {there ? ` · ${t("fromMemos.there")}` : m.text.trim() ? "" : ` · ${t("fromMemos.noText")}`}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
