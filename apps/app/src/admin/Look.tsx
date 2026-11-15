import { useMemo, useState, useSyncExternalStore } from "react";
import { Check, Dices, Monitor, Moon, Search, Sun } from "lucide-react";
import { LOOK_MODES, SCHEME_CATEGORIES, SCHEMES, schemeOf, type LookMode, type Scheme, type SchemeCategory } from "@noterat/core";
import { useHousehold } from "../lib/household";
import { useI18n } from "../lib/i18n";
import { Problem } from "../ui";
import { AdminSection, Setting, useSaveHousehold } from "./AdminScreen";

const MODE_ICON = { auto: Monitor, light: Sun, dark: Moon } as const;

/** whether the device is in dark mode now (for "auto") */
function useDeviceDark() {
  return useSyncExternalStore(
    (on) => {
      const m = matchMedia("(prefers-color-scheme: dark)");
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    },
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
}

/** Auto, light or dark ("follow" too: the household's, for someone's own look). */
export function ModePick({ mode, onChange, follow }: { mode: LookMode | null; onChange: (m: LookMode | null) => void; follow?: string }) {
  const { t } = useI18n();
  return (
    <div className="segmented labels" role="group" aria-label={t("look.mode")}>
      {follow && (
        <button type="button" aria-pressed={mode === null} onClick={() => onChange(null)}>
          {follow}
        </button>
      )}
      {LOOK_MODES.map((m) => {
        const Icon = MODE_ICON[m];
        return (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m)}>
            <Icon aria-hidden size={16} /> {t(`look.mode.${m}`)}
          </button>
        );
      })}
    </div>
  );
}

/** A scheme in small: its background, a panel with text, and its accents. */
function Mini({ s, dark }: { s: Scheme; dark: boolean }) {
  const c = dark ? s.dark : s.light;
  return (
    <span className="scheme-mini" style={{ background: c.bg }} aria-hidden>
      <span className="scheme-mini-panel" style={{ background: c.surface, borderColor: `color-mix(in srgb, ${c.text} 14%, ${c.surface})` }}>
        <span className="scheme-mini-line" style={{ background: c.text }} />
        <span className="scheme-mini-line short" style={{ background: c.text, opacity: 0.45 }} />
        <span className="scheme-mini-dots">
          <span style={{ background: c.primary }} />
          <span style={{ background: c.secondary }} />
          <span style={{ background: c.error }} />
        </span>
      </span>
      <span className="scheme-mini-button" style={{ background: c.primary }} />
    </span>
  );
}

/**
 * Hooden's colour schemes and Noterat's own, as a grid of small previews: by kind, found by name, or one
 * at random. The previews show the set the mode will use (auto: the device's now).
 */
export function SchemePicker({ scheme, mode, onPick }: { scheme: string | null; mode: LookMode; onPick: (slug: string) => void }) {
  const { t } = useI18n();
  const deviceDark = useDeviceDark();
  const dark = mode === "dark" || (mode === "auto" && deviceDark);
  const [category, setCategory] = useState<SchemeCategory | "all">("all");
  const [find, setFind] = useState("");
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return SCHEMES.filter((s) => (category === "all" || s.category === category) && (!q || s.name.toLowerCase().includes(q)));
  }, [category, find]);

  return (
    <div className="scheme-picker">
      <div className="scheme-tools">
        <div className="chips" role="group" aria-label={t("look.categories")}>
          {(["all", ...SCHEME_CATEGORIES] as const).map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {t(`look.category.${c}`)} <span className="muted">{c === "all" ? SCHEMES.length : SCHEMES.filter((s) => s.category === c).length}</span>
            </button>
          ))}
        </div>
        <div className="scheme-find">
          <label className="search-field">
            <Search aria-hidden size={16} />
            <input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t("look.find")} aria-label={t("look.find")} />
          </label>
          <button type="button" className="secondary small" onClick={() => onPick(SCHEMES[1 + Math.floor(Math.random() * (SCHEMES.length - 1))]!.slug)}>
            <Dices aria-hidden size={16} /> {t("look.surprise")}
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="muted">{t("look.none")}</p>
      ) : (
        <ul className="scheme-grid">
          {shown.map((s) => (
            <li key={s.slug}>
              <button type="button" className="scheme-tile" aria-pressed={scheme === s.slug} onClick={() => onPick(s.slug)}>
                <Mini s={s} dark={dark} />
                <span className="scheme-name">
                  {scheme === s.slug && <Check aria-hidden size={14} />}
                  {s.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small-text">{t("look.credit")}</p>
    </div>
  );
}

/** The household's look (decision 14): its scheme and light or dark, for everyone who hasn't picked their own. */
export function LookSection() {
  const { t } = useI18n();
  const { household, save, problem } = useSaveHousehold();
  const { mine, setMine } = useHousehold();
  return (
    <AdminSection id="look" intro={t("admin.look.intro")}>
      {(mine.scheme || mine.mode) && (
        <p className="notice small-text admin-mine">
          {t("admin.look.mine")}{" "}
          <button type="button" className="link-button" onClick={() => setMine({ scheme: null, mode: null })}>
            {t("look.followHousehold")}
          </button>
        </p>
      )}
      <Setting label={t("look.mode")} hint={t("look.modeHint")}>
        <ModePick mode={household.look.mode} onChange={(mode) => mode && void save({ look: { mode } })} />
      </Setting>
      {problem && <Problem>{problem}</Problem>}
      <SchemePicker scheme={household.look.scheme} mode={household.look.mode} onPick={(scheme) => void save({ look: { scheme } })} />
    </AdminSection>
  );
}

/** Someone's own look on this device ("Utseende…" in the menu): the household's, or a scheme and mode of their own. */
export function MyLookForm({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { household, mine, setMine, look } = useHousehold();
  const theirs = `${schemeOf(household.look.scheme).name}, ${t(`look.mode.${household.look.mode}`).toLowerCase()}`;
  return (
    <div className="stack my-look">
      <p className="muted small-text">{t("look.mineIntro", { household: theirs })}</p>
      <div className="field">
        <span className="field-label">{t("look.mode")}</span>
        <ModePick mode={mine.mode} follow={t("look.household")} onChange={(mode) => setMine({ ...mine, mode })} />
      </div>
      <div className="field">
        <span className="field-label">{t("look.scheme")}</span>
        <div className="segmented labels" role="group" aria-label={t("look.scheme")}>
          <button type="button" aria-pressed={mine.scheme === null} onClick={() => setMine({ ...mine, scheme: null })}>
            {t("look.household")}
          </button>
          <button type="button" aria-pressed={mine.scheme !== null} onClick={() => mine.scheme === null && setMine({ ...mine, scheme: look.scheme })}>
            {t("look.own")}
          </button>
        </div>
      </div>
      {mine.scheme !== null && <SchemePicker scheme={mine.scheme} mode={look.mode} onPick={(scheme) => setMine({ ...mine, scheme })} />}
      <div className="dialog-actions">
        <button type="button" className="primary" onClick={onDone}>
          {t("budget.done")}
        </button>
      </div>
    </div>
  );
}
