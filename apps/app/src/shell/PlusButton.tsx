import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { BookHeart, CalendarDays, ChefHat, ListChecks, Mic, NotebookPen, Plus, ScanLine, Wallet } from "lucide-react";
import { Link, useLocation } from "wouter";
import { initMemo } from "@noterat/core";
import { useCloseOnBack } from "../lib/back";
import { hashOf } from "../lib/files";
import { useI18n, type TextKey } from "../lib/i18n";
import { usePlusSide } from "../lib/plusSide";
import { recordProblem, Recording, type RecordProblem } from "../lib/recorder";
import { useSession } from "../lib/sync-react";
import { clock } from "../memos/parts";

/**
 * What the plus button makes, nearest it first. Each opens its section asking for a new one (as the
 * section's own New button does: see useLinkedAction), so what happens there is the section's own.
 */
const ITEMS = [
  { key: "note", Icon: NotebookPen, to: "/notes?new=1" },
  { key: "list", Icon: ListChecks, to: "/lists?new=1" },
  { key: "event", Icon: CalendarDays, to: "/calendar?new=1" },
  { key: "journal", Icon: BookHeart, to: "/journal?new=1" },
  { key: "recipe", Icon: ChefHat, to: "/recipes?new=1" },
  { key: "scan", Icon: ScanLine, to: "/scans?scan=1" },
  { key: "money", Icon: Wallet, to: "/budget?add=1" },
] as const;

/** (a finger this far from the microphone, when it lets go, means "don't keep it") */
const AWAY = 72;

type Notice = { kind: "hint" | "problem"; text: string } | { kind: "saved"; id: string };

/**
 * The phone's plus button (decision 17), low where the thumb reaches it (right, left or in the middle, as
 * chosen under Settings → Appearance). A tap opens what it makes; above it the microphone: held down, it
 * records a voice memo, kept (and written out as text) when let go, or let go of when the finger has
 * slid away from it.
 */
export function PlusButton() {
  const { t } = useI18n();
  const { sync, user } = useSession();
  const [location, navigate] = useLocation();
  const [side] = usePlusSide();
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [away, setAway] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const listId = useId();
  // (the hold, as the pointer events see it: what they decide on mustn't wait for a render)
  const hold = useRef({ down: false, starting: false, away: false, x: 0, y: 0, recording: null as Recording | null });

  useCloseOnBack(open && !recording, () => setOpen(false));

  // another page: what was open over the last one closes
  const [shownAt, setShownAt] = useState(location);
  if (shownAt !== location) {
    setShownAt(location);
    setOpen(false);
  }

  // the clock and the meter while recording
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

  // a notice goes by itself after a while (a saved memo's a little later: it has a link to it)
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.kind === "saved" ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  // (leaving the app's signed-in part while recording: what's recorded is let go)
  useEffect(() => {
    const h = hold.current;
    return () => h.recording?.cancel();
  }, []);

  useEffect(() => {
    if (!open) return;
    const escape = (e: globalThis.KeyboardEvent) => e.key === "Escape" && !hold.current.recording && setOpen(false);
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);

  async function press(x: number, y: number) {
    const h = hold.current;
    if (h.down || h.starting) return;
    Object.assign(h, { down: true, away: false, x, y });
    setAway(false);
    setNotice(null);
    const problem = recordProblem();
    if (problem) return setNotice({ kind: "problem", text: t(`record.${problem}`) });
    h.starting = true;
    try {
      const r = await Recording.start();
      // (let go while it was starting, as while Android asked for the microphone the first time)
      if (!h.down) {
        r.cancel();
        return setNotice({ kind: "hint", text: t("plus.hold") });
      }
      h.recording = r;
      setElapsed(0);
      setLevel(0);
      setRecording(r);
    } catch (err) {
      setNotice({ kind: "problem", text: t(`record.${err as RecordProblem}`) });
    } finally {
      h.starting = false;
    }
  }

  function move(x: number, y: number) {
    const h = hold.current;
    if (!h.recording) return;
    const far = Math.hypot(x - h.x, y - h.y) > AWAY;
    if (far !== h.away) {
      h.away = far;
      setAway(far);
    }
  }

  async function release() {
    const h = hold.current;
    if (!h.down) return;
    h.down = false;
    const r = h.recording;
    // (not recording yet: a tap, or the start still on its way, which then lets it go)
    if (!r) {
      if (!h.starting) setNotice((n) => n ?? { kind: "hint", text: t("plus.hold") });
      return;
    }
    h.recording = null;
    setRecording(null);
    if (h.away) {
      r.cancel();
      return setNotice({ kind: "hint", text: t("plus.cancelled") });
    }
    const { blob, duration } = await r.stop();
    if (duration < 0.5 || blob.size === 0) return setNotice({ kind: "hint", text: t("plus.hold") });
    const hash = await hashOf(blob);
    const id = sync.create("memo", (doc) =>
      initMemo(doc, { title: "", audio: { hash, type: blob.type || "audio/webm", size: blob.size, duration }, transcribe: true, by: user.id }),
    );
    await sync.files.add(blob, id);
    setOpen(false);
    setNotice({ kind: "saved", id });
  }

  const pointer = {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      // (the finger keeps this button as it moves, and no text gets picked on a long press)
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // (a pointer the browser doesn't know as down: it's held without)
      }
      void press(e.clientX, e.clientY);
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => move(e.clientX, e.clientY),
    onPointerUp: () => void release(),
    onPointerCancel: () => void release(),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    // the keyboard's way: Space or Enter held down
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) {
        e.preventDefault();
        void press(0, 0);
      }
    },
    onKeyUp: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === " " || e.key === "Enter") void release();
    },
  };

  const bubble = recording ? (
    <div className={`plus-bubble recording${away ? " away" : ""}`} role="status">
      <span className="rec-dot" aria-hidden />
      <span className="plus-clock">{clock(elapsed)}</span>
      <span className="plus-level" aria-hidden>
        <span style={{ transform: `scaleX(${0.06 + level * 0.94})` }} />
      </span>
      <span className="plus-say">{t(away ? "plus.releaseCancel" : "plus.release")}</span>
    </div>
  ) : notice ? (
    <div className={`plus-bubble ${notice.kind}`} role="status">
      {notice.kind === "saved" ? (
        <>
          <span>{t("plus.saved")}</span>
          <Link href={`/memos/${notice.id}`} onClick={() => setNotice(null)}>
            {t("plus.show")}
          </Link>
        </>
      ) : (
        <span>{notice.text}</span>
      )}
    </div>
  ) : null;

  return (
    <div className={`plus ${side}${open ? " open" : ""}${recording ? " recording" : ""}`}>
      {open && <div className="plus-scrim" aria-hidden onClick={() => !recording && setOpen(false)} />}
      {open && (
        <ul className="plus-items" id={listId} aria-label={t("plus.open")}>
          {[...ITEMS].reverse().map(({ key, Icon, to }, i) => (
            <li key={key} style={{ "--i": ITEMS.length - 1 - i } as CSSProperties}>
              <button
                type="button"
                className="plus-item"
                onClick={() => {
                  setOpen(false);
                  navigate(to);
                }}
              >
                <span className="plus-label">{t(`plus.${key}` as TextKey)}</span>
                <span className="plus-icon">
                  <Icon aria-hidden size={20} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="plus-row">
          {bubble}
          <button type="button" className="plus-mic" aria-label={t("plus.mic")} title={t("plus.mic")} aria-pressed={!!recording} {...pointer}>
            <span className="plus-ring" aria-hidden style={{ transform: `scale(${1 + level * 0.45})` }} />
            <Mic aria-hidden size={26} />
          </button>
        </div>
      )}
      <div className="plus-row">
        {!open && bubble}
        <button
          type="button"
          className="plus-main"
          aria-label={t(open ? "plus.close" : "plus.open")}
          title={t(open ? "plus.close" : "plus.open")}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          disabled={!!recording}
          onClick={() => {
            setNotice(null);
            setOpen((o) => !o);
          }}
        >
          <Plus aria-hidden size={30} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
