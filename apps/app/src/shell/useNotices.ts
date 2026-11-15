import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { isDesktop } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { canPush, startPush } from "../lib/push";
import { useSession } from "../lib/sync-react";

/** Push on the phone: started once signed in (if the server has it), taps lead into the app. */
export function usePush() {
  const { api } = useSession();
  const { lang } = useI18n();
  const [, navigate] = useLocation();
  // (the latest navigate, without starting push again when it changes)
  const go = useRef(navigate);
  useEffect(() => {
    go.current = navigate;
  });
  useEffect(() => {
    if (!canPush) return;
    let stop = () => {};
    let gone = false;
    startPush(api, lang, (path) => go.current(path))
      .then((s) => (gone ? s() : (stop = s)))
      .catch((e: unknown) => console.warn("push:", e));
    return () => {
      gone = true;
      stop();
    };
  }, [api, lang]);
}

/**
 * On the desktop the app lives in the tray, so the server's notices (the ones a phone gets a push for:
 * an invitation, a memo turned into text, a scan read, a test) are the system's notifications while it
 * runs. They come over the sync connection (Sync's notices), sent as the person chose, quiet hours too.
 */
export function useDesktopNotices() {
  const { t } = useI18n();
  const { sync } = useSession();
  const [, navigate] = useLocation();
  const go = useRef(navigate);
  useEffect(() => {
    go.current = navigate;
  });
  useEffect(() => {
    if (!isDesktop || typeof Notification === "undefined") return;
    return sync.onNotice((n) => {
      const body =
        n.notice === "invitation" ? t("push.invitation", { from: n.from ?? "", what: n.type ? t(`push.thing.${n.type}`) : "" }) : t(`push.notice.${n.notice}`);
      const shown = new Notification("Noterat", { body });
      shown.onclick = () => {
        window.focus();
        go.current(n.url);
      };
    });
  }, [sync, t]);
}
