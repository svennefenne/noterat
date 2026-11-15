import { useState, type ReactNode } from "react";
import { Bell, Cloud, CloudOff, HardDrive, Loader, Menu as MenuIcon, Search, UserRound } from "lucide-react";
import { Link, useLocation } from "wouter";
import { isApp } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useInvitations, useLock, useSession, useSyncState } from "../lib/sync-react";
import { pathOf, SECTION } from "../lib/things";
import { Menu, MenuItem, Problem } from "../ui";
import { NavDrawer } from "./NavDrawer";
import { PlusButton } from "./PlusButton";
import { isIn, SECTIONS } from "./sections";
import { UpdateBanner } from "./UpdateBanner";
import { BUILD, versionText } from "../lib/updates";

/**
 * The signed-in app's frame: the name (home), the sections (along the top on a wide screen; on a phone
 * in a menu behind the button left of the name, with a plus button low on the screen for making
 * something new), whether it's synced, invitations, and the account menu.
 */
export function Shell({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const { t } = useI18n();
  const { user, base, lock } = useSession();
  const { settings } = useLock();
  const [drawer, setDrawer] = useState(false);
  const [, navigate] = useLocation();
  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="icon-button topbar-menu" aria-label={t("nav.open")} title={t("nav.open")} aria-haspopup="dialog" aria-expanded={drawer} onClick={() => setDrawer(true)}>
          <MenuIcon aria-hidden size={22} />
        </button>
        <Link href="/" className="topbar-brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>Noterat</span>
        </Link>
        <Sections />
        <div className="topbar-actions">
          <SyncBadge />
          <Link href="/search" className="icon-button" aria-label={t("search.open")} title={t("search.open")}>
            <Search aria-hidden size={20} />
          </Link>
          <Invitations />
          <Menu label={t("menu.open")} icon={<UserRound aria-hidden size={20} />} className="end">
            <div className="menu-text">{t("menu.signedInAs", { name: user.displayName })}</div>
            {isApp && <div className="menu-text muted">{t("menu.server", { server: new URL(base).host })}</div>}
            <div className="menu-text muted">{t("menu.version", { version: versionText(t, BUILD.version, BUILD.build) })}</div>
            <MenuItem onSelect={() => navigate("/settings")}>{t("settings.menu")}</MenuItem>
            {user.role === "admin" && <MenuItem onSelect={() => navigate("/admin")}>{t("admin.menu")}</MenuItem>}
            {settings.scope !== "off" && <MenuItem onSelect={() => lock.lockNow()}>{t("lock.now")}</MenuItem>}
            <MenuItem onSelect={onLogout}>{t("menu.logout")}</MenuItem>
          </Menu>
        </div>
      </header>
      <main className="content">
        <UpdateBanner />
        {children}
      </main>
      <PlusButton />
      <NavDrawer open={drawer} onClose={() => setDrawer(false)} />
    </div>
  );
}

/** The sections along the top (a wide screen; a phone has them in the menu instead). */
function Sections() {
  const { t } = useI18n();
  const [location] = useLocation();
  return (
    <nav className="sections" aria-label={t("section.nav")}>
      {SECTIONS.map(({ type, Icon }) => (
        <Link key={type} href={SECTION[type]} className="section-link" aria-current={isIn(location, type) ? "page" : undefined} title={t(`section.${type}`)}>
          <Icon aria-hidden size={20} />
          <span>{t(`section.${type}`)}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Synced, connecting, or offline (with changes kept on the device meanwhile). */
function SyncBadge() {
  const { t } = useI18n();
  const { connection, waiting } = useSyncState();
  const [icon, text, hint, kind] =
    connection === "online" && waiting === 0
      ? [<Cloud key="c" aria-hidden size={16} />, t("sync.online"), "", "ok"]
      : connection === "online" || connection === "connecting"
        ? [<Loader key="l" aria-hidden size={16} className="spin" />, waiting > 0 ? t("sync.waiting") : t("sync.connecting"), t("sync.waitingHint"), "busy"]
        : [waiting > 0 ? <HardDrive key="h" aria-hidden size={16} /> : <CloudOff key="o" aria-hidden size={16} />, waiting > 0 ? t("sync.waiting") : t("sync.offline"), t("sync.offlineHint"), "off"];
  return (
    <span className={`sync-badge ${kind}`} title={hint || undefined} role="status">
      {icon}
      <span className="sync-text">{text}</span>
    </span>
  );
}

/** Invitations from people on the server, with a count; accepting opens what's shared. */
function Invitations() {
  const { t, errorText } = useI18n();
  const { api } = useSession();
  const invitations = useInvitations();
  const [, navigate] = useLocation();
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  async function answer(id: string, accept: boolean) {
    setBusy(true);
    setProblem("");
    try {
      if (accept) {
        const r = await api.acceptInvitation(id);
        navigate(pathOf(r.type, r.objectId));
      } else await api.declineInvitation(id);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Menu
      label={t("invitations.open")}
      className="end invitations"
      icon={
        <>
          <Bell aria-hidden size={20} />
          {invitations.length > 0 && <span className="count">{invitations.length}</span>}
        </>
      }
    >
      <div className="menu-heading">{t("invitations.title")}</div>
      {invitations.length === 0 && <div className="menu-text muted">{t("invitations.none")}</div>}
      {invitations.map((i) => (
        <div key={i.id} className="invitation">
          <p>{t("invitations.text", { name: i.from.displayName, title: i.title || t(`untitled.${i.type}`) })}</p>
          <p className="muted small-text">{t(i.role === "editor" ? "invitations.editor" : "invitations.viewer")}</p>
          <div className="invitation-actions">
            <button type="button" role="menuitem" className="primary small" disabled={busy} onClick={() => void answer(i.id, true)}>
              {t("invitations.accept")}
            </button>
            <button type="button" role="menuitem" className="secondary small" disabled={busy} onClick={() => void answer(i.id, false)}>
              {t("invitations.decline")}
            </button>
          </div>
        </div>
      ))}
      {problem && <Problem>{problem}</Problem>}
    </Menu>
  );
}
