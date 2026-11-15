// The shell's own words (the tray's menu, the right-click menu): Swedish when the computer is, else English.

const SV = {
  "Open Noterat": "Öppna Noterat",
  "Start at log-in": "Starta vid inloggning",
  Quit: "Avsluta",
  Cut: "Klipp ut",
  Copy: "Kopiera",
  Paste: "Klistra in",
  "Select all": "Markera allt",
  "Add to dictionary": "Lägg till i ordlistan",
};

let swedish = false;

/** The language from a locale such as "sv-SE" (app.getLocale()). */
export function setLang(locale) {
  swedish = /^sv\b/i.test(locale ?? "");
}

export const t = (text) => (swedish ? (SV[text] ?? text) : text);
