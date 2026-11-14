import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ErrorCode, ServerInfo, SessionReply } from "@noterat/core";
import { api, ApiError, isApp, server, session, type Session } from "./lib/api";
import { useI18n } from "./lib/i18n";
import { LoginScreen, SetupScreen } from "./screens/AccountScreens";
import { HomeScreen } from "./screens/HomeScreen";
import { ServerScreen } from "./screens/ServerScreen";
import { Page } from "./ui";

/**
 * Which screen shows. With a session on the device the app opens straight to it (offline too) and
 * checks it with the server meanwhile; without one it asks the server whether it needs its first
 * account or a log-in. The Android app first asks which server.
 */
type Screen =
  | { name: "loading" }
  | { name: "server"; last: string | null }
  | { name: "unreachable"; base: string }
  | { name: "setup"; base: string }
  | { name: "login"; base: string; notice?: ErrorCode }
  | { name: "home"; base: string; session: Session; offline: boolean };

type SetScreen = Dispatch<SetStateAction<Screen>>;

function firstScreen(): Screen {
  const base = server.load();
  if (base === null) return { name: "server", last: null };
  const s = session.load();
  return s ? { name: "home", base, session: s, offline: false } : { name: "loading" };
}

/** Without a session: the first account, or a log-in (or the server isn't answering). */
async function askServer(base: string, set: SetScreen, notice?: ErrorCode) {
  try {
    const info = await api.serverInfo(base);
    set(info.needsSetup ? { name: "setup", base } : { name: "login", base, notice });
  } catch {
    set({ name: "unreachable", base });
  }
}

/** With a session: still good (and who it's for now), ended (log in again), or no answer (offline). */
async function checkSession(base: string, s: Session, set: SetScreen) {
  try {
    const user = await api.me(base, s.token);
    session.save({ token: s.token, user });
    set((cur) => (cur.name === "home" ? { ...cur, session: { token: s.token, user }, offline: false } : cur));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      session.clear();
      await askServer(base, set, "unauthorized");
    } else set((cur) => (cur.name === "home" ? { ...cur, offline: true } : cur));
  }
}

export function App() {
  const { t, errorText } = useI18n();
  const [screen, setScreen] = useState<Screen>(firstScreen);

  // at the start: check the session kept on the device, or ask the server what's next
  useEffect(() => {
    const base = server.load();
    if (base === null) return;
    const s = session.load();
    if (s) void checkSession(base, s, setScreen);
    else void askServer(base, setScreen);
  }, []);

  // offline: check again as soon as the device is back online
  const offlineHome = screen.name === "home" && screen.offline ? screen : null;
  useEffect(() => {
    if (!offlineHome) return;
    const again = () => void checkSession(offlineHome.base, offlineHome.session, setScreen);
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, [offlineHome]);

  const signedIn = (base: string) => (reply: SessionReply) => {
    session.save(reply);
    setScreen({ name: "home", base, session: reply, offline: false });
  };

  const connected = (base: string, info: ServerInfo) => {
    server.save(base);
    setScreen(info.needsSetup ? { name: "setup", base } : { name: "login", base });
  };

  // (the app only: another server, and with it no session)
  const changeServer = isApp ? (
    <button
      type="button"
      className="link"
      onClick={() => {
        const last = server.load();
        session.clear();
        server.clear();
        setScreen({ name: "server", last });
      }}
    >
      {t("server.change")}
    </button>
  ) : undefined;

  switch (screen.name) {
    case "loading":
      return <main className="page" aria-busy="true" />;
    case "server":
      return <ServerScreen last={screen.last} onConnected={connected} />;
    case "unreachable":
      return (
        <Page title={t("unreachable.title")} intro={t("unreachable.text", { server: screen.base ? new URL(screen.base).host : location.host })} footer={changeServer}>
          <div className="actions">
            <button type="button" className="primary" onClick={() => void askServer(screen.base, setScreen)}>
              {t("unreachable.retry")}
            </button>
          </div>
        </Page>
      );
    case "setup":
      return <SetupScreen base={screen.base} onSignedIn={signedIn(screen.base)} footer={changeServer} />;
    case "login":
      return (
        <LoginScreen
          base={screen.base}
          onSignedIn={signedIn(screen.base)}
          footer={changeServer}
          notice={screen.notice ? errorText(new ApiError(screen.notice, 401)) : undefined}
        />
      );
    case "home":
      return (
        <HomeScreen
          user={screen.session.user}
          base={screen.base}
          offline={screen.offline}
          onLogout={() => {
            const { base, session: s } = screen;
            // (the server forgets the session when it can; the device forgets it now either way)
            void api.logout(base, s.token).catch(() => {});
            session.clear();
            void askServer(base, setScreen);
          }}
        />
      );
  }
}
