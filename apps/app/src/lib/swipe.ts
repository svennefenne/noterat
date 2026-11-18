import { useEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";

/** Which way a swipe goes on: to what comes after (a swipe to the left), or before (to the right). */
export type SwipeWay = 1 | -1;

const SLOP = 10;
const IN = 220;
const BACK = 200;
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
/** how far back the finger's speed is measured when it lets go (ms) */
const TRAIL = 60;

/** What a swipe that starts here leaves alone: what's written in, a dialog, and anything that scrolls sideways itself. */
function leftAlone(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof Element)) return true;
  // (a part of the page with its own swipe takes it: the calendar's month inside the calendar section)
  if (target.closest("[data-swipe]") !== root) return true;
  if (target.closest("input, textarea, select, [contenteditable='true'], dialog")) return true;
  for (let el: Element | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

/**
 * A sideways swipe with a finger (a mouse drags and selects as before) on an element marked `data-swipe`:
 * it follows the finger, and swiped far enough, or flicked, `onSwipe` is called the moment the finger
 * lets go and what's there then slides in from the side the finger left room on. Up and down still
 * scroll; the element's CSS lets the browser have those (`touch-action: pan-y pinch-zoom`).
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, onSwipe: (way: SwipeWay) => void, enabled = true) {
  const latest = useRef(onSwipe);
  useEffect(() => {
    latest.current = onSwipe;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)");
    let start: { id: number; x: number; y: number } | null = null;
    let dragging = false;
    // (where the finger has been lately, for how fast it's going when it lets go)
    let trail: { x: number; at: number }[] = [];

    const fade = (dx: number) => 1 - Math.min(0.6, Math.abs(dx) / el.clientWidth);

    const place = (dx: number) => {
      if (still.matches) return;
      el.style.transform = dx ? `translateX(${dx}px)` : "";
      el.style.opacity = dx ? String(fade(dx)) : "";
      // (its own layer while it moves, so following the finger is only moving a picture)
      el.style.willChange = dx ? "transform, opacity" : "";
    };

    const back = (dx: number) => {
      place(0);
      if (!still.matches && dx)
        el.animate([{ transform: `translateX(${dx}px)`, opacity: fade(dx) }, { transform: "none", opacity: 1 }], { duration: BACK, easing: EASE_OUT });
    };

    const go = (way: SwipeWay, dx: number) => {
      place(0);
      // (what comes next drawn at once, with no wait for what was there to leave)
      flushSync(() => latest.current(way));
      if (still.matches) return;
      const room = el.clientWidth - Math.abs(dx);
      const from = way * Math.max(32, Math.min(96, room * 0.4));
      el.animate([{ transform: `translateX(${from}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: IN, easing: EASE_OUT });
    };

    const note = (e: PointerEvent) => {
      trail.push({ x: e.clientX, at: e.timeStamp });
      while (trail.length > 2 && e.timeStamp - trail[0]!.at > TRAIL) trail.shift();
    };

    /** how fast the finger is going sideways (px/ms, to the right is more) */
    const speed = () => {
      const first = trail[0];
      const last = trail[trail.length - 1];
      if (!first || !last || last.at - first.at < 1) return 0;
      return (last.x - first.x) / (last.at - first.at);
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !e.isPrimary || leftAlone(e.target, el)) return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
      dragging = false;
      trail = [];
      note(e);
    };

    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      note(e);
      if (!dragging) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        // (more up and down than sideways: it's scrolling, not a swipe)
        if (Math.abs(dx) < Math.abs(dy) * 1.5) {
          start = null;
          return;
        }
        dragging = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // (the finger's already gone)
        }
      }
      place(dx);
    };

    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      note(e);
      const v = speed();
      start = null;
      if (!dragging) return;
      dragging = false;
      // (the finger let go over something: that's not a tap on it)
      const swallow = (c: Event) => {
        c.stopPropagation();
        c.preventDefault();
      };
      el.addEventListener("click", swallow, true);
      setTimeout(() => el.removeEventListener("click", swallow, true), 100);
      const onward = Math.sign(v) === Math.sign(dx);
      // far enough, unless the finger was on its way back when it let go; or flicked
      const far = Math.abs(dx) > Math.min(120, el.clientWidth * 0.3) && (onward || Math.abs(v) < 0.2);
      const flick = onward && Math.abs(v) > 0.4 && Math.abs(dx) > 30;
      if (far || flick) go(dx < 0 ? 1 : -1, dx);
      else back(dx);
    };

    const cancel = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      // (where the finger last was: a cancel needn't say)
      const dx = (trail[trail.length - 1]?.x ?? start.x) - start.x;
      start = null;
      if (dragging) back(dx);
      dragging = false;
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      place(0);
    };
  }, [ref, enabled]);
}
