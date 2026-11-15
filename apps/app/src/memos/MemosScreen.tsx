import { useRef } from "react";
import { Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import type * as Y from "yjs";
import { initMemo, memoText, memoTitle, readMemo, type MemoView } from "@noterat/core";
import { useLinkedAction } from "../lib/deepLinks";
import { hashOf } from "../lib/files";
import { useI18n } from "../lib/i18n";
import { useDocsValues, useHomeItems, useSession, useSyncState } from "../lib/sync-react";
import { clock, MemoStatus } from "./parts";
import { RecordPanel, useAutoTranscribe } from "./RecordPanel";

const readCard = (doc: Y.Doc) => ({ memo: readMemo(doc), text: memoText(doc).toString() });

/** Voice memos: one tap to record, and every memo this person has, newest first. */
export function MemosScreen() {
  const { t } = useI18n();
  const { sync } = useSession();
  const { homeLoaded } = useSyncState();
  const items = useHomeItems().filter(([, item]) => item.type === "memo");
  const docs = sync.docsOf("memo", items.map(([id]) => id));
  const cards = useDocsValues(docs, readCard);
  const memos = items.map(([id, item], i) => ({ id, role: item.role, ...cards[i]! })).sort((a, b) => b.memo.createdAt - a.memo.createdAt);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{t("memos.title")}</h1>
      </div>
      <NewMemo />
      {!homeLoaded ? (
        <p className="muted">{t("lists.loading")}</p>
      ) : memos.length === 0 ? (
        <p className="muted empty-line">{t("memos.empty")}</p>
      ) : (
        <ul className="cards">
          {memos.map((m) => (
            <MemoCard key={m.id} id={m.id} memo={m.memo} text={m.text} shared={m.role !== "owner"} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MemoCard({ id, memo, text, shared }: { id: string; memo: MemoView; text: string; shared: boolean }) {
  const { t } = useI18n();
  const title = memoTitle(memo, text) || when(memo.createdAt, t);
  const rest = text.trim() && memo.title ? text.trim() : text.trim().split("\n").slice(1).join(" ");
  return (
    <li>
      <Link href={`/memos/${id}`} className="card">
        <span className="card-title">{title}</span>
        {rest && <span className="card-preview">{rest.length > 140 ? `${rest.slice(0, 139)}…` : rest}</span>}
        <span className="card-meta">
          {memo.audio && <span>{clock(memo.audio.duration)}</span>}
          {(memoTitle(memo, text) || shared) && <span>{when(memo.createdAt, t)}</span>}
          <MemoStatus memo={memo} />
          {shared && (
            <span className="badge">
              <Users aria-hidden size={14} /> {t("lists.sharedWithYou")}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** "Today 14:05", "12 Nov 09:30" */
export function when(at: number, t: ReturnType<typeof useI18n>["t"]) {
  const d = new Date(at);
  const time = d.toLocaleTimeString(t("locale"), { hour: "2-digit", minute: "2-digit" });
  return new Date().toDateString() === d.toDateString() ? t("memo.today", { time }) : `${d.toLocaleDateString(t("locale"), { day: "numeric", month: "short" })} ${time}`;
}

/** Recording a memo: made on the device at once; its recording goes to the server when it can. */
function NewMemo() {
  const { sync, user } = useSession();
  const [, navigate] = useLocation();
  const [auto] = useAutoTranscribe();
  const panel = useRef<HTMLDivElement>(null);

  // "New voice memo" from the home screen (?record=1): the record button is pressed, so recording starts
  // just as a tap starts it (the microphone asked for the first time; nothing while one is going already)
  useLinkedAction("record", () => panel.current?.querySelector<HTMLButtonElement>(".rec-button")?.click());

  async function keep(blob: Blob, duration: number, title: string) {
    const hash = await hashOf(blob);
    const id = sync.create("memo", (doc) =>
      initMemo(doc, { title, audio: { hash, type: blob.type || "audio/webm", size: blob.size, duration }, transcribe: auto === "on", by: user.id }),
    );
    await sync.files.add(blob, id);
    navigate(`/memos/${id}`);
  }

  return (
    <div ref={panel}>
      <RecordPanel onRecorded={keep} />
    </div>
  );
}
