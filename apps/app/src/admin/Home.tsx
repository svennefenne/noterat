import { ArrowDown, ArrowUp, BookHeart, CalendarDays, ChefHat, ListChecks, Mic, NotebookPen, ScanLine, Wallet } from "lucide-react";
import { HOME_COUNTS, type HomeCount, type HomeSectionSetting } from "@noterat/core";
import { useI18n, type TextKey } from "../lib/i18n";
import { Problem } from "../ui";
import { AdminSection, Switch, useSaveHousehold } from "./AdminScreen";

const ICON = { calendar: CalendarDays, list: ListChecks, note: NotebookPen, memo: Mic, scan: ScanLine, recipe: ChefHat, journal: BookHeart, money: Wallet } as const;

/**
 * The start page (decision 15) as the household sees it: which sections show, in what order, and how many
 * of each one's latest. The journal and money start off; they're private enough to ask for.
 */
export function HomeSettingsSection() {
  const { t } = useI18n();
  const { household, save, problem } = useSaveHousehold();
  const sections = household.home.sections;
  const put = (next: HomeSectionSetting[]) => void save({ home: { sections: next } });
  const change = (i: number, patch: Partial<HomeSectionSetting>) => put(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...sections];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    put(next);
  };

  return (
    <AdminSection id="home" intro={t("admin.home.intro")}>
      <ol className="home-settings">
        {sections.map((s, i) => {
          const Icon = ICON[s.type];
          const name = t(`home.section.${s.type}` as TextKey);
          return (
            <li key={s.type} className={s.show ? undefined : "off"}>
              <span className="home-settings-order">
                <button type="button" className="icon-button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("admin.home.up", { name })} title={t("admin.home.up", { name })}>
                  <ArrowUp aria-hidden size={16} />
                </button>
                <button type="button" className="icon-button" disabled={i === sections.length - 1} onClick={() => move(i, 1)} aria-label={t("admin.home.down", { name })} title={t("admin.home.down", { name })}>
                  <ArrowDown aria-hidden size={16} />
                </button>
              </span>
              <Icon aria-hidden size={18} className="home-settings-icon" />
              <span className="home-settings-name">
                {name}
                <small className="muted">{t(`admin.home.what.${s.type}` as TextKey)}</small>
              </span>
              <div className="segmented labels" role="group" aria-label={t("admin.home.count", { name })}>
                {HOME_COUNTS.map((n: HomeCount) => (
                  <button key={n} type="button" aria-pressed={s.count === n} disabled={!s.show} onClick={() => change(i, { count: n })}>
                    {n}
                  </button>
                ))}
              </div>
              <Switch on={s.show} label={t("admin.home.show", { name })} onChange={(show) => change(i, { show })} />
            </li>
          );
        })}
      </ol>
      {problem && <Problem>{problem}</Problem>}
    </AdminSection>
  );
}
