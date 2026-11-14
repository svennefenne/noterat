import { useEffect, useState } from "react";
import { Redirect, Route, Switch } from "wouter";
import type { User } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { AppLock } from "../lib/lock";
import { Sync } from "../lib/sync";
import { SessionProvider } from "../lib/sync-react";
import { ListScreen } from "../lists/ListScreen";
import { ListsScreen } from "../lists/ListsScreen";
import { MemoScreen } from "../memos/MemoScreen";
import { MemosScreen } from "../memos/MemosScreen";
import { NoteScreen } from "../notes/NoteScreen";
import { NotesScreen } from "../notes/NotesScreen";
import { EntryScreen } from "../journal/EntryScreen";
import { JournalScreen } from "../journal/JournalScreen";
import { SearchScreen } from "../search/SearchScreen";
import { preloadEditor } from "../notes/LazyEditor";
import { Caught } from "../ui";
import { LinkScreen } from "../screens/LinkScreen";
import { LockGate } from "./LockGate";
import { Shell } from "./Shell";

/**
 * The app once logged in: the device's copy of this person's things, kept in sync (Sync), and its pages.
 * logout: from the menu (the device forgets what it has: asked first if some of it hasn't reached the
 * server); expired: the server said the session has ended.
 */
export function SignedIn({ base, token, user, onLogout, onExpired }: { base: string; token: string; user: User; onLogout: () => void; onExpired: () => void }) {
  const { t } = useI18n();
  const [made, setMade] = useState<{ sync: Sync; lock: AppLock } | null>(null);

  useEffect(() => {
    const sync = new Sync({ base, token, userId: user.id, onLoggedOut: onExpired });
    const lock = new AppLock(`noterat.lock/${new URL(base || location.origin).host}/${user.id}`);
    // (made here, not while rendering: it opens a connection and must be closed when this goes, and
    // StrictMode mounts twice)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMade({ sync, lock });
    preloadEditor();
    return () => {
      void sync.destroy({ forget: false });
      lock.destroy();
    };
  }, [base, token, user.id, onExpired]);

  if (!made) return null;
  const { sync, lock } = made;

  async function logout() {
    if (sync.getState().waiting > 0 && !confirm(t("menu.logoutWaiting"))) return;
    await sync.destroy({ forget: true });
    lock.forget();
    onLogout();
  }

  return (
    <SessionProvider user={user} base={base} token={token} sync={sync} lock={lock}>
      <LockGate what="app" onLogout={() => void logout()}>
      <Shell onLogout={() => void logout()}>
        <Caught fallback={<Broken />}>
        <Switch>
          <Route path="/">
            <Redirect to="/lists" replace />
          </Route>
          <Route path="/lists">
            <ListsScreen />
          </Route>
          <Route path="/lists/:id">{(p) => <ListScreen key={p.id} id={p.id} />}</Route>
          <Route path="/notes">
            <NotesScreen />
          </Route>
          <Route path="/notes/:id">{(p) => <NoteScreen key={p.id} id={p.id} />}</Route>
          <Route path="/memos">
            <MemosScreen />
          </Route>
          <Route path="/memos/:id">{(p) => <MemoScreen key={p.id} id={p.id} />}</Route>
          <Route path="/journal">
            <LockGate what="journal">
              <JournalScreen />
            </LockGate>
          </Route>
          <Route path="/journal/:id">
            {(p) => (
              <LockGate what="journal">
                <EntryScreen key={p.id} id={p.id} />
              </LockGate>
            )}
          </Route>
          <Route path="/search">
            <SearchScreen />
          </Route>
          <Route path="/i/:token">{(p) => <LinkScreen base={base} link={p.token} />}</Route>
          <Route>
            <Redirect to="/lists" />
          </Route>
        </Switch>
        </Caught>
      </Shell>
      </LockGate>
    </SessionProvider>
  );
}

/** A page that failed while showing itself: said so, with a way on, instead of an empty screen. */
function Broken() {
  const { t } = useI18n();
  return (
    <div className="screen">
      <p className="problem">{t("app.broken")}</p>
      <button type="button" className="secondary" onClick={() => location.reload()}>
        {t("app.reload")}
      </button>
    </div>
  );
}
