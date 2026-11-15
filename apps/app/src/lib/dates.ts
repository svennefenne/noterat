import { useMemo } from "react";
import { dayOfWeek, formatDay, formatMoment, formatMonth, formatTime, weekdayNames, type DateRules } from "@noterat/core";
import { useHousehold } from "./household";
import { useI18n } from "./i18n";

/**
 * Days and times as the household writes them (decision 14: "15 nov" or "2026-11-15", a 24- or a 12-hour
 * clock, weeks from Monday or Sunday), in this person's language. Every screen writes them through this.
 */
export function useDates() {
  const { lang } = useI18n();
  const { household } = useHousehold();
  const { dateStyle, clock, weekStart } = household.locale;
  return useMemo(() => {
    const rules: DateRules = { lang, dateStyle, clock, weekStart };
    return {
      rules,
      /** "15 nov" (the year when it isn't this year's), "2026-11-15"; weekday: "lör 15 nov" */
      day: (d: Date | string, o?: { year?: boolean; weekday?: boolean; long?: boolean }) => formatDay(d, rules, o),
      /** "14:05" or "2:05 pm" */
      time: (t: Date | string) => formatTime(t, rules),
      /** "15 nov 14:05" */
      moment: (at: Date | number, o?: { year?: boolean }) => formatMoment(at, rules, o),
      /** "november 2026" or "2026-11" */
      month: (m: Date | string, o?: { short?: boolean }) => formatMonth(m, rules, o),
      /** the week's days from its first ("mån" … or "sön" …) */
      weekdays: (width?: "short" | "narrow" | "long") => weekdayNames(rules, width),
      /** a day's place in its week (0: the first) */
      weekIndex: (d: Date) => dayOfWeek(d, rules),
    };
  }, [lang, dateStyle, clock, weekStart]);
}

export type Dates = ReturnType<typeof useDates>;
