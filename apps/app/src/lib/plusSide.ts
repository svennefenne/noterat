import { useSyncExternalStore } from "react";

/**
 * Where on the phone's screen the plus button sits (this device's choice, under Settings → Appearance):
 * the right, the left for a left hand, or the middle. Kept on the device; every part of the app that
 * shows it follows a change at once.
 */
export type PlusSide = "right" | "left" | "center";
export const PLUS_SIDES: PlusSide[] = ["left", "center", "right"];

const KEY = "noterat.plus.side";
const listeners = new Set<() => void>();

function read(): PlusSide {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "left" || saved === "center" ? saved : "right";
  } catch {
    return "right";
  }
}

let side = read();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function setPlusSide(next: PlusSide) {
  side = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // (kept until the app closes)
  }
  for (const l of listeners) l();
}

export function usePlusSide(): [PlusSide, (side: PlusSide) => void] {
  return [useSyncExternalStore(subscribe, () => side), setPlusSide];
}
