import { useMemo, useState } from "react";
import { clockIn, DATE_RULES, formatDay, formatTime, isTimeZone, type Clock, type DateStyle, type WeekStart } from "@noterat/core";
import { useI18n } from "../lib/i18n";
import { Problem } from "../ui";
import { AdminSection, Setting, useSaveHousehold } from "./AdminScreen";

/** a choice of a few, each with an example of what it gives */
function Choices<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; example?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="choice" onClick={() => onChange(o.value)}>
          <span>{o.label}</span>
          {o.example && <span className="choice-example">{o.example}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Language, time and date (decision 14): the language new devices start in, how days and times are
 * written, which day weeks start on, and the household's time zone (what the server goes by).
 */
export function LocaleSection() {
  const { t, lang } = useI18n();
  const { household, save, problem } = useSaveHousehold();
  const l = household.locale;
  const now = new Date();
  const rules = { ...DATE_RULES, lang, dateStyle: l.dateStyle, clock: l.clock, weekStart: l.weekStart };
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }, []);
  const [zone, setZone] = useState(l.timeZone);
  const zoneOk = isTimeZone(zone);

  return (
    <AdminSection id="locale" intro={t("admin.locale.intro")}>
      <Setting label={t("admin.locale.lang")} hint={t("admin.locale.langHint")}>
        <Choices
          label={t("admin.locale.lang")}
          value={l.lang}
          onChange={(v) => void save({ locale: { lang: v } })}
          options={[
            { value: "sv", label: "Svenska" },
            { value: "en", label: "English" },
          ]}
        />
      </Setting>
      <Setting label={t("admin.locale.date")}>
        <Choices<DateStyle>
          label={t("admin.locale.date")}
          value={l.dateStyle}
          onChange={(v) => void save({ locale: { dateStyle: v } })}
          options={[
            { value: "text", label: t("admin.locale.dateText"), example: formatDay(now, { ...rules, dateStyle: "text" }, { year: true }) },
            { value: "iso", label: t("admin.locale.dateIso"), example: formatDay(now, { ...rules, dateStyle: "iso" }) },
          ]}
        />
      </Setting>
      <Setting label={t("admin.locale.clock")}>
        <Choices<Clock>
          label={t("admin.locale.clock")}
          value={l.clock}
          onChange={(v) => void save({ locale: { clock: v } })}
          options={[
            { value: "24", label: t("admin.locale.clock24"), example: formatTime("14:05", { ...rules, clock: "24" }) },
            { value: "12", label: t("admin.locale.clock12"), example: formatTime("14:05", { ...rules, clock: "12" }) },
          ]}
        />
      </Setting>
      <Setting label={t("admin.locale.week")} hint={t("admin.locale.weekHint")}>
        <Choices<WeekStart>
          label={t("admin.locale.week")}
          value={l.weekStart}
          onChange={(v) => void save({ locale: { weekStart: v } })}
          options={[
            { value: "monday", label: t("admin.locale.monday") },
            { value: "sunday", label: t("admin.locale.sunday") },
          ]}
        />
      </Setting>
      <Setting label={t("admin.locale.zone")} hint={t("admin.locale.zoneHint")}>
        <form
          className="zone-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (zoneOk && zone !== l.timeZone) void save({ locale: { timeZone: zone } });
          }}
        >
          <input list="noterat-zones" value={zone} onChange={(e) => setZone(e.target.value.trim())} aria-label={t("admin.locale.zone")} spellCheck={false} autoComplete="off" aria-invalid={!zoneOk} />
          <datalist id="noterat-zones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <button type="submit" className="secondary small" disabled={!zoneOk || zone === l.timeZone}>
            {t("note.save")}
          </button>
          <span className="muted small-text zone-now">{zoneOk ? t("admin.locale.zoneNow", { time: formatTime(clockIn(now, zone), rules) }) : t("admin.locale.zoneBad")}</span>
        </form>
      </Setting>
      {problem && <Problem>{problem}</Problem>}
    </AdminSection>
  );
}
