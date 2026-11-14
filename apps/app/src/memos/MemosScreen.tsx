import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileAudio, Mic, Square, Users, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import type * as Y from "yjs";
import { initMemo, memoText, memoTitle, readMemo, type MemoView } from "@noterat/core";
import { hashOf } from "../lib/files";
import { useI18n } from "../lib/i18n";
import { recordProblem, Recording, type RecordProblem } from "../lib/recorder";
import { useDocsValues, useHomeItems, useSession, useSyncState } from "../lib/sync-react";
import { Problem, useStored } from "../ui";
import { clock, MemoStatus } from "./parts";

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
      <Recorder />
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

/**
 * The record button: a tap starts, a tap stops, and the memo is made on the device at once (its
 * recording goes to the server when it can). An audio file from elsewhere can be added too.
 */
function Recorder() {
  const { t } = useI18n();
  const { sync, user } = useSession();
  const [, navigate] = useLocation();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState<RecordProblem | "" | "file">("");
  const [auto, setAuto] = useStored<"on" | "off">("noterat.memos.transcribe", "on");
  const picker = useRef<HTMLInputElement>(null);
  const cantRecord = recordProblem();

  useEffect(() => {
    if (!recording) return;
    let frame = 0;
    const tick = () => {
      setElapsed(recording.elapsed);
      setLevel(recording.level());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [recording]);

  // (leaving the page while recording: what's recorded is let go, not kept half-done)
  const live = useRef<Recording | null>(null);
  useEffect(() => {
    live.current = recording;
  }, [recording]);
  useEffect(() => () => live.current?.cancel(), []);

  async function keep(blob: Blob, duration: number, title = "") {
    const hash = await hashOf(blob);
    const id = sync.create("memo", (doc) =>
      initMemo(doc, { title, audio: { hash, type: blob.type || "audio/webm", size: blob.size, duration }, transcribe: auto === "on", by: user.id }),
    );
    await sync.files.add(blob, id);
    navigate(`/memos/${id}`);
  }

  async function start() {
    setProblem("");
    try {
      setRecording(await Recording.start());
      setElapsed(0);
    } catch (err) {
      setProblem(err as RecordProblem);
    }
  }

  async function stop() {
    if (!recording) return;
    const r = recording;
    live.current = null;
    setRecording(null);
    const { blob, duration } = await r.stop();
    if (duration >= 0.5 && blob.size > 0) await keep(blob, duration);
  }

  function cancel() {
    recording?.cancel();
    live.current = null;
    setRecording(null);
  }

  async function picked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const duration = await audioLength(file);
    if (duration === null) return setProblem("file");
    await keep(file, duration, file.name.replace(/\.[^.]+$/, ""));
  }

  return (
    <section className={recording ? "recorder recording" : "recorder"} aria-label={t("memos.record")}>
      {recording ? (
        <>
          <div className="recorder-live" role="timer" aria-live="off">
            <span className="rec-dot" aria-hidden />
            <span className="rec-time">{clock(elapsed)}</span>
            <span className="rec-level" aria-hidden>
              <span style={{ transform: `scaleX(${0.05 + level * 0.95})` }} />
            </span>
          </div>
          <div className="recorder-actions">
            <button type="button" className="secondary" onClick={cancel}>
              <X aria-hidden size={18} /> {t("memos.cancel")}
            </button>
            <button type="button" className="primary rec-stop" onClick={() => void stop()}>
              <Square aria-hidden size={18} /> {t("memos.stop")}
            </button>
          </div>
        </>
      ) : (
        <>
          <button type="button" className="rec-button" onClick={() => void start()} disabled={!!cantRecord}>
            <Mic aria-hidden size={28} />
            <span>{t("memos.record")}</span>
          </button>
          <div className="recorder-side">
            <label className="check small-text">
              <input type="checkbox" checked={auto === "on"} onChange={(e) => setAuto(e.target.checked ? "on" : "off")} />
              {t("memos.autoTranscribe")}
            </label>
            <button type="button" className="link-button small-text" onClick={() => picker.current?.click()}>
              <FileAudio aria-hidden size={16} /> {t("memos.addFile")}
            </button>
            <input ref={picker} type="file" accept="audio/*" hidden onChange={(e) => void picked(e)} />
          </div>
        </>
      )}
      {(problem || cantRecord) && <Problem>{t(`record.${(problem || cantRecord)!}`)}</Problem>}
    </section>
  );
}

/** How long an audio file is, in seconds (null: not something the browser can play). */
function audioLength(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(null);
    a.src = url;
  });
}
