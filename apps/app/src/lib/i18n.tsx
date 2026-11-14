import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PASSWORD_MIN, type ErrorCode } from "@noterat/core";
import { ApiError } from "./api";

/**
 * The app's words in Swedish and English. Swedish is the default for a Swedish device; anyone can
 * switch, and the choice is kept on the device. Every key is in both (TypeScript checks English
 * against Swedish), and every error code the server can answer has its text.
 */

const sv = {
  "app.tagline": "Anteckningar, listor och allt annat. Delat när du vill.",
  "lang.other": "English",

  "server.title": "Anslut till din server",
  "server.intro": "Skriv adressen till din Noterat-server.",
  "server.address": "Serveradress",
  "server.connect": "Anslut",
  "server.invalid": "Det där ser inte ut som en adress.",
  "server.notNoterat": "Det där verkar inte vara en Noterat-server.",
  "server.change": "Byt server",

  "unreachable.title": "Servern svarar inte",
  "unreachable.text": "Kunde inte nå {server}. Kontrollera att du är uppkopplad och försök igen.",
  "unreachable.retry": "Försök igen",

  "setup.title": "Skapa det första kontot",
  "setup.intro": "Servern har inga konton än. Kontot du skapar nu blir administratör.",
  "setup.submit": "Skapa konto",

  "login.title": "Logga in",
  "login.submit": "Logga in",

  "field.username": "Användarnamn",
  "field.usernameHint": "2–32 tecken: a–z, siffror, punkt, bindestreck eller understreck.",
  "field.displayName": "Namn",
  "field.displayNameHint": "Så som andra ser dig när du delar något.",
  "field.password": "Lösenord",
  "field.passwordHint": "Minst {min} tecken.",

  "home.hello": "Hej {name}!",
  "home.intro": "Du är inloggad. Listor, anteckningar och resten av Noterat kommer i nästa steg.",
  "home.offline": "Ingen kontakt med servern just nu. Det som finns på enheten fungerar ändå.",
  "home.server": "Server",
  "home.signedInAs": "Inloggad som",
  "home.logout": "Logga ut",

  "error.network": "Kunde inte nå servern.",
  "error.server_error": "Något gick fel på servern. Försök igen.",
  "error.bad_request": "Servern förstod inte frågan.",
  "error.unauthorized": "Du har blivit utloggad. Logga in igen.",
  "error.not_found": "Hittades inte.",
  "error.setup_done": "Servern har redan ett första konto. Logga in i stället.",
  "error.login_failed": "Fel användarnamn eller lösenord.",
  "error.too_many_attempts": "För många försök. Vänta en stund och försök igen.",
  "error.username_invalid": "Användarnamnet får ha 2–32 tecken: a–z, siffror, punkt, bindestreck eller understreck.",
  "error.username_taken": "Användarnamnet är upptaget.",
  "error.name_missing": "Skriv ditt namn.",
  "error.name_long": "Namnet är för långt.",
  "error.password_short": "Lösenordet måste ha minst {min} tecken.",
  "error.password_long": "Lösenordet är för långt.",
} satisfies Record<`error.${ErrorCode | "network"}`, string> & Record<string, string>;

export type TextKey = keyof typeof sv;

const en: Record<TextKey, string> = {
  "app.tagline": "Notes, lists and everything else. Shared when you want.",
  "lang.other": "Svenska",

  "server.title": "Connect to your server",
  "server.intro": "Type the address of your Noterat server.",
  "server.address": "Server address",
  "server.connect": "Connect",
  "server.invalid": "That doesn't look like an address.",
  "server.notNoterat": "That doesn't seem to be a Noterat server.",
  "server.change": "Change server",

  "unreachable.title": "The server isn't answering",
  "unreachable.text": "Couldn't reach {server}. Check that you're online and try again.",
  "unreachable.retry": "Try again",

  "setup.title": "Make the first account",
  "setup.intro": "The server has no accounts yet. The one you make now is its admin.",
  "setup.submit": "Make the account",

  "login.title": "Log in",
  "login.submit": "Log in",

  "field.username": "Username",
  "field.usernameHint": "2–32 characters: a–z, digits, dot, hyphen or underscore.",
  "field.displayName": "Name",
  "field.displayNameHint": "How others see you when you share something.",
  "field.password": "Password",
  "field.passwordHint": "At least {min} characters.",

  "home.hello": "Hi {name}!",
  "home.intro": "You're logged in. Lists, notes and the rest of Noterat come in the next steps.",
  "home.offline": "No contact with the server right now. What's on this device still works.",
  "home.server": "Server",
  "home.signedInAs": "Logged in as",
  "home.logout": "Log out",

  "error.network": "Couldn't reach the server.",
  "error.server_error": "Something went wrong on the server. Try again.",
  "error.bad_request": "The server didn't understand the request.",
  "error.unauthorized": "You've been logged out. Log in again.",
  "error.not_found": "Not found.",
  "error.setup_done": "The server already has its first account. Log in instead.",
  "error.login_failed": "Wrong username or password.",
  "error.too_many_attempts": "Too many tries. Wait a while and try again.",
  "error.username_invalid": "A username has 2–32 characters: a–z, digits, dot, hyphen or underscore.",
  "error.username_taken": "That username is taken.",
  "error.name_missing": "Write your name.",
  "error.name_long": "That name is too long.",
  "error.password_short": "The password needs at least {min} characters.",
  "error.password_long": "That password is too long.",
};

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
  /** what went wrong, in words: an ApiError's code, or anything else as a server error */
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
    const errorText = (err: unknown) => t(`error.${err instanceof ApiError ? err.code : "server_error"}`, { min: PASSWORD_MIN });
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
