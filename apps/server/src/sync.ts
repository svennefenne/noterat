import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus, type Connection } from "@hocuspocus/server";
import crossws from "crossws/adapters/node";
import * as Y from "yjs";
import {
  docTitle,
  homeDocName,
  homeInvitations,
  homeItems,
  objectDocName,
  parseDocName,
  type Invitation,
  type MemberRole,
  type ObjectType,
  type User,
} from "@noterat/core";
import { sessionUser } from "./auth";
import type { DB } from "./db";
import { createObject, loadHomeState, loadObjectState, objectRow, roleOf, storeHomeState, storeObjectState, type ObjectRow } from "./objects";

/**
 * The live sync: Hocuspocus (a Yjs server) on the WebSocket at /sync. Each connection opens documents
 * with the person's session token, and is let in as their role on each: an owner or editor may change
 * it, a viewer only reads it (the server drops a viewer's changes). A thing the server hasn't seen
 * before is made when it's first synced, owned by whoever synced it, so things can be made offline.
 * Documents are kept in SQLite a couple of seconds after each change (and when the last one leaves).
 */

export interface SyncContext {
  user?: User;
  role?: MemberRole;
  /** a change made by the server itself (sharing) */
  server?: true;
}

/** Why a document was refused, as the app gets it (onAuthenticationFailed's reason). */
export type Refusal = "unauthorized" | "forbidden" | "deleted" | "invalid";
// (thrown without a message, which Hocuspocus would log as an error: these are answers, not faults)
const refuse = (reason: Refusal) => ({ reason });

export type Sync = ReturnType<typeof createSync>;

export function createSync(db: DB, o: { debounce?: number; maxDebounce?: number } = {}) {
  const hocuspocus = new Hocuspocus<SyncContext>({
    quiet: true,
    debounce: o.debounce ?? 2000,
    maxDebounce: o.maxDebounce ?? 10_000,

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const s = token ? sessionUser(db, token) : null;
      if (!s) throw refuse("unauthorized");
      const name = parseDocName(documentName);
      if (!name) throw refuse("invalid");
      if (name.kind === "home") {
        if (name.userId !== s.user.id) throw refuse("forbidden");
        return { user: s.user } satisfies SyncContext;
      }
      let obj = objectRow(db, name.id);
      if (!obj) {
        createObject(db, { id: name.id, type: name.type, ownerId: s.user.id });
        obj = objectRow(db, name.id)!;
      }
      if (obj.deleted_at) throw refuse("deleted");
      if (obj.type !== name.type) throw refuse("invalid");
      const role = roleOf(db, obj.id, s.user.id);
      if (!role) throw refuse("forbidden");
      connectionConfig.readOnly = role === "viewer";
      return { user: s.user, role } satisfies SyncContext;
    },

    async onLoadDocument({ documentName, document }) {
      const name = parseDocName(documentName);
      const state = !name ? null : name.kind === "home" ? loadHomeState(db, name.userId) : loadObjectState(db, name.id);
      if (state) Y.applyUpdate(document, state);
    },

    async onStoreDocument({ documentName, document }) {
      const name = parseDocName(documentName);
      if (!name) return;
      const state = Y.encodeStateAsUpdate(document);
      if (name.kind === "home") storeHomeState(db, name.userId, state);
      else storeObjectState(db, name.id, state, docTitle(document));
    },
  });

  /** Change someone's home document from the server: it shows at once on their devices that are online. */
  async function changeHome(userId: number, change: (doc: Y.Doc) => void) {
    const conn = await hocuspocus.openDirectConnection(homeDocName(userId), { server: true });
    try {
      await conn.transact(change);
    } finally {
      await conn.disconnect();
    }
  }

  const openConnections = (type: ObjectType, id: string) => [...(hocuspocus.documents.get(objectDocName(type, id))?.connections.keys() ?? [])];
  // (closes the one document on that connection: the device's others go on; the app gets the reason)
  const closeConnection = (connection: Connection<SyncContext>, reason: Refusal) =>
    (connection as unknown as { close(event: { code: number; reason: string }): void }).close({ code: 4403, reason });

  // the WebSocket, through crossws as Hocuspocus's own server does it, on our HTTP server's /sync
  const connections = new WeakMap<object, ReturnType<typeof hocuspocus.handleConnection>>();
  const ws = crossws({
    hooks: {
      open(peer) {
        const conn = hocuspocus.handleConnection(peer.websocket as unknown as Parameters<typeof hocuspocus.handleConnection>[0], peer.request as Request);
        connections.set(peer, conn);
        (peer.websocket as { on?: (e: string, f: () => void) => void }).on?.("pong", () => conn.touch());
      },
      message(peer, message) {
        connections.get(peer)?.handleMessage(message.uint8Array());
      },
      close(peer, event) {
        connections.get(peer)?.handleClose({ code: event.code ?? 1000, reason: event.reason ?? "" });
      },
      error(_peer, error) {
        console.error("sync:", error);
      },
    },
  });

  return {
    hocuspocus,

    /** Take the WebSocket at /sync on the HTTP server (anything else asking to upgrade is turned away). */
    attach(server: Server) {
      server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        if (new URL(req.url ?? "/", "http://noterat").pathname !== "/sync") return void socket.destroy();
        void ws.handleUpgrade(req, socket, head);
      });
    },

    /** A thing's title as it is now: from its open document, else as last stored. */
    titleOf(obj: ObjectRow): string {
      const open = hocuspocus.documents.get(objectDocName(obj.type, obj.id));
      return open ? docTitle(open) : obj.title;
    },

    /** Someone has a thing now (or another role on it): it's in their home document, with that role. */
    toHome: (userId: number, objectId: string, type: ObjectType, role: MemberRole) =>
      changeHome(userId, (d) => {
        const had = homeItems(d).get(objectId);
        homeItems(d).set(objectId, { type, role, addedAt: had?.addedAt ?? Date.now() });
      }),
    removeFromHome: (userId: number, objectId: string) => changeHome(userId, (d) => homeItems(d).delete(objectId)),
    addInvitation: (userId: number, invitation: Invitation) => changeHome(userId, (d) => homeInvitations(d).set(invitation.id, invitation)),
    removeInvitation: (userId: number, id: string) => changeHome(userId, (d) => homeInvitations(d).delete(id)),

    /**
     * Someone's access to a thing changed: their open connections to it follow at once. With a role, a
     * viewer's changes are dropped from now on (or no longer are); with none, the connections are
     * closed, with "forbidden" as the reason, and their app lets the thing go.
     */
    access(type: ObjectType, id: string, userId: number, role: MemberRole | null) {
      for (const connection of openConnections(type, id)) {
        if (connection.context?.user?.id !== userId) continue;
        if (role) {
          connection.readOnly = role === "viewer";
          connection.context.role = role;
        } else closeConnection(connection, "forbidden");
      }
    },

    /** A thing was deleted: everyone with it open is closed off, with "deleted" as the reason. */
    closeAll(type: ObjectType, id: string) {
      for (const connection of openConnections(type, id)) closeConnection(connection, "deleted");
    },

    /** Store what's waiting to be stored and close the connections (the server is stopping). */
    async stop() {
      hocuspocus.flushPendingStores();
      ws.closeAll(1001, "server stopping");
      await new Promise((r) => setTimeout(r, 200));
    },
  };
}
