import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Download, X } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/sync-react";

interface Release {
  versionName: string;
  versionCode: number;
  url: string;
}

const DISMISSED = "noterat.update.dismissed";

/**
 * A newer Android app on the server (decision 12): said once at the top, with the download, until it's
 * installed or waved away. The phone installs it over the old one; nothing is lost.
 */
export function UpdateBanner() {
  const { t } = useI18n();
  const { base, api } = useSession();
  const [release, setRelease] = useState<Release | null>(null);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    let gone = false;
    void (async () => {
      try {
        const [info, r] = await Promise.all([App.getInfo(), api.androidRelease()]);
        const dismissed = Number(localStorage.getItem(DISMISSED) ?? 0);
        if (!gone && r && r.versionCode > Number(info.build) && r.versionCode !== dismissed) setRelease(r);
      } catch {
        // (offline, or an older server: no news is fine)
      }
    })();
    return () => {
      gone = true;
    };
  }, [api]);

  if (!release) return null;
  return (
    <div className="update-banner" role="status">
      <span>{t("update.available", { version: `${release.versionName} (${release.versionCode})` })}</span>
      <a className="primary small" href={`${base}${release.url}`} target="_blank" rel="noreferrer">
        <Download aria-hidden size={16} /> {t("update.download")}
      </a>
      <button
        type="button"
        className="icon-button"
        aria-label={t("update.later")}
        onClick={() => {
          try {
            localStorage.setItem(DISMISSED, String(release.versionCode));
          } catch {
            // (no storage: it's asked again next time)
          }
          setRelease(null);
        }}
      >
        <X aria-hidden size={18} />
      </button>
    </div>
  );
}
