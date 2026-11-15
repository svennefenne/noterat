import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { cleanHousehold, defaultHousehold, isScheme, lookBackground, lookCss, LOOK_MODES, type Household, type LookMode } from "@noterat/core";

/**
 * The household's settings (decision 14) on this device: kept from last time, so the app looks and
 * reads right at once and offline, and asked for again from the server (at the start, when the server
 * says they changed, and after an admin saves them). Anyone may read them, logged in or not.
 *
 * The look: the household's scheme and mode, unless this person picked their own on this device
 * ("Utseende…" in the menu). It's put on the page as a stylesheet, and kept for index.html, which puts it
 * on before the app has loaded, so there's no flash of the wrong colours.
 */

const CACHE = "noterat.household";
const MINE = "noterat.look.mine";
/** (index.html reads this one before anything else loads) */
const LOOK_CSS = "noterat.look.css";

/** this person's own look on this device: either part null follows the household */
export interface MyLook {
  scheme: string | null;
  mode: LookMode | null;
}

const read = <T,>(key: string): T | null => {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    // (no storage: as it is until the app closes)
  }
};

function firstHousehold(): Household {
  return cleanHousehold(read(CACHE), defaultHousehold());
}

function firstMine(): MyLook {
  const m = read<Partial<MyLook>>(MINE);
  return { scheme: isScheme(m?.scheme) ? m.scheme : null, mode: LOOK_MODES.includes(m?.mode as LookMode) ? (m!.mode as LookMode) : null };
}

interface HouseholdState {
  household: Household;
  /** asks the server at `base` again ("" on the website) */
  refresh: (base?: string) => void;
  /** what an admin just saved (the server's answer) */
  set: (h: Household) => void;
  mine: MyLook;
  setMine: (m: MyLook) => void;
  /** the look in use: this person's, else the household's */
  look: { scheme: string; mode: LookMode };
}

const Ctx = createContext<HouseholdState | null>(null);

export function HouseholdProvider({ base: firstBase, children }: { base: string | null; children: ReactNode }) {
  const [household, setHousehold] = useState<Household>(firstHousehold);
  const [mine, setMineState] = useState<MyLook>(firstMine);
  const [base, setBase] = useState(firstBase);
  const [asked, setAsked] = useState(0);

  const set = useCallback((h: Household) => {
    write(CACHE, h);
    setHousehold(h);
  }, []);

  const refresh = useCallback((b?: string) => {
    if (b !== undefined) setBase(b);
    setAsked((n) => n + 1);
  }, []);

  useEffect(() => {
    if (base === null) return;
    let gone = false;
    fetch(`${base}/api/household`, { signal: AbortSignal.timeout(15_000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((h: unknown) => {
        if (!gone && h) set(cleanHousehold(h, defaultHousehold()));
      })
      .catch(() => {
        // (offline, or an older server: what this device has)
      });
    return () => {
      gone = true;
    };
  }, [base, asked, set]);

  const setMine = useCallback((m: MyLook) => {
    write(MINE, m.scheme === null && m.mode === null ? null : m);
    setMineState(m);
  }, []);

  const look = useMemo(() => ({ scheme: mine.scheme ?? household.look.scheme, mode: mine.mode ?? household.look.mode }), [mine, household.look]);

  // the colours on the page, and the bars' colour (theme-color) with them
  useEffect(() => {
    const css = lookCss(look.scheme, look.mode);
    let style = document.getElementById("noterat-look") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "noterat-look";
      document.head.appendChild(style);
    }
    style.textContent = css;
    write(LOOK_CSS, css);
    const light = lookBackground(look.scheme, look.mode === "dark" ? "dark" : "light");
    const dark = lookBackground(look.scheme, look.mode === "light" ? "light" : "dark");
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
      m.content = m.media.includes("dark") ? dark : light;
    });
  }, [look]);

  const value = useMemo<HouseholdState>(() => ({ household, refresh, set, mine, setMine, look }), [household, refresh, set, mine, setMine, look]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHousehold(): HouseholdState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useHousehold outside HouseholdProvider");
  return v;
}
