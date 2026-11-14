import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import * as Y from "yjs";
import type { MemberRole } from "./api";
import { randomHex } from "./docs";

/**
 * Lists, as in Hooden: a table of its owner's own making. Each column holds one kind of thing (text, a
 * number, a checkbox, a person, a date, a time, a choice), and its rows are filled in by the owner or by
 * everyone it's shared with.
 *
 * A list's Yjs document:
 *
 *   meta      Y.Map   title, createdBy, createdAt
 *   settings  Y.Map   fill, addRows, ownRows, autoRows (ListSettings)
 *   columns   Y.Map   column id → Column (a plain value: only the owner changes columns)
 *   rows      Y.Map   row id → Y.Map { order, cells: Y.Map<column id, Cell>, filledBy, updatedBy, updatedAt }
 *
 * Every cell is its own field, so two people filling in different cells, offline even, both keep what
 * they wrote; the same cell changed in two places ends up the same everywhere (the last to arrive wins).
 * Rows keep their order by a fractional key, so moving one is one change that can't duplicate it.
 *
 * Who may change what (canFill, canEditRow…) is kept by the app; the server checks per document only
 * (owner, editor, viewer).
 */

export type ColumnType = "text" | "number" | "check" | "person" | "date" | "time" | "choice";
export const COLUMN_TYPES: readonly ColumnType[] = ["text", "check", "number", "person", "date", "time", "choice"];
export const MAX_COLUMNS = 12;
export const MAX_ROWS = 300;
export const MAX_CHOICES = 20;
export const TITLE_MAX = 120;

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  /** a choice column's choices */
  options?: string[];
  order: string;
}

/** A column as the column editor gives it: with its id if it had one already. */
export interface ColumnInput {
  id?: string;
  name: string;
  type: ColumnType;
  options?: string[];
}

/** What a cell holds: text, a date ("2026-11-14"), a time ("18:30") or a choice as a string; a number; a person's user id; a tick. */
export type Cell = string | number | true;

export interface ListSettings {
  /** who fills it in: everyone it's shared with to edit, or only its owner */
  fill: "members" | "owner";
  /** whether others may add rows */
  addRows: boolean;
  /** whether a filled-in row is its filler's (or its person's): a sign-up sheet yes, a shopping list no */
  ownRows: boolean;
  /**
   * rows as they're needed: the app shows a new row last, and filling it in adds a row (instead of a
   * fixed number of rows). That new row isn't in the document: if it were, two people adding something
   * at once (offline, say) would write in the same row, and one of them would be lost.
   */
  autoRows: boolean;
}

export const DEFAULT_SETTINGS: ListSettings = { fill: "members", addRows: true, ownRows: false, autoRows: true };

export interface Row {
  id: string;
  order: string;
  cells: Record<string, Cell>;
  filledBy: number | null;
  updatedBy: number | null;
  updatedAt: number | null;
}

/** A list as plain values, for showing it. */
export interface ListView {
  title: string;
  createdBy: number | null;
  settings: ListSettings;
  columns: Column[];
  rows: Row[];
}

/** Why a list couldn't be changed as asked: a key for the app's own words. */
export class ListProblem extends Error {
  constructor(
    readonly code: "column_name" | "column_choices" | "no_columns" | "too_many_rows",
    readonly vars: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

const meta = (d: Y.Doc) => d.getMap<unknown>("meta");
const settingsMap = (d: Y.Doc) => d.getMap<unknown>("settings");
const columnsMap = (d: Y.Doc) => d.getMap<Column>("columns");
const rowsMap = (d: Y.Doc) => d.getMap<Y.Map<unknown>>("rows");

const newId = () => randomHex(6);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown, otherwise: boolean) => (typeof v === "boolean" ? v : otherwise);
const oneLine = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** (fractional keys sort as plain strings; equal keys, from two inserts at once, by id) */
const byOrder = (a: { order: string; id: string }, b: { order: string; id: string }) =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function cellsOf(row: Y.Map<unknown>): Y.Map<Cell> {
  let cells = row.get("cells");
  if (!(cells instanceof Y.Map)) row.set("cells", (cells = new Y.Map<Cell>()));
  return cells as Y.Map<Cell>;
}

function readRow(id: string, r: unknown): Row | null {
  if (!(r instanceof Y.Map)) return null;
  const cells = r.get("cells");
  return {
    id,
    order: str(r.get("order")) || "a0",
    cells: cells instanceof Y.Map ? (cells.toJSON() as Record<string, Cell>) : {},
    filledBy: num(r.get("filledBy")),
    updatedBy: num(r.get("updatedBy")),
    updatedAt: num(r.get("updatedAt")),
  };
}

const validColumn = (c: unknown): c is Column => !!c && typeof c === "object" && typeof (c as Column).id === "string" && COLUMN_TYPES.includes((c as Column).type);

export function readSettings(doc: Y.Doc): ListSettings {
  const s = settingsMap(doc);
  return {
    fill: s.get("fill") === "owner" ? "owner" : "members",
    addRows: bool(s.get("addRows"), DEFAULT_SETTINGS.addRows),
    ownRows: bool(s.get("ownRows"), DEFAULT_SETTINGS.ownRows),
    autoRows: bool(s.get("autoRows"), DEFAULT_SETTINGS.autoRows),
  };
}

export function readList(doc: Y.Doc): ListView {
  const m = meta(doc);
  return {
    title: str(m.get("title")),
    createdBy: num(m.get("createdBy")),
    settings: readSettings(doc),
    columns: [...columnsMap(doc).values()].filter(validColumn).sort(byOrder),
    rows: [...rowsMap(doc).entries()]
      .map(([id, r]) => readRow(id, r))
      .filter((r): r is Row => r !== null)
      .sort(byOrder),
  };
}

export const isFilled = (row: Row) => Object.keys(row.cells).length > 0;

/** Whose row it is: the person in its first person column, or else the first to fill it in. */
export function rowOwner(columns: Column[], row: Row): number | null {
  for (const c of columns) if (c.type === "person" && typeof row.cells[c.id] === "number") return row.cells[c.id] as number;
  return row.filledBy;
}

/** A row with all its boxes ticked (bought, packed, done). */
export function isRowDone(columns: Column[], row: Row): boolean {
  const checks = columns.filter((c) => c.type === "check");
  return checks.length > 0 && checks.every((c) => row.cells[c.id] === true);
}

// ───────────── who may do what (kept by the app) ─────────────

/** the list's title, columns and settings; moving and removing rows; clearing it */
export const canEditList = (role: MemberRole | null) => role === "owner";
export const canFill = (role: MemberRole | null, s: ListSettings) => role === "owner" || (role === "editor" && s.fill === "members");
export const canAddRows = (role: MemberRole | null, s: ListSettings) => role === "owner" || (canFill(role, s) && (s.addRows || s.autoRows));

export function canEditRow(role: MemberRole | null, s: ListSettings, columns: Column[], row: Row, me: number): boolean {
  if (role === "owner") return true;
  if (!canFill(role, s)) return false;
  if (!s.ownRows) return true;
  const who = rowOwner(columns, row);
  return who === null || who === me;
}

// ───────────── values ─────────────

/** A cell's value as its column holds it, or null (empty). */
export function cleanCell(col: Pick<Column, "type" | "options">, v: unknown): Cell | null {
  if (v === null || v === undefined || v === "" || v === false) return null;
  switch (col.type) {
    case "text":
      return oneLine(v, 300) || null;
    case "number": {
      const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
      return Number.isFinite(n) && Math.abs(n) < 1e12 ? Math.round(n * 10_000) / 10_000 : null;
    }
    case "check":
      return v === true ? true : null;
    case "person": {
      const id = Number(v);
      return Number.isInteger(id) && id > 0 ? id : null;
    }
    case "date": {
      const s = String(v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
      const d = new Date(`${s}T12:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
    }
    case "time": {
      const m = /^(\d{2}):(\d{2})$/.exec(String(v));
      return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? String(v) : null;
    }
    case "choice": {
      const s = String(v);
      return col.options?.includes(s) ? s : null;
    }
  }
}

function cleanChoices(list: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of Array.isArray(list) ? list : []) {
    const l = oneLine(o, 60);
    if (l && !seen.has(l.toLowerCase())) {
      seen.add(l.toLowerCase());
      out.push(l);
    }
  }
  return out.slice(0, MAX_CHOICES);
}

/** Columns as given, checked: each with a name and a kind; the ids they had kept, new ones for the rest. */
export function cleanColumns(input: ColumnInput[], before: Pick<Column, "id">[] = []): Omit<Column, "order">[] {
  const out: Omit<Column, "order">[] = [];
  const seen = new Set<string>();
  for (const c of input.slice(0, MAX_COLUMNS)) {
    const name = oneLine(c.name, 60);
    if (!name) throw new ListProblem("column_name");
    const type = COLUMN_TYPES.includes(c.type) ? c.type : "text";
    const id = c.id && !seen.has(c.id) && before.some((b) => b.id === c.id) ? c.id : newId();
    seen.add(id);
    const col: Omit<Column, "order"> = { id, name, type };
    if (type === "choice") {
      col.options = cleanChoices(c.options);
      if (!col.options.length) throw new ListProblem("column_choices", { name });
    }
    out.push(col);
  }
  if (!out.length) throw new ListProblem("no_columns");
  return out;
}

// ───────────── changes ─────────────

/** A key for a row after rows[index] (-1: first) and before the next one with a greater key. */
function keyAfter(rows: Row[], index: number): string {
  const prev = index >= 0 ? (rows[index]?.order ?? null) : null;
  const next = rows.slice(index + 1).find((r) => prev === null || r.order > prev)?.order ?? null;
  return generateKeyBetween(prev, next);
}

function emptyRow(r: Y.Map<unknown>) {
  cellsOf(r).clear();
  r.delete("filledBy");
}

function newRow(order: string): Y.Map<unknown> {
  const r = new Y.Map<unknown>();
  r.set("order", order);
  r.set("cells", new Y.Map<Cell>());
  return r;
}

export interface NewList {
  title: string;
  columns: ColumnInput[];
  settings?: Partial<ListSettings>;
  /** how many rows to begin with (with automatic rows: none) */
  rows?: number;
  by: number;
}

/** Fill a new, empty document with a list. */
export function initList(doc: Y.Doc, o: NewList) {
  const cols = cleanColumns(o.columns);
  const settings = { ...DEFAULT_SETTINGS, ...o.settings };
  doc.transact(() => {
    const m = meta(doc);
    m.set("title", oneLine(o.title, TITLE_MAX));
    m.set("createdBy", o.by);
    m.set("createdAt", Date.now());
    for (const [k, v] of Object.entries(settings)) settingsMap(doc).set(k, v);
    const colKeys = generateNKeysBetween(null, null, cols.length);
    cols.forEach((c, i) => columnsMap(doc).set(c.id, { ...c, order: colKeys[i]! }));
    const n = settings.autoRows ? 0 : Math.max(1, Math.min(MAX_ROWS, Math.round(o.rows ?? 10)));
    for (const key of generateNKeysBetween(null, null, n)) rowsMap(doc).set(newId(), newRow(key));
  });
}

export function setTitle(doc: Y.Doc, title: string) {
  meta(doc).set("title", oneLine(title, TITLE_MAX));
}

export function setSettings(doc: Y.Doc, patch: Partial<ListSettings>) {
  doc.transact(() => {
    const s = settingsMap(doc);
    if (patch.fill === "members" || patch.fill === "owner") s.set("fill", patch.fill);
    for (const k of ["addRows", "ownRows", "autoRows"] as const) if (typeof patch[k] === "boolean") s.set(k, patch[k]);
  });
}

/**
 * The owner's column editor: the columns as they should be, in order. Removed columns take their cells
 * with them; a column that changed kind keeps what still fits it.
 */
export function setColumns(doc: Y.Doc, input: ColumnInput[]) {
  const before = readList(doc).columns;
  const cols = cleanColumns(input, before);
  const keys = generateNKeysBetween(null, null, cols.length);
  doc.transact(() => {
    const map = columnsMap(doc);
    for (const id of [...map.keys()]) if (!cols.some((c) => c.id === id)) map.delete(id);
    cols.forEach((c, i) => map.set(c.id, { ...c, order: keys[i]! }));
    for (const r of rowsMap(doc).values()) {
      if (!(r instanceof Y.Map)) continue;
      const cells = cellsOf(r);
      for (const [colId, v] of [...cells.entries()]) {
        const col = cols.find((c) => c.id === colId);
        const fit = col ? cleanCell(col, v) : null;
        if (fit === null) cells.delete(colId);
        else if (fit !== v) cells.set(colId, fit);
      }
      if (cells.size === 0) r.delete("filledBy");
    }
  });
}

/** Fill in (or empty, with null) one cell. */
export function setCell(doc: Y.Doc, rowId: string, columnId: string, value: unknown, by: number) {
  const r = rowsMap(doc).get(rowId);
  const col = columnsMap(doc).get(columnId);
  if (!(r instanceof Y.Map) || !validColumn(col)) return;
  const v = cleanCell(col, value);
  doc.transact(() => {
    const cells = cellsOf(r);
    if (v === null) cells.delete(columnId);
    else cells.set(columnId, v);
    if (cells.size === 0) r.delete("filledBy");
    else if (typeof r.get("filledBy") !== "number") r.set("filledBy", by);
    r.set("updatedBy", by);
    r.set("updatedAt", Date.now());
  });
}

/** Empty a row. */
export function clearRow(doc: Y.Doc, rowId: string, by: number) {
  const r = rowsMap(doc).get(rowId);
  if (!(r instanceof Y.Map)) return;
  doc.transact(() => {
    cellsOf(r).clear();
    r.delete("filledBy");
    r.set("updatedBy", by);
    r.set("updatedAt", Date.now());
  });
}

/**
 * A new row, after the given one or last, empty or with what's written in it (the app's new row, filled
 * in). Returns its id (null: the list is full).
 */
export function addRow(doc: Y.Doc, o: { after?: string; cells?: Record<string, unknown>; by: number }): string | null {
  const rows = readList(doc).rows;
  if (rows.length >= MAX_ROWS) return null;
  const i = o.after ? rows.findIndex((r) => r.id === o.after) : rows.length - 1;
  const id = newId();
  const row = newRow(keyAfter(rows, i < 0 ? rows.length - 1 : i));
  doc.transact(() => {
    rowsMap(doc).set(id, row);
    const cols = columnsMap(doc);
    let filled = false;
    for (const [colId, value] of Object.entries(o.cells ?? {})) {
      const col = cols.get(colId);
      const v = validColumn(col) ? cleanCell(col, value) : null;
      if (v === null) continue;
      cellsOf(row).set(colId, v);
      filled = true;
    }
    if (filled) row.set("filledBy", o.by);
    row.set("updatedBy", o.by);
    row.set("updatedAt", Date.now());
  });
  return id;
}

export function removeRow(doc: Y.Doc, rowId: string) {
  rowsMap(doc).delete(rowId);
}

/** Move a row to the given place (0: first) among the rows. */
export function moveRow(doc: Y.Doc, rowId: string, to: number) {
  const rows = readList(doc).rows;
  const row = rowsMap(doc).get(rowId);
  if (!(row instanceof Y.Map)) return;
  const rest = rows.filter((r) => r.id !== rowId);
  const at = Math.max(0, Math.min(rest.length, to));
  row.set("order", keyAfter(rest, at - 1));
}

/** Start the list over: with automatic rows no rows; with a fixed number, those rows emptied. */
export function clearList(doc: Y.Doc) {
  doc.transact(() => {
    if (readSettings(doc).autoRows) rowsMap(doc).clear();
    else for (const r of rowsMap(doc).values()) if (r instanceof Y.Map) emptyRow(r);
  });
}

/** Take away the rows with all their boxes ticked (the shopping that's done); with a fixed number of rows, empty them. */
export function removeDone(doc: Y.Doc) {
  const { columns, rows, settings } = readList(doc);
  doc.transact(() => {
    for (const row of rows) {
      if (!isRowDone(columns, row)) continue;
      const r = rowsMap(doc).get(row.id);
      if (settings.autoRows || !(r instanceof Y.Map)) rowsMap(doc).delete(row.id);
      else emptyRow(r);
    }
  });
}

/** A fixed number of rows: empty rows added at the end, or empty ones taken from the end (filled ones stay). */
export function setRowCount(doc: Y.Doc, n: number) {
  const want = Math.max(1, Math.min(MAX_ROWS, Math.round(n)));
  const rows = readList(doc).rows;
  doc.transact(() => {
    if (want > rows.length) {
      for (const key of generateNKeysBetween(rows[rows.length - 1]?.order ?? null, null, want - rows.length)) rowsMap(doc).set(newId(), newRow(key));
      return;
    }
    let extra = rows.length - want;
    for (const r of [...rows].reverse()) {
      if (!extra) break;
      if (isFilled(r)) continue;
      rowsMap(doc).delete(r.id);
      extra--;
    }
  });
}
