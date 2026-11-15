import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { isDesktop } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { canPush, startPush } from "../lib/push";
import { useInvitations, useSession } from "../lib/sync-react";

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
 * On the desktop the app lives in the tray, so a new invitation is shown as the system's notification
 * when the window isn't in front (the phone gets a push for it instead).
 */
export function useDesktopNotices() {
  const { t } = useI18n();
  const invitations = useInvitations();
  const [, navigate] = useLocation();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!isDesktop || typeof Notification === "undefined") return;
    const ids = new Set(invitations.map((i) => i.id));
    // (the ones there when the app started were seen already)
    if (seen.current === null) {
      seen.current = ids;
      return;
    }
    for (const i of invitations) {
      if (seen.current.has(i.id)) continue;
      if (document.hasFocus()) continue;
      const n = new Notification("Noterat", { body: t("push.invitation", { from: i.from.displayName, what: t(`push.thing.${i.type}`) }), tag: i.id });
      n.onclick = () => {
        window.focus();
        navigate("/");
      };
    }
    seen.current = ids;
  }, [invitations, navigate, t]);
}
