import type { ColumnType, ListSettings } from "@noterat/core";
import type { TextKey } from "../lib/texts";

/**
 * Ready-made lists to start from, as in Hooden. The columns' names are put in the maker's language
 * when the list is made (and are theirs to change after that).
 */
export interface Template {
  id: string;
  name: TextKey;
  hint: TextKey;
  columns: { name: TextKey; type: ColumnType }[];
  settings: Partial<ListSettings>;
  /** with a fixed number of rows: how many */
  rows?: number;
}

export const TEMPLATES: Template[] = [
  {
    id: "shopping",
    name: "template.shopping",
    hint: "template.shoppingHint",
    columns: [
      { name: "col.bought", type: "check" },
      { name: "col.item", type: "text" },
      { name: "col.quantity", type: "text" },
    ],
    settings: { autoRows: true, ownRows: false, fill: "members" },
  },
  {
    id: "checklist",
    name: "template.checklist",
    hint: "template.checklistHint",
    columns: [
      { name: "col.done", type: "check" },
      { name: "col.what", type: "text" },
      { name: "col.who", type: "person" },
    ],
    settings: { autoRows: true, ownRows: false, fill: "members" },
  },
  {
    id: "signup",
    name: "template.signup",
    hint: "template.signupHint",
    columns: [
      { name: "col.who", type: "person" },
      { name: "col.bringing", type: "text" },
    ],
    settings: { autoRows: false, ownRows: true, addRows: true, fill: "members" },
    rows: 10,
  },
  {
    id: "schedule",
    name: "template.schedule",
    hint: "template.scheduleHint",
    columns: [
      { name: "col.day", type: "date" },
      { name: "col.time", type: "time" },
      { name: "col.what", type: "text" },
      { name: "col.who", type: "person" },
    ],
    settings: { autoRows: true, ownRows: false, fill: "members" },
  },
  {
    id: "blank",
    name: "template.blank",
    hint: "template.blankHint",
    columns: [{ name: "col.first", type: "text" }],
    settings: { autoRows: true, ownRows: false, fill: "members" },
  },
];
