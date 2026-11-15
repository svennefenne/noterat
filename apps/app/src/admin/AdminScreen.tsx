import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, Bell, ChevronRight, Languages, Mail, Palette, Smartphone, Users, Wallet } from "lucide-react";
import { cleanHousehold, schemeOf } from "@noterat/core";
import type { AdminUser } from "../lib/api";
import { useDates } from "../lib/dates";
import { useHousehold } from "../lib/household";
import { useI18n, type TextKey } from "../lib/i18n";
import { useSession } from "../lib/sync-react";
import { MailAdminForm } from "../shell/MailSettings";
import { PushAdminForm } from "../shell/PushSettings";
import { Problem } from "../ui";
import { AppsSection } from "./Apps";
import { LocaleSection } from "./Locale";
import { LookSection } from "./Look";
import { UsersSection } from "./Users";

/**
 * The admin page (decision 14): the household's accounts and settings, one section at a time. On a wide
 * screen the sections are a list beside the open one; on a phone the list is the page, and a section
 * opens on a page of its own.
 */

const SECTIONS = [
  { key: "users", Icon: Users },
  { key: "look", Icon: Palette },
  { key: "locale", Icon: Languages },
  { key: "money", Icon: Wallet },
  { key: "push", Icon: Bell },
  { key: "mail", Icon: Mail },
  { key: "apps", Icon: Smartphone },
] as const;

export type AdminSectionKey = (typeof SECTIONS)[number]["key"];

/** Saving a part of the household's settings: at once on this device, then as the server has it. */
export function useSaveHousehold() {
  const { api } = useSession();
  const { household, set } = useHousehold();
  const { errorText } = useI18n();
  const [problem, setProblem] = useState("");
  const save = useCallback(
    async (patch: unknown) => {
      const was = household;
      setProblem("");
      set(cleanHousehold(patch, household));
      try {
        set(await api.setHousehold(patch));
      } catch (err) {
        set(was);
        setProblem(errorText(err));
      }
    },
    [api, household, set, errorText],
  );
  return { household, save, problem };
}

export function AdminScreen({ section }: { section?: string }) {
  const { t } = useI18n();
  const { user, api } = useSession();
  const { household } = useHousehold();
  const dates = useDates();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [problem, setProblem] = useState("");
  const { errorText } = useI18n();
  const open = SECTIONS.find((s) => s.key === section)?.key;

  const reload = useCallback(() => {
    api.adminUsers().then(setUsers, (e: unknown) => setProblem(errorText(e)));
  }, [api, errorText]);
  useEffect(() => {
    if (user.role === "admin") reload();
  }, [reload, user.role]);

  if (user.role !== "admin")
    return (
      <div className="screen">
        <h1>{t("admin.title")}</h1>
        <p className="muted">{t("admin.onlyAdmins")}</p>
      </div>
    );

  const summary: Record<AdminSectionKey, string> = {
    users: users ? t(users.length === 1 ? "admin.users.countOne" : "admin.users.count", { n: users.length }) : "",
    look: `${schemeOf(household.look.scheme).name} · ${t(`look.mode.${household.look.mode}`)}`,
    locale: [household.locale.lang === "sv" ? "Svenska" : "English", dates.day(new Date(), { year: true }), dates.time(new Date())].join(" · "),
    money: t(household.money.swish ? "admin.money.swishOn" : "admin.money.swishOff"),
    push: "",
    mail: "",
    apps: "",
  };

  const shown = open ?? "users";
  return (
    <div className={`screen admin${open ? " has-section" : ""}`}>
      <nav className="admin-nav" aria-label={t("admin.title")}>
        <h1>{t("admin.title")}</h1>
        <ul>
          {SECTIONS.map(({ key, Icon }) => (
            <li key={key}>
              <Link href={`/admin/${key}`} className="admin-nav-link" aria-current={shown === key ? "page" : undefined}>
                <Icon aria-hidden size={20} />
                <span>
                  {t(`admin.${key}.title` as TextKey)}
                  {summary[key] && <small>{summary[key]}</small>}
                </span>
                <ChevronRight aria-hidden size={18} className="admin-chevron" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <section className="admin-content" aria-labelledby="admin-section-title">
        <Link href="/admin" className="back admin-back">
          <ArrowLeft aria-hidden size={18} /> {t("admin.title")}
        </Link>
        {problem && <Problem>{problem}</Problem>}
        {shown === "users" && <UsersSection users={users} reload={reload} />}
        {shown === "look" && <LookSection />}
        {shown === "locale" && <LocaleSection />}
        {shown === "money" && <MoneySection />}
        {shown === "push" && (
          <AdminSection id="push" intro={t("admin.push.intro")}>
            <PushAdminForm />
          </AdminSection>
        )}
        {shown === "mail" && (
          <AdminSection id="mail" intro={t("admin.mail.intro")}>
            <MailAdminForm />
          </AdminSection>
        )}
        {shown === "apps" && <AppsSection />}
      </section>
    </div>
  );
}

/** A section's heading and what it's for, then its settings. */
export function AdminSection({ id, intro, action, children }: { id: AdminSectionKey; intro?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <div className="admin-head">
        <h2 id="admin-section-title">{t(`admin.${id}.title` as TextKey)}</h2>
        {action}
      </div>
      {intro && <p className="muted admin-intro">{intro}</p>}
      <div className="admin-body">{children}</div>
    </>
  );
}

/** One setting: its name and what it does, and its control. */
export function Setting({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="muted small-text">{hint}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

/** On or off. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)}>
      <span aria-hidden />
    </button>
  );
}

function MoneySection() {
  const { t } = useI18n();
  const { household, save, problem } = useSaveHousehold();
  return (
    <AdminSection id="money" intro={t("admin.money.intro")}>
      <Setting label={t("admin.money.swish")} hint={t(household.money.swish ? "admin.money.swishOnHint" : "admin.money.swishOffHint")}>
        <Switch on={household.money.swish} label={t("admin.money.swish")} onChange={(swish) => void save({ money: { swish } })} />
      </Setting>
      {problem && <Problem>{problem}</Problem>}
    </AdminSection>
  );
}
