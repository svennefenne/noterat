import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addRow,
  homeDocName,
  homeInvitations,
  homeItems,
  initList,
  newObjectId,
  objectDocName,
  readList,
  setCell,
  type AcceptReply,
  type LinkInfo,
  type ShareReply,
  type ShareState,
  type SignupReply,
} from "@noterat/core";
import { objectRow } from "../src/objects";
import { account, call, device, startServer, synced, until } from "./helpers";

const columns = [
  { name: "Bought", type: "check" as const },
  { name: "Item", type: "text" as const },
  { name: "Quantity", type: "text" as const },
];
const colId = (doc: Y.Doc, name: string) => readList(doc).columns.find((c) => c.name === name)!.id;
const items = (doc: Y.Doc) => readList(doc).rows.flatMap((r) => (r.cells[colId(doc, "Item")] ? [String(r.cells[colId(doc, "Item")])] : []));
/** the app's new row, filled in */
const add = (doc: Y.Doc, item: string, by: number) => addRow(doc, { cells: { [colId(doc, "Item")]: item }, by })!;

/** Ada makes a shopping list on her phone and shares it with Bo, who accepts on his. */
async function sharedList() {
  const { db, base } = await startServer();
  const ada = await account(db, "ada");
  const bo = await account(db, "bo");
  const id = newObjectId();
  const name = objectDocName("list", id);

  const adaList = device(base, ada.token)(name);
  initList(adaList.doc, { title: "Shopping", columns, by: ada.user.id });
  await synced(adaList.provider);

  const boHome = device(base, bo.token)(homeDocName(bo.user.id));
  await synced(boHome.provider);
  const shared = await call<ShareReply>(base, "POST", `/api/objects/${id}/share`, ada.token, { role: "editor", userId: bo.user.id });
  expect(shared.status).toBe(201);
  await until(() => homeInvitations(boHome.doc).size === 1, "the invitation in Bo's app");
  const invitation = [...homeInvitations(boHome.doc).values()][0]!;
  expect(invitation).toMatchObject({ objectId: id, title: "Shopping", role: "editor", from: { displayName: "Ada" } });

  const accepted = await call<AcceptReply>(base, "POST", `/api/invitations/${invitation.id}/accept`, bo.token);
  expect(accepted.json).toEqual({ objectId: id, type: "list" });
  await until(() => homeItems(boHome.doc).has(id) && homeInvitations(boHome.doc).size === 0, "the list in Bo's home");
  expect(homeItems(boHome.doc).get(id)).toMatchObject({ type: "list", role: "editor" });

  const boList = device(base, bo.token)(name);
  await until(() => readList(boList.doc).title === "Shopping", "the list on Bo's phone");
  return { db, base, ada, bo, id, name, adaList, boList, boHome };
}

describe("a list made on a device", () => {
  it("is made on the server when it's first synced, owned by its maker and no one else's", async () => {
    const { db, base } = await startServer();
    const ada = await account(db, "ada");
    const bo = await account(db, "bo");
    const id = newObjectId();
    const list = device(base, ada.token)(objectDocName("list", id));
    initList(list.doc, { title: "Mine", columns, by: ada.user.id });
    await synced(list.provider);
    expect(objectRow(db, id)).toMatchObject({ type: "list", owner_id: ada.user.id });

    const peek = device(base, bo.token)(objectDocName("list", id));
    await until(() => peek.refused.length > 0, "Bo to be turned away");
    expect(peek.refused).toEqual(["forbidden"]);
    expect(readList(peek.doc).title).toBe("");
    const share = await call(base, "GET", `/api/objects/${id}/share`, bo.token);
    expect(share.status).toBe(403);
  });
});

describe("sharing a list", () => {
  it("shows the invitation at once, and the list is live for both once accepted", async () => {
    const { ada, adaList, boList } = await sharedList();
    add(adaList.doc, "Milk", ada.user.id);
    await until(() => items(boList.doc).includes("Milk"), "Ada's change on Bo's phone");
  });

  it("works on two phones offline: both keep what they did once they're back online", async () => {
    const { db, id, ada, bo, adaList, boList } = await sharedList();
    const milk = add(adaList.doc, "Milk", ada.user.id);
    await until(() => items(boList.doc).includes("Milk"), "the first change to arrive");

    // both lose their connection, and go on
    await adaList.offline();
    await boList.offline();
    setCell(adaList.doc, milk, colId(adaList.doc, "Bought"), true, ada.user.id);
    add(adaList.doc, "Eggs", ada.user.id);
    setCell(boList.doc, milk, colId(boList.doc, "Quantity"), "2 l", bo.user.id);
    add(boList.doc, "Bread", bo.user.id);
    expect(items(adaList.doc)).toEqual(["Milk", "Eggs"]);
    expect(items(boList.doc)).toEqual(["Milk", "Bread"]);

    // back online
    adaList.online();
    boList.online();
    await until(() => isDeepStrictEqual(readList(adaList.doc), readList(boList.doc)), "the phones to agree");
    const list = readList(adaList.doc);
    expect([...items(adaList.doc)].sort()).toEqual(["Bread", "Eggs", "Milk"]);
    expect(list.rows.find((r) => r.id === milk)!.cells).toEqual({
      [colId(adaList.doc, "Item")]: "Milk",
      [colId(adaList.doc, "Bought")]: true,
      [colId(adaList.doc, "Quantity")]: "2 l",
    });

    // and the server kept it
    await synced(adaList.provider);
    await synced(boList.provider);
    await until(() => !!(db.prepare("select state from objects where id = ?").get(id) as { state: Buffer | null }).state, "the server to store it");
    await new Promise((r) => setTimeout(r, 200));
    const stored = new Y.Doc();
    Y.applyUpdate(stored, new Uint8Array((db.prepare("select state from objects where id = ?").get(id) as { state: Buffer }).state));
    expect(readList(stored)).toEqual(readList(adaList.doc));
  });

  it("by a link lets someone new in once, and a viewer can't change the list", async () => {
    const { db, base, ada, id, adaList } = await sharedList();
    const link = await call<Extract<ShareReply, { kind: "link" }>>(base, "POST", `/api/objects/${id}/share`, ada.token, { role: "viewer" });
    const token = link.json.url.split("/i/")[1]!;
    expect((await call<LinkInfo>(base, "GET", `/api/links/${token}`)).json).toEqual({ from: "Ada", title: "Shopping", type: "list", role: "viewer", status: "open" });

    const cy = await call<SignupReply>(base, "POST", `/api/links/${token}/signup`, undefined, { username: "cy", displayName: "Cy", password: "a long enough password" });
    expect(cy.status).toBe(201);
    expect(cy.json.accepted).toEqual({ objectId: id, type: "list" });
    expect((await call<LinkInfo>(base, "GET", `/api/links/${token}`)).json.status).toBe("used");
    const dan = await account(db, "dan");
    expect((await call(base, "POST", `/api/links/${token}/accept`, dan.token)).json).toEqual({ error: "invite_used" });

    const milk = add(adaList.doc, "Milk", ada.user.id);
    const cyList = device(base, cy.json.token)(objectDocName("list", id));
    await until(() => items(cyList.doc).includes("Milk"), "the list on Cy's phone");
    setCell(cyList.doc, milk, colId(cyList.doc, "Item"), "Cake", cy.json.user.id);
    add(cyList.doc, "Candy", cy.json.user.id);
    setCell(adaList.doc, milk, colId(adaList.doc, "Quantity"), "1", ada.user.id);
    await until(() => readList(cyList.doc).rows[0]!.cells[colId(cyList.doc, "Quantity")] === "1", "Ada's change on Cy's phone");
    await new Promise((r) => setTimeout(r, 200));
    expect(items(adaList.doc)).toEqual(["Milk"]);

    const state = await call<ShareState>(base, "GET", `/api/objects/${id}/share`, ada.token);
    expect(state.json.members.map((m) => [m.person.username, m.role])).toEqual([
      ["ada", "owner"],
      ["bo", "editor"],
      ["cy", "viewer"],
    ]);
  });

  it("can be taken back, and a deleted list goes from everyone", async () => {
    const { base, ada, bo, id, name, boHome } = await sharedList();
    expect((await call(base, "PATCH", `/api/objects/${id}/members/${bo.user.id}`, ada.token, { role: "viewer" })).status).toBe(204);
    await until(() => homeItems(boHome.doc).get(id)?.role === "viewer", "Bo's role to change in his home");
    expect((await call(base, "DELETE", `/api/objects/${id}/members/${bo.user.id}`, ada.token)).status).toBe(204);
    await until(() => !homeItems(boHome.doc).has(id), "the list to leave Bo's home");
    const again = device(base, bo.token)(name);
    await until(() => again.refused.length > 0, "Bo to be turned away");
    expect(again.refused).toEqual(["forbidden"]);

    expect((await call(base, "DELETE", `/api/objects/${id}`, ada.token)).status).toBe(204);
    const gone = device(base, ada.token)(name);
    await until(() => gone.refused.length > 0, "the deleted list to be turned away");
    expect(gone.refused).toEqual(["deleted"]);
  });
});
