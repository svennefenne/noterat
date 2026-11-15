import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Download, RotateCw, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { AppUpdate, desktop, versionText } from "../lib/updates";
import { useSession } from "../lib/sync-react";

/** what's ready: an APK downloaded (allow: Android's setting for installing apps was opened), a desktop app replaced, or (an older server) a link */
type Ready =
  | { kind: "android"; version: string; build: number; allow: boolean }
  | { kind: "desktop"; build: number }
  | { kind: "link"; version: string; build: number; url: string };

const DISMISSED = "noterat.update.dismissed";
const EVERY = 6 * 60 * 60 * 1000;

const dismissed = () => {
  try {
    return Number(localStorage.getItem(DISMISSED) ?? 0);
  } catch {
    return 0;
  }
};

/**
 * The apps' updates (decision 16), looked for at the start, back from the background and every six
 * hours. The phone downloads a newer APK by itself and offers to install it (Android asks then); the
 * desktop app replaces itself and offers to start again (hidden in the tray, it starts again by itself).
 */
export function UpdateBanner() {
  const { t } = useI18n();
  const { base, api } = useSession();
  const [ready, setReady] = useState<Ready | null>(null);

  useEffect(() => {
    const android = Capacitor.getPlatform() === "android";
    if (!android && !desktop?.updates) return;
    let gone = false;
    let busy = false;
    const check = async () => {
      if (busy || gone) return;
      busy = true;
      try {
        if (android) {
          const [info, r] = await Promise.all([App.getInfo(), api.androidRelease()]);
          const build = r ? (r.build ?? r.versionCode) : 0;
          if (!r || build <= Number(info.build)) {
            await AppUpdate.clean().catch(() => {});
            return;
          }
          if (build === dismissed()) return;
          const version = r.version ?? r.versionName;
          if (!r.sha256) {
            if (!gone) setReady({ kind: "link", version, build, url: `${base}${r.url}` });
            return;
          }
          await AppUpdate.download({ url: `${base}${r.url}`, sha256: r.sha256, build });
          if (!gone) setReady((was) => (was?.kind === "android" && was.build === build ? was : { kind: "android", version, build, allow: false }));
        } else {
          const r = await desktop!.update!(base || location.origin);
          if (r.status === "updated" && r.build && r.build !== dismissed() && !gone) setReady({ kind: "desktop", build: r.build });
        }
      } catch {
        // (offline, or the server has none, or the download broke: asked again later)
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), EVERY);
    const back = android ? App.addListener("resume", () => void check()) : null;
    const online = () => void check();
    window.addEventListener("online", online);
    return () => {
      gone = true;
      clearInterval(timer);
      void back?.then((h) => h.remove());
      window.removeEventListener("online", online);
    };
  }, [api, base]);

  if (!ready) return null;
  const later = () => {
    try {
      localStorage.setItem(DISMISSED, String(ready.build));
    } catch {
      // (no storage: it's offered again next time)
    }
    setReady(null);
  };

  return (
    <div className="update-banner" role="status">
      {ready.kind === "android" ? (
        <>
          <span>{t(ready.allow ? "update.allow" : "update.ready", { version: versionText(t, ready.version, ready.build) })}</span>
          <button
            type="button"
            className="primary small"
            onClick={async () => {
              try {
                const r = await AppUpdate.install({ build: ready.build });
                if (!r.allowed) setReady({ ...ready, allow: true });
              } catch {
                setReady(null);
              }
            }}
          >
            <Download aria-hidden size={16} /> {t("update.install")}
          </button>
        </>
      ) : ready.kind === "desktop" ? (
        <>
          <span>{t("update.installed", { build: ready.build })}</span>
          <button type="button" className="primary small" onClick={() => desktop?.restart?.()}>
            <RotateCw aria-hidden size={16} /> {t("update.restart")}
          </button>
        </>
      ) : (
        <>
          <span>{t("update.available", { version: versionText(t, ready.version, ready.build) })}</span>
          <a className="primary small" href={ready.url} target="_blank" rel="noreferrer">
            <Download aria-hidden size={16} /> {t("update.download")}
          </a>
        </>
      )}
      <button type="button" className="icon-button" aria-label={t("update.later")} title={t("update.later")} onClick={later}>
        <X aria-hidden size={18} />
      </button>
    </div>
  );
}
