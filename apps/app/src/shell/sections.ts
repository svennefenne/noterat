import { BookHeart, CalendarDays, ChefHat, ListChecks, Mic, NotebookPen, ScanLine, Wallet } from "lucide-react";
import { SECTION } from "../lib/things";

/** The app's sections, in the order they're offered: along the top on a wide screen, in the menu on a phone. */
export const SECTIONS = [
  { type: "list", Icon: ListChecks },
  { type: "calendar", Icon: CalendarDays },
  { type: "note", Icon: NotebookPen },
  { type: "journal", Icon: BookHeart },
  { type: "memo", Icon: Mic },
  { type: "scan", Icon: ScanLine },
  { type: "recipe", Icon: ChefHat },
  { type: "budget", Icon: Wallet },
] as const;

export type SectionType = (typeof SECTIONS)[number]["type"];

/** Whether the address is in this section (its list, or something in it). */
export const isIn = (location: string, type: SectionType) => location === SECTION[type] || location.startsWith(`${SECTION[type]}/`);
