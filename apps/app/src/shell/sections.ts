import { BookHeart, CalendarDays, ChefHat, ListChecks, Mic, NotebookPen, ScanLine, Wallet } from "lucide-react";
import { SECTION } from "../lib/things";

/**
 * The app's sections, in the order they're offered: along the top on a wide screen, in the menu on a
 * phone, and one after the other when swiping sideways between them.
 */
export const SECTIONS = [
  { type: "note", Icon: NotebookPen },
  { type: "journal", Icon: BookHeart },
  { type: "calendar", Icon: CalendarDays },
  { type: "memo", Icon: Mic },
  { type: "recipe", Icon: ChefHat },
  { type: "list", Icon: ListChecks },
  { type: "scan", Icon: ScanLine },
  { type: "budget", Icon: Wallet },
] as const;

export type SectionType = (typeof SECTIONS)[number]["type"];

/** Whether the address is in this section (its list, or something in it). */
export const isIn = (location: string, type: SectionType) => location === SECTION[type] || location.startsWith(`${SECTION[type]}/`);

/**
 * Where a swipe goes from a section's own page: the next section, or the one before, round from the
 * last to the first. From the start page it starts the round: the first section, or (back) the last.
 * Anywhere else (something open in a section, the settings) it goes nowhere.
 */
export function sectionBeside(location: string, way: 1 | -1): string | null {
  if (location === "/") return SECTION[(way === 1 ? SECTIONS[0] : SECTIONS[SECTIONS.length - 1]!).type];
  const at = SECTIONS.findIndex(({ type }) => location === SECTION[type]);
  if (at < 0) return null;
  return SECTION[SECTIONS[(at + way + SECTIONS.length) % SECTIONS.length]!.type];
}
