import { DATE_RULES, isTimeZone, type Clock, type DateRules, type DateStyle, type WeekStart } from "./dates";
import { isScheme, LOOK_MODES, type LookMode } from "./look";

/**
 * The household's settings (decision 14), set by an admin on the admin page and the same for everyone on
 * the server: its look (each person may pick their own on their device), its language for new devices,
 * how days and times are written, its time zone (what the server goes by), the start page, and Swish.
 */

export type HomeSection = "calendar" | "list" | "note" | "memo" | "scan" | "recipe" | "journal" | "money";
export const HOME_SECTIONS: HomeSection[] = ["calendar", "list", "note", "memo", "scan", "recipe", "journal", "money"];
export const HOME_COUNTS = [1, 3, 5] as const;
export type HomeCount = (typeof HOME_COUNTS)[number];

export interface HomeSectionSetting {
  type: HomeSection;
  show: boolean;
  /** how many of its latest things */
  count: HomeCount;
}

export interface Household {
  look: { scheme: string; mode: LookMode };
  locale: DateRules & { timeZone: string };
  home: { sections: HomeSectionSetting[] };
  money: { swish: boolean };
}

/** The start page's sections as they come: the journal and money left out until someone says. */
export const DEFAULT_SECTIONS: HomeSectionSetting[] = HOME_SECTIONS.map((type) => ({
  type,
  show: type !== "journal" && type !== "money",
  count: type === "calendar" ? 3 : 1,
}));

export function defaultHousehold(timeZone = "Europe/Stockholm"): Household {
  return {
    look: { scheme: "noterat", mode: "auto" },
    locale: { ...DATE_RULES, timeZone: isTimeZone(timeZone) ? timeZone : "Europe/Stockholm" },
    home: { sections: DEFAULT_SECTIONS.map((s) => ({ ...s })) },
    money: { swish: true },
  };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const pick = <T extends string>(v: unknown, allowed: readonly T[], had: T): T => (allowed.includes(v as T) ? (v as T) : had);

/** Every section once, in the order given, those missing after them as they were. */
function cleanSections(v: unknown, had: HomeSectionSetting[]): HomeSectionSetting[] {
  if (!Array.isArray(v)) return had;
  const out: HomeSectionSetting[] = [];
  for (const raw of v) {
    const s = obj(raw);
    const type = s.type as HomeSection;
    if (!HOME_SECTIONS.includes(type) || out.some((o) => o.type === type)) continue;
    const was = had.find((h) => h.type === type) ?? DEFAULT_SECTIONS.find((d) => d.type === type)!;
    out.push({ type, show: typeof s.show === "boolean" ? s.show : was.show, count: HOME_COUNTS.includes(s.count as HomeCount) ? (s.count as HomeCount) : was.count });
  }
  for (const h of had) if (!out.some((o) => o.type === h.type)) out.push({ ...h });
  return out;
}

/**
 * Settings as given (a whole household, or a part of one: what's missing or wrong stays as in `had`).
 * Never throws: anything it can't use is left as it was.
 */
export function cleanHousehold(input: unknown, had: Household): Household {
  const v = obj(input);
  const look = obj(v.look);
  const locale = obj(v.locale);
  const home = obj(v.home);
  const money = obj(v.money);
  return {
    look: {
      scheme: isScheme(look.scheme) ? look.scheme : had.look.scheme,
      mode: pick<LookMode>(look.mode, LOOK_MODES, had.look.mode),
    },
    locale: {
      lang: pick(locale.lang, ["sv", "en"] as const, had.locale.lang),
      dateStyle: pick<DateStyle>(locale.dateStyle, ["text", "iso"], had.locale.dateStyle),
      clock: pick<Clock>(locale.clock, ["24", "12"], had.locale.clock),
      weekStart: pick<WeekStart>(locale.weekStart, ["monday", "sunday"], had.locale.weekStart),
      timeZone: isTimeZone(locale.timeZone) ? locale.timeZone : had.locale.timeZone,
    },
    home: { sections: cleanSections(home.sections, had.home.sections) },
    money: { swish: typeof money.swish === "boolean" ? money.swish : had.money.swish },
  };
}

/** The stateless message the server sends every connected app when the settings change. */
export const HOUSEHOLD_CHANGED = "noterat:household";
/** …and the one it sends someone whose account changed (their name, their role): they ask again. */
export const ACCOUNT_CHANGED = "noterat:account";
