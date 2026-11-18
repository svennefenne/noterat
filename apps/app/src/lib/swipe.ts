import { useEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";

/** Which way a swipe goes on: to what comes after (a swipe to the left), or before (to the right). */
export type SwipeWay = 1 | -1;

const SLOP = 10;
const OUT = 150;
const IN = 240;
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

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
 * it follows the finger a little, and swiped far enough, or flicked, it slides out, `onSwipe` is called,
 * and what's there then slides in from the side the finger came from. Up and down still scroll; the
 * element's CSS lets the browser have those (`touch-action: pan-y pinch-zoom`).
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
    let start: { id: number; x: number; y: number; at: number } | null = null;
    let dragging = false;

    const place = (dx: number) => {
      if (still.matches) return;
      el.style.transform = dx ? `translateX(${dx * 0.4}px)` : "";
      el.style.opacity = dx ? String(1 - Math.min(0.5, Math.abs(dx) / el.clientWidth)) : "";
    };

    const back = (dx: number) => {
      place(0);
      if (!still.matches && dx) el.animate([{ transform: `translateX(${dx * 0.4}px)` }, { transform: "none" }], { duration: 200, easing: EASE_OUT });
    };

    const go = (way: SwipeWay, dx: number) => {
      if (still.matches) return latest.current(way);
      const from = { transform: el.style.transform || "none", opacity: el.style.opacity || "1" };
      place(0);
      const duration = OUT * (1 - Math.min(0.5, Math.abs(dx) / el.clientWidth));
      const out = el.animate([from, { transform: `translateX(${-way * 48}px)`, opacity: 0 }], { duration, easing: EASE_IN, fill: "forwards" });
      // (by the clock, not the animation's end, which waits for frames a hidden page doesn't draw)
      setTimeout(() => {
        // (what comes next drawn at once, still hidden, to slide in)
        flushSync(() => latest.current(way));
        out.cancel();
        el.animate([{ transform: `translateX(${way * 48}px)`, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: IN, easing: EASE_OUT });
      }, duration);
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !e.isPrimary || leftAlone(e.target, el)) return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp };
      dragging = false;
    };

    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
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
      const fast = Math.abs(dx) / Math.max(1, e.timeStamp - start.at) > 0.5;
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
      if (Math.abs(dx) > Math.min(120, el.clientWidth * 0.3) || (fast && Math.abs(dx) > 40)) go(dx < 0 ? 1 : -1, dx);
      else back(dx);
    };

    const cancel = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      if (dragging) back(0);
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
