import { useEffect, useEffectEvent } from "react";
import { App } from "@capacitor/app";
import { useLocation, useSearch } from "wouter";
import { isNative } from "./api";

/**
 * Ways in from the phone's home screen (phase 8): the launcher's shortcuts and the quick-actions widget
 * open noterat://<section>?<what to do>, as noterat://memos?record=1, and that becomes the section's
 * page with the same query (/memos?record=1); the page does what's asked and takes the query away.
 * Nothing on the home screen shows what's in the app, so nothing private is there and nothing has to
 * be kept up to date natively. Only the sections can be opened this way: a link can't lead anywhere else.
 */

const SECTIONS = ["lists", "notes", "memos", "scans", "journal", "recipes", "calendar", "budget"];

/** noterat://memos?record=1 → "/memos?record=1"; null for anything that isn't one of the sections. */
export function deepLinkPath(url: string): string | null {
  const m = /^noterat:\/\/\/?([a-z]+)\/?(\?[^#]*)?(?:#.*)?$/.exec(url.trim());
  if (!m || !SECTIONS.includes(m[1]!)) return null;
  const query = m[2] && m[2].length > 1 ? m[2] : "";
  return `/${m[1]}${query}`;
}

// At a cold start Android hands the link over twice, as the launch URL and as an appUrlOpen event (kept
// until something listens): the same link twice within a moment is one opening.
let last = { url: "", at: 0 };
// (the launch URL stays the same for as long as the app runs, so it's acted on once, not again each
// time the signed-in part mounts, as after logging out and in)
let launchTaken = false;

/** Follows the links the app is opened with (only in the Android app). */
export function useDeepLinks() {
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isNative) return;
    let gone = false;
    const open = (url: string | undefined) => {
      if (gone || !url) return;
      const now = Date.now();
      if (url === last.url && now - last.at < 2000) return;
      last = { url, at: now };
      const to = deepLinkPath(url);
      if (to) navigate(to);
    };
    const listener = App.addListener("appUrlOpen", (e) => open(e.url));
    void App.getLaunchUrl().then(
      (r) => {
        if (gone || launchTaken) return;
        launchTaken = true;
        open(r?.url);
      },
      () => {},
    );
    return () => {
      gone = true;
      void listener.then((l) => l.remove());
    };
  }, [navigate]);
}

/**
 * A page's part of such a link: when its address asks for `what` (?record=1), `act` runs once, as if
 * the page's own button had been pressed. The query is taken off the address first, so going back or
 * reloading doesn't do it again.
 */
export function useLinkedAction(what: string, act: () => void) {
  const search = useSearch();
  const [path, navigate] = useLocation();
  const onLinked = useEffectEvent(act);

  useEffect(() => {
    // (the address as it is now, not as it was rendered: StrictMode runs this twice in a row)
    if (new URLSearchParams(window.location.search).get(what) !== "1") return;
    navigate(path, { replace: true });
    onLinked();
  }, [what, search, path, navigate]);
}
