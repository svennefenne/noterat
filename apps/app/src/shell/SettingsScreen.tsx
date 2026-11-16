import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, Bell, ChevronRight, Languages, LockKeyhole, Palette } from "lucide-react";
import { schemeOf } from "@noterat/core";
import { MyLookForm } from "../admin/Look";
import { Setting } from "../admin/AdminScreen";
import { useHousehold } from "../lib/household";
import { useI18n, type Lang, type TextKey } from "../lib/i18n";
import { usePlusSide } from "../lib/plusSide";
import { useLock } from "../lib/sync-react";
import { LockSettingsForm } from "./LockGate";
import { NotificationSettingsForm } from "./PushSettings";

/**
 * This person's own settings, on this device (decision 17): how the app looks (and which side the
 * phone's plus button is on), its language, notifications and the lock. Laid out as the admin page is:
 * the sections beside the open one on a wide screen, one at a time on a phone.
 */

const SECTIONS = [
  { key: "look", Icon: Palette },
  { key: "lang", Icon: Languages },
  { key: "notices", Icon: Bell },
  { key: "lock", Icon: LockKeyhole },
] as const;

type Key = (typeof SECTIONS)[number]["key"];
const LANGS: Record<Lang, string> = { sv: "Svenska", en: "English" };

export function SettingsScreen({ section }: { section?: string }) {
  const { t, lang, chosen } = useI18n();
  const { household, mine, look } = useHousehold();
  const { settings } = useLock();
  const [side] = usePlusSide();
  const open = SECTIONS.find((s) => s.key === section)?.key;
  const shown = open ?? "look";

  const summary: Record<Key, string> = {
    look: [
      mine.scheme === null && mine.mode === null ? t("settings.followsHousehold") : `${schemeOf(look.scheme).name} · ${t(`look.mode.${look.mode}`)}`,
      t(`settings.plus.${side}`),
    ].join(" · "),
    lang: chosen ? LANGS[lang] : `${LANGS[household.locale.lang]} · ${t("settings.followsHousehold").toLowerCase()}`,
    notices: "",
    lock: t(`lock.scope.${settings.scope}`),
  };

  return (
    <div className={`screen admin settings${open ? " has-section" : ""}`}>
      <nav className="admin-nav" aria-label={t("settings.title")}>
        <h1>{t("settings.title")}</h1>
        <ul>
          {SECTIONS.map(({ key, Icon }) => (
            <li key={key}>
              <Link href={`/settings/${key}`} className="admin-nav-link" aria-current={shown === key ? "page" : undefined}>
                <Icon aria-hidden size={20} />
                <span>
                  {t(`settings.${key}.title` as TextKey)}
                  {summary[key] && <small>{summary[key]}</small>}
                </span>
                <ChevronRight aria-hidden size={18} className="admin-chevron" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section className="admin-content" aria-labelledby="settings-section-title">
        <Link href="/settings" className="back admin-back">
          <ArrowLeft aria-hidden size={18} /> {t("settings.title")}
        </Link>
        <div className="admin-head">
          <h2 id="settings-section-title">{t(`settings.${shown}.title` as TextKey)}</h2>
        </div>
        {t(`settings.${shown}.intro` as TextKey) && <p className="muted admin-intro">{t(`settings.${shown}.intro` as TextKey)}</p>}
        <div className="admin-body">
          {shown === "look" && <MyLookForm />}
          {shown === "lang" && <LangSettings />}
          {shown === "notices" && (
            <Saving key="notices">{(saved) => <NotificationSettingsForm onDone={saved} />}</Saving>
          )}
          {shown === "lock" && <Saving key="lock">{(saved) => <LockSettingsForm onDone={saved} />}</Saving>}
        </div>
      </section>
    </div>
  );
}

function LangSettings() {
  const { t, chosen, setLang } = useI18n();
  const { household } = useHousehold();
  return (
    <Setting label={t("settings.lang.label")} hint={t("settings.lang.hint", { lang: LANGS[household.locale.lang] })}>
      <div className="segmented" role="group" aria-label={t("settings.lang.label")}>
        <button type="button" aria-pressed={chosen === null} onClick={() => setLang(null)}>
          {t("look.household")}
        </button>
        {(Object.keys(LANGS) as Lang[]).map((l) => (
          <button key={l} type="button" lang={l} aria-pressed={chosen === l} onClick={() => setLang(l)}>
            {LANGS[l]}
          </button>
        ))}
      </div>
    </Setting>
  );
}

/** A form that saves with its own button: "Saved" under it a while after it has. */
function Saving({ children }: { children: (saved: () => void) => ReactNode }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(0), 4000);
    return () => clearTimeout(timer);
  }, [saved]);
  return (
    <>
      {children(() => setSaved((n) => n + 1))}
      <p className="muted small-text settings-saved" role="status">
        {saved ? t("settings.saved") : ""}
      </p>
    </>
  );
}
