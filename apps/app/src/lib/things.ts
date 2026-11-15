import type { ObjectType } from "@noterat/core";

/** Where each kind of thing lives in the app: its section and its own page. */
export const SECTION: Record<ObjectType, string> = { list: "/lists", note: "/notes", memo: "/memos", journal: "/journal", scan: "/scans", recipe: "/recipes", calendar: "/calendar", budget: "/budget", split: "/budget/splits" };

export const pathOf = (type: ObjectType, id: string) => `${SECTION[type]}/${id}`;

/** A colour for a person (their cursor in a note), the same on every device. */
export function personColor(id: number): string {
  const hues = [12, 38, 145, 175, 205, 230, 265, 300, 330];
  return `hsl(${hues[id % hues.length]} 65% 45%)`;
}
