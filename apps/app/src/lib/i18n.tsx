import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ListProblem, MAX_ROWS, PASSWORD_MIN } from "@noterat/core";
import { ApiError } from "./api";
import { en, sv, type TextKey } from "./texts";

/**
 * The app's language: Swedish by default (English on an English device); anyone can switch, and the
 * choice is kept on the device. The words themselves are in texts.ts.
 */

export type { TextKey };
export type Lang = "sv" | "en";
const TEXTS: Record<Lang, Record<TextKey, string>> = { sv, en };
const LANG_KEY = "noterat.lang";

function startLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "sv" || saved === "en") return saved;
  } catch {
    // (no storage: the device's language)
  }
  return navigator.language.toLowerCase().startsWith("en") ? "en" : "sv";
}

export type Translate = (key: TextKey, vars?: Record<string, string | number>) => string;

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
  /** what went wrong, in words: an ApiError's code, a list's problem, or anything else as a server error */
  errorText: (err: unknown) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(startLang);
  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      // (kept until the app closes)
    }
    setLangState(l);
  }, []);
  const value = useMemo<I18n>(() => {
    const t: Translate = (key, vars) => TEXTS[lang][key].replace(/\{(\w+)\}/g, (m, name: string) => String(vars?.[name] ?? m));
    const errorText = (err: unknown) => {
      if (err instanceof ListProblem) return t(`problem.${err.code}`, { ...err.vars, max: MAX_ROWS });
      return t(`error.${err instanceof ApiError ? err.code : "server_error"}`, { min: PASSWORD_MIN });
    };
    return { lang, setLang, t, errorText };
  }, [lang, setLang]);
  // (the page's language follows, for screen readers and hyphenation)
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n outside I18nProvider");
  return v;
}
