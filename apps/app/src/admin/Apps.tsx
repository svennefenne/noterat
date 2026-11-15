import { useEffect, useState } from "react";
import { Download, Monitor, Server, Smartphone } from "lucide-react";
import type { ServerInfo } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/sync-react";
import { BUILD, versionText, type AppRelease } from "../lib/updates";
import { AdminSection } from "./AdminScreen";

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

/**
 * The apps the server offers (decision 16): which build it is, and which builds of the Android app and the
 * desktop app come with it, to download for a new phone or computer. The ones installed update themselves.
 */
export function AppsSection() {
  const { t } = useI18n();
  const { api, base } = useSession();
  const [info, setInfo] = useState<{ server: ServerInfo | null; android: AppRelease | null; desktop: AppRelease | null } | null>(null);

  useEffect(() => {
    void Promise.all([api.serverInfo().catch(() => null), api.androidRelease().catch(() => null), api.desktopRelease().catch(() => null)]).then(([server, android, desktop]) =>
      setInfo({ server, android: android && android.build ? (android as AppRelease) : null, desktop }),
    );
  }, [api]);

  const rows: { Icon: typeof Server; label: string; release: AppRelease | null; version?: string }[] = info
    ? [
        { Icon: Server, label: t("admin.apps.server"), release: null, version: info.server ? versionText(t, BUILD.version, info.server.build) : "" },
        { Icon: Smartphone, label: t("admin.apps.android"), release: info.android },
        { Icon: Monitor, label: t("admin.apps.desktop"), release: info.desktop },
      ]
    : [];

  return (
    <AdminSection id="apps" intro={t("admin.apps.intro")}>
      {!info ? (
        <p className="muted">{t("lists.loading")}</p>
      ) : (
        <ul className="admin-apps">
          {rows.map(({ Icon, label, release, version }) => (
            <li key={label}>
              <Icon aria-hidden size={20} />
              <span className="admin-app-main">
                <strong>{label}</strong>
                <span className="muted small-text">
                  {release ? `${versionText(t, release.version, release.build)} · ${mb(release.size)}` : version || t("admin.apps.none")}
                  {!release && version && info.server && <span className="mono"> · {info.server.version.split("-").pop()?.slice(0, 7)}</span>}
                </span>
              </span>
              {release && (
                <a className="secondary small" href={`${base}${release.url}`} download>
                  <Download aria-hidden size={16} /> {t("update.download")}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small-text">{t("admin.apps.how")}</p>
    </AdminSection>
  );
}
