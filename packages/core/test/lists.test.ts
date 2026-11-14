import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addRow,
  canEditRow,
  canFill,
  clearList,
  initList,
  isRowDone,
  ListProblem,
  moveRow,
  newObjectId,
  parseDocName,
  readList,
  removeDone,
  setCell,
  setColumns,
  type ColumnInput,
} from "../src/index";

const shopping: ColumnInput[] = [
  { name: "Bought", type: "check" },
  { name: "Item", type: "text" },
  { name: "Quantity", type: "text" },
];

function newShoppingList() {
  const doc = new Y.Doc();
  initList(doc, { title: "Shopping", columns: shopping, by: 1 });
  return doc;
}

/** Another device with the same list: a copy of the document as it is now. */
function copyOf(doc: Y.Doc) {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  return other;
}

/** Two devices meeting again: each gets what the other has. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

const col = (doc: Y.Doc, name: string) => readList(doc).columns.find((c) => c.name === name)!.id;
const texts = (doc: Y.Doc) => readList(doc).rows.map((r) => r.cells[col(doc, "Item")] ?? "");
/** the app's new row, filled in */
const add = (doc: Y.Doc, item: string, by = 1) => addRow(doc, { cells: { [col(doc, "Item")]: item }, by })!;

describe("a list", () => {
  it("starts with its columns in order and, with automatic rows, no rows (the app shows a new one)", () => {
    const l = readList(newShoppingList());
    expect(l.title).toBe("Shopping");
    expect(l.columns.map((c) => c.name)).toEqual(["Bought", "Item", "Quantity"]);
    expect(l.rows).toHaveLength(0);
  });

  it("gets a row when the new row is filled in, and a fixed number of rows otherwise", () => {
    const doc = newShoppingList();
    add(doc, "Milk", 1);
    add(doc, "Eggs", 2);
    expect(texts(doc)).toEqual(["Milk", "Eggs"]);
    expect(readList(doc).rows.map((r) => r.filledBy)).toEqual([1, 2]);
    const fixed = new Y.Doc();
    initList(fixed, { title: "Slots", columns: shopping, settings: { autoRows: false }, rows: 4, by: 1 });
    expect(readList(fixed).rows).toHaveLength(4);
  });

  it("keeps what each cell holds as its kind says", () => {
    const doc = new Y.Doc();
    initList(doc, {
      title: "Kinds",
      columns: [
        { name: "N", type: "number" },
        { name: "D", type: "date" },
        { name: "T", type: "time" },
        { name: "C", type: "choice", options: ["Yes", "No"] },
      ],
      by: 1,
    });
    const row = addRow(doc, { by: 1 })!;
    setCell(doc, row, col(doc, "N"), "1,5", 1);
    setCell(doc, row, col(doc, "D"), "2026-02-30", 1);
    setCell(doc, row, col(doc, "T"), "18:30", 1);
    setCell(doc, row, col(doc, "C"), "Maybe", 1);
    expect(readList(doc).rows[0]!.cells).toEqual({ [col(doc, "N")]: 1.5, [col(doc, "T")]: "18:30" });
  });

  it("moves a row, and adds one after another", () => {
    const doc = newShoppingList();
    const [a, , c] = ["A", "B", "C"].map((item) => add(doc, item));
    moveRow(doc, c!, 0);
    expect(texts(doc)).toEqual(["C", "A", "B"]);
    addRow(doc, { after: a, cells: { [col(doc, "Item")]: "A2" }, by: 1 });
    expect(texts(doc)).toEqual(["C", "A", "A2", "B"]);
  });

  it("takes away the bought rows, and starts over", () => {
    const doc = newShoppingList();
    const milk = add(doc, "Milk");
    add(doc, "Eggs");
    setCell(doc, milk, col(doc, "Bought"), true, 1);
    expect(isRowDone(readList(doc).columns, readList(doc).rows[0]!)).toBe(true);
    removeDone(doc);
    expect(texts(doc)).toEqual(["Eggs"]);
    clearList(doc);
    expect(texts(doc)).toEqual([]);
  });

  it("changes its columns: a removed column takes its cells, a changed one keeps what fits", () => {
    const doc = newShoppingList();
    const row = add(doc, "12");
    setCell(doc, row, col(doc, "Quantity"), "2 l", 1);
    const [bought, item] = readList(doc).columns;
    setColumns(doc, [
      { id: item!.id, name: "Count", type: "number" },
      { id: bought!.id, name: "Bought", type: "check" },
    ]);
    const l = readList(doc);
    expect(l.columns.map((c) => c.name)).toEqual(["Count", "Bought"]);
    expect(l.rows[0]!.cells).toEqual({ [item!.id]: 12 });
    expect(() => setColumns(doc, [{ name: " ", type: "text" }])).toThrow(ListProblem);
  });
});

describe("two devices offline", () => {
  it("both keep what they did once they meet again, also what both added last", () => {
    const phoneA = newShoppingList();
    const milk = add(phoneA, "Milk");
    const phoneB = copyOf(phoneA);
    // A ticks off milk and adds eggs; B, at the same time, writes how much milk and adds bread
    setCell(phoneA, milk, col(phoneA, "Bought"), true, 1);
    add(phoneA, "Eggs", 1);
    setCell(phoneB, milk, col(phoneB, "Quantity"), "2", 2);
    add(phoneB, "Bread", 2);
    sync(phoneA, phoneB);
    expect(readList(phoneA)).toEqual(readList(phoneB));
    expect(readList(phoneA).rows[0]!.cells).toEqual({ [col(phoneA, "Item")]: "Milk", [col(phoneA, "Bought")]: true, [col(phoneA, "Quantity")]: "2" });
    expect([...texts(phoneA)].sort()).toEqual(["Bread", "Eggs", "Milk"]);
  });

  it("end up the same when both change the same cell", () => {
    const phoneA = newShoppingList();
    const row = add(phoneA, "");
    const phoneB = copyOf(phoneA);
    setCell(phoneA, row, col(phoneA, "Item"), "Oat milk", 1);
    setCell(phoneB, row, col(phoneB, "Item"), "Milk", 2);
    sync(phoneA, phoneB);
    expect(readList(phoneA)).toEqual(readList(phoneB));
    expect(["Oat milk", "Milk"]).toContain(readList(phoneA).rows[0]!.cells[col(phoneA, "Item")]);
  });

  it("keep a row moved on one and filled in on the other", () => {
    const phoneA = newShoppingList();
    add(phoneA, "A");
    const b = add(phoneA, "B");
    const phoneB = copyOf(phoneA);
    moveRow(phoneA, b, 0);
    setCell(phoneB, b, col(phoneB, "Quantity"), "3", 2);
    sync(phoneA, phoneB);
    expect(readList(phoneA)).toEqual(readList(phoneB));
    expect(readList(phoneA).rows.filter((r) => r.id === b)).toHaveLength(1);
    expect(readList(phoneA).rows[0]!.cells[col(phoneA, "Quantity")]).toBe("3");
  });
});

describe("who may change a row", () => {
  it("follows the list's settings and roles", () => {
    const doc = new Y.Doc();
    initList(doc, { title: "Sign-up", columns: [{ name: "Who", type: "person" }, { name: "Bringing", type: "text" }], settings: { ownRows: true, autoRows: false }, rows: 3, by: 1 });
    const l = readList(doc);
    setCell(doc, l.rows[0]!.id, l.columns[0]!.id, 2, 2);
    const row = readList(doc).rows[0]!;
    expect(canEditRow("editor", l.settings, l.columns, row, 2)).toBe(true);
    expect(canEditRow("editor", l.settings, l.columns, row, 3)).toBe(false);
    expect(canEditRow("owner", l.settings, l.columns, row, 1)).toBe(true);
    expect(canFill("viewer", l.settings)).toBe(false);
    expect(canFill("editor", { ...l.settings, fill: "owner" })).toBe(false);
  });
});

describe("document names", () => {
  it("are a kind and an id, or a person's home", () => {
    const id = newObjectId();
    expect(parseDocName(`list/${id}`)).toEqual({ kind: "object", type: "list", id });
    expect(parseDocName("home/7")).toEqual({ kind: "home", userId: 7 });
    for (const bad of ["home/07", "home/0", `recipe/${id}`, `list/${id}/x`, "list/nope"]) expect(parseDocName(bad)).toBeNull();
  });
});
