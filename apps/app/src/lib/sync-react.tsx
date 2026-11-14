import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type * as Y from "yjs";
import { homePrefs, homeInvitations, homeItems, type HomeItem, type Invitation, type ItemPrefs, type User } from "@noterat/core";
import type { FilesState } from "./files";
import { signedInApi, type SignedInApi } from "./api";
import type { AppLock, LockState } from "./lock";
import type { Sync, SyncState } from "./sync";

/** What the signed-in part of the app shares: who, where, their documents and the API. */
export interface Session {
  user: User;
  base: string;
  sync: Sync;
  api: SignedInApi;
  lock: AppLock;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ user, base, token, sync, lock, children }: { user: User; base: string; token: string; sync: Sync; lock: AppLock; children: ReactNode }) {
  const value = useMemo(() => ({ user, base, sync, lock, api: signedInApi(base, token) }), [user, base, token, sync, lock]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

export function useSyncState(): SyncState {
  const { sync } = useSession();
  return useSyncExternalStore(sync.subscribe, sync.getState);
}

/**
 * A value read from a document, read again whenever it changes (here or elsewhere). read should be a
 * function that doesn't change between renders (one defined outside the component).
 */
export function useDocValue<T>(doc: Y.Doc, read: (doc: Y.Doc) => T): T {
  const [value, setValue] = useState(() => read(doc));
  useEffect(() => {
    const again = () => setValue(read(doc));
    again();
    doc.on("update", again);
    return () => doc.off("update", again);
  }, [doc, read]);
  return value;
}

const readItems = (doc: Y.Doc) => [...homeItems(doc).entries()].map(([id, item]): [string, HomeItem] => [id, item]);
const readInvitations = (doc: Y.Doc) => [...homeInvitations(doc).values()].sort((a, b) => b.at - a.at);

/** What this person has: [id, item] for each thing, newest first. */
export function useHomeItems(): [string, HomeItem][] {
  const { sync } = useSession();
  const items = useDocValue(sync.home, readItems);
  return useMemo(() => [...items].sort((a, b) => b[1].addedAt - a[1].addedAt), [items]);
}

/** Invitations waiting for this person, newest first. */
export function useInvitations(): Invitation[] {
  const { sync } = useSession();
  return useDocValue(sync.home, readInvitations);
}

const readPrefs = (doc: Y.Doc) => Object.fromEntries(homePrefs(doc).entries()) as Record<string, ItemPrefs>;

/** How this person keeps their things (pinned, folder), by id. */
export function useHomePrefs(): Record<string, ItemPrefs> {
  const { sync } = useSession();
  return useDocValue(sync.home, readPrefs);
}

/** Uploads waiting or under way, by file hash. */
export function useUploads(): FilesState {
  const { sync } = useSession();
  return useSyncExternalStore(sync.files.subscribe, sync.files.getState);
}

/**
 * A value read from each of some documents (every note, for the notes page), read again whenever one of
 * them changes. read should be a function that doesn't change between renders.
 */
export function useDocsValues<T>(docs: Y.Doc[], read: (doc: Y.Doc) => T): T[] {
  const [state, setState] = useState(() => ({ docs, values: docs.map(read) }));
  // (other documents than last time, say a memo just made: read them now, not one render late)
  let values = state.values;
  if (state.docs !== docs) {
    values = docs.map(read);
    setState({ docs, values });
  }
  useEffect(() => {
    const again = () => setState({ docs, values: docs.map(read) });
    for (const d of docs) d.on("update", again);
    return () => docs.forEach((d) => d.off("update", again));
  }, [docs, read]);
  return values;
}

/** The lock's settings, and whether it's locked now. */
export function useLock(): LockState {
  const { lock } = useSession();
  return useSyncExternalStore(lock.subscribe, lock.getState);
}
