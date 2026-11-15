import { useEffect, useEffectEvent } from "react";

/**
 * Android's back button closes what's open over the page (the menu of sections, the plus button's
 * choices, a dialog, a menu) before it goes back a page: the one opened last first.
 */
const opened: (() => void)[] = [];

/** Closes what was opened last; false when nothing is open (then the back button goes back a page). */
export function closeTop(): boolean {
  const close = opened.pop();
  if (!close) return false;
  close();
  return true;
}

/** While `open`, the back button closes it. */
export function useCloseOnBack(open: boolean, close: () => void) {
  const onClose = useEffectEvent(close);
  useEffect(() => {
    if (!open) return;
    const entry = () => onClose();
    opened.push(entry);
    return () => {
      const i = opened.lastIndexOf(entry);
      if (i >= 0) opened.splice(i, 1);
    };
  }, [open]);
}
