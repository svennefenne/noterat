import type { User } from "@noterat/core";
import { isApp } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { Page } from "../ui";

/**
 * Logged in. For now a greeting and who and where you are; from phase 1 on the sections (Lists first)
 * take this place.
 */
export function HomeScreen({ user, base, offline, onLogout }: { user: User; base: string; offline: boolean; onLogout: () => void }) {
  const { t } = useI18n();
  return (
    <Page title={t("home.hello", { name: user.displayName })} intro={t("home.intro")}>
      {offline && (
        <p className="notice" role="status">
          {t("home.offline")}
        </p>
      )}
      <dl className="facts">
        <dt>{t("home.signedInAs")}</dt>
        <dd>
          {user.displayName} <span className="muted">({user.username})</span>
        </dd>
        {isApp && (
          <>
            <dt>{t("home.server")}</dt>
            <dd>{new URL(base).host}</dd>
          </>
        )}
      </dl>
      <button type="button" className="secondary" onClick={onLogout}>
        {t("home.logout")}
      </button>
    </Page>
  );
}
