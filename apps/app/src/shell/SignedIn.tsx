import { useEffect, useState } from "react";
import { Redirect, Route, Switch } from "wouter";
import type { User } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { Sync } from "../lib/sync";
import { SessionProvider } from "../lib/sync-react";
import { ListScreen } from "../lists/ListScreen";
import { ListsScreen } from "../lists/ListsScreen";
import { LinkScreen } from "../screens/LinkScreen";
import { Shell } from "./Shell";

/**
 * The app once logged in: the device's copy of this person's things, kept in sync (Sync), and its pages.
 * logout: from the menu (the device forgets what it has: asked first if some of it hasn't reached the
 * server); expired: the server said the session has ended.
 */
export function SignedIn({ base, token, user, onLogout, onExpired }: { base: string; token: string; user: User; onLogout: () => void; onExpired: () => void }) {
  const { t } = useI18n();
  const [sync, setSync] = useState<Sync | null>(null);

  useEffect(() => {
    const s = new Sync({ base, token, userId: user.id, onLoggedOut: onExpired });
    // (made here, not while rendering: it opens a connection and must be closed when this goes, and
    // StrictMode mounts twice)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSync(s);
    return () => void s.destroy({ forget: false });
  }, [base, token, user.id, onExpired]);

  if (!sync) return null;

  async function logout() {
    if (sync!.getState().waiting > 0 && !confirm(t("menu.logoutWaiting"))) return;
    await sync!.destroy({ forget: true });
    onLogout();
  }

  return (
    <SessionProvider user={user} base={base} token={token} sync={sync}>
      <Shell onLogout={() => void logout()}>
        <Switch>
          <Route path="/">
            <ListsScreen />
          </Route>
          <Route path="/lists/:id">{(p) => <ListScreen key={p.id} id={p.id} />}</Route>
          <Route path="/i/:token">{(p) => <LinkScreen base={base} link={p.token} />}</Route>
          <Route>
            <Redirect to="/" />
          </Route>
        </Switch>
      </Shell>
    </SessionProvider>
  );
}
