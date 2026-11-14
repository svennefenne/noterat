import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { homeDocName, homeItems, newObjectId, objectDocName, parseDocName, type MemberRole, type ObjectType } from "@noterat/core";

/**
 * The device's copy of everything, kept in sync with the server.
 *
 * Every document lives in IndexedDB on the device and is read and changed there; the app never waits
 * for the server. One WebSocket carries all of them to the server and back when there's a connection,
 * and Yjs merges what was done on each side meanwhile.
 *
 * The home document (home/<user id>) says what this person has; everything in it is kept open, so all
 * of it is on the device when the connection goes. What leaves it (deleted, no longer shared) is let go,
 * from the device too. A document the server refuses tells why: "unauthorized" (the session ended),
 * "forbidden" or "deleted" (it's not theirs any more).
 */

export type Connection = "online" | "connecting" | "offline";

export interface SyncState {
  connection: Connection;
  /** documents with changes the server hasn't confirmed yet (saved on the device meanwhile) */
  waiting: number;
  /** the home document is read from the device, so "no lists yet" means none */
  homeLoaded: boolean;
}

interface Open {
  doc: Y.Doc;
  local: IndexeddbPersistence;
  provider: HocuspocusProvider;
  loaded: boolean;
}

function socketUrl(base: string): string {
  const url = new URL(base || location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/sync";
  return url.toString();
}

export class Sync {
  readonly home: Y.Doc;
  readonly userId: number;
  private readonly socket: HocuspocusProviderWebsocket;
  private readonly open = new Map<string, Open>();
  private readonly listeners = new Set<() => void>();
  private readonly prefix: string;
  private state: SyncState = { connection: "connecting", waiting: 0, homeLoaded: false };
  private destroyed = false;

  constructor(private readonly o: { base: string; token: string; userId: number; onLoggedOut: () => void }) {
    this.userId = o.userId;
    // (a device can be used with more than one server and account: each has its own documents)
    this.prefix = `noterat/${new URL(o.base || location.origin).host}/${o.userId}/`;
    this.socket = new HocuspocusProviderWebsocket({
      url: socketUrl(o.base),
      // try again soon, then every half minute at most
      delay: 1000,
      maxDelay: 30_000,
      onStatus: ({ status }) => this.update({ connection: status === "connected" ? "online" : status === "connecting" ? "connecting" : "offline" }),
    });
    const home = this.openDoc(homeDocName(o.userId));
    this.home = home.doc;
    void home.local.whenSynced.then(() => {
      this.update({ homeLoaded: true });
      this.followHome();
    });
    homeItems(this.home).observe(() => this.followHome());
    window.addEventListener("online", this.wake);
  }

  // ───────────── for React (useSyncExternalStore) ─────────────

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private update(patch: Partial<SyncState>) {
    const waiting = [...this.open.values()].filter((e) => e.provider.hasUnsyncedChanges).length;
    this.state = { ...this.state, waiting, ...patch };
    for (const l of this.listeners) l();
  }

  // ───────────── documents ─────────────

  /** A document, from the device at once and kept in sync from then on. */
  doc(name: string): Y.Doc {
    return this.openDoc(name).doc;
  }

  /** Whether a document has been read from the device yet (before that it looks empty). */
  isLoaded(name: string): boolean {
    return this.open.get(name)?.loaded ?? false;
  }

  whenLoaded(name: string): Promise<unknown> {
    return this.openDoc(name).local.whenSynced;
  }

  /** This person's role on a thing (from their home document; one they made is theirs). */
  roleOf(id: string): MemberRole | null {
    return homeItems(this.home).get(id)?.role ?? null;
  }

  /** Make a new thing, on the device (the server gets it once it's online), and return its id. */
  create(type: ObjectType, fill: (doc: Y.Doc) => void): string {
    const id = newObjectId();
    const { doc } = this.openDoc(objectDocName(type, id));
    fill(doc);
    homeItems(this.home).set(id, { type, role: "owner", addedAt: Date.now() });
    return id;
  }

  /** A thing no longer on this device (deleted, left, or taken back): out of the home document, and let go. */
  drop(id: string) {
    homeItems(this.home).delete(id);
  }

  private openDoc(name: string): Open {
    const had = this.open.get(name);
    if (had) return had;
    const doc = new Y.Doc();
    const local = new IndexeddbPersistence(this.prefix + name, doc);
    const provider = new HocuspocusProvider({
      websocketProvider: this.socket,
      name,
      document: doc,
      token: this.o.token,
      onAuthenticationFailed: ({ reason }) => this.refused(name, reason),
      // (the server closes a document it no longer lets this person have, saying why)
      onClose: ({ event }) => {
        if (event.reason === "forbidden" || event.reason === "deleted") this.refused(name, event.reason);
      },
      onUnsyncedChanges: () => this.update({}),
      onSynced: () => this.update({}),
    });
    provider.attach();
    const entry: Open = { doc, local, provider, loaded: false };
    this.open.set(name, entry);
    void local.whenSynced.then(() => {
      entry.loaded = true;
      this.update({});
    });
    return entry;
  }

  private refused(name: string, reason: string) {
    if (this.destroyed) return;
    if (reason === "unauthorized") return this.o.onLoggedOut();
    const parsed = parseDocName(name);
    if (parsed?.kind === "object" && (reason === "forbidden" || reason === "deleted")) this.drop(parsed.id);
  }

  /** Everything in the home document open; anything open that left it let go, from the device too. */
  private followHome() {
    if (this.destroyed || !this.state.homeLoaded) return;
    const items = homeItems(this.home);
    const want = new Set([...items.entries()].map(([id, item]) => objectDocName(item.type, id)));
    for (const name of want) this.openDoc(name);
    for (const [name, entry] of this.open) {
      if (name === homeDocName(this.userId) || want.has(name)) continue;
      this.open.delete(name);
      entry.provider.destroy();
      void entry.local.clearData();
      entry.doc.destroy();
    }
    this.update({});
  }

  private wake = () => {
    if (this.state.connection !== "online") void this.socket.connect();
  };

  /** Logging out: the connection closed, and (forget) everything this person had on the device removed. */
  async destroy(o: { forget: boolean }) {
    this.destroyed = true;
    window.removeEventListener("online", this.wake);
    for (const entry of this.open.values()) {
      entry.provider.destroy();
      if (o.forget) await entry.local.clearData().catch(() => {});
      else await entry.local.destroy().catch(() => {});
      entry.doc.destroy();
    }
    this.open.clear();
    this.socket.destroy();
    this.listeners.clear();
  }
}
