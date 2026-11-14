import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileAudio, Mic, Square, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { recordProblem, Recording, type RecordProblem } from "../lib/recorder";
import { Problem, useStored } from "../ui";
import { clock } from "./parts";

/** Whether recordings are turned into text (this device's choice, for memos and journal clips alike). */
export const useAutoTranscribe = () => useStored<"on" | "off">("noterat.memos.transcribe", "on");

/**
 * The record button: a tap starts, a tap stops, and what was said is handed on (a memo is made of it,
 * or it becomes a journal entry's clip). An audio file from elsewhere can be added too; and whether
 * recordings are turned into text is chosen here (for this device).
 */
export function RecordPanel({ onRecorded, compact = false }: { onRecorded: (blob: Blob, duration: number, name: string) => Promise<void>; compact?: boolean }) {
  const { t } = useI18n();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState<RecordProblem | "" | "file">("");
  const [auto, setAuto] = useAutoTranscribe();
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
    if (duration >= 0.5 && blob.size > 0) await onRecorded(blob, duration, "");
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
    await onRecorded(file, duration, file.name.replace(/\.[^.]+$/, ""));
  }

  return (
    <section className={`recorder${recording ? " recording" : ""}${compact ? " compact" : ""}`} aria-label={t("memos.record")}>
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
