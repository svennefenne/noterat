/**
 * The household's look (decision 14): Noterat's own colours, and Hooden's 98 colour schemes, each with a
 * light and a dark set. Hooden's own (Communarr) and 97 palettes from claude-desktop-extra
 * (github.com/patrickjaja/claude-desktop-extra, MIT; its community palettes come from
 * github.com/noctalia-dev/community-palettes), copied from Hooden's src/lib/palettes.json.
 *
 * A scheme's nine colours become the app's own colour variables (styles.css) with Hooden's colour maths;
 * Noterat's own scheme keeps the app's colours exactly as they were.
 */

import raw from "./palettes.json";

export interface Colors {
  bg: string;
  surface: string;
  text: string;
  primary: string;
  secondary: string;
  error: string;
  warning: string;
  success: string;
  border: string;
}

export type SchemeCategory = "noterat" | "communarr" | "builtin" | "gaming" | "community";
export type LookMode = "auto" | "light" | "dark";
export const LOOK_MODES: LookMode[] = ["auto", "light", "dark"];

export interface Scheme {
  slug: string;
  name: string;
  category: SchemeCategory;
  light: Colors;
  dark: Colors;
}

/** the app's colours since the start: its own variables exactly, beside the nine colours for a preview */
const NOTERAT_TOKENS = {
  light: {
    "--bg": "#f5f2ec",
    "--surface": "#fffdf9",
    "--text": "#1f1d1a",
    "--muted": "#69645b",
    "--line": "#e0dbd1",
    "--accent": "#2f5d50",
    "--accent-text": "#f5f2ec",
    "--accent-soft": "#e2ebe7",
    "--danger": "#a3261c",
    "--danger-soft": "#f7e4e1",
    "--hover": "#efebe3",
    "--shadow": "0 10px 30px rgb(31 29 26 / 0.12), 0 2px 6px rgb(31 29 26 / 0.08)",
    "color-scheme": "light",
  },
  dark: {
    "--bg": "#161514",
    "--surface": "#201e1c",
    "--text": "#ece8e1",
    "--muted": "#a49e94",
    "--line": "#36332f",
    "--accent": "#8cc5b0",
    "--accent-text": "#10201b",
    "--accent-soft": "#22322d",
    "--danger": "#f2a49a",
    "--danger-soft": "#3a2320",
    "--hover": "#2a2825",
    "--shadow": "0 10px 30px rgb(0 0 0 / 0.45), 0 2px 6px rgb(0 0 0 / 0.3)",
    "color-scheme": "dark",
  },
};

export const NOTERAT: Scheme = {
  slug: "noterat",
  name: "Noterat",
  category: "noterat",
  light: { bg: "#f5f2ec", surface: "#fffdf9", text: "#1f1d1a", primary: "#2f5d50", secondary: "#69645b", error: "#a3261c", warning: "#b7791f", success: "#2f7d4a", border: "#e0dbd1" },
  dark: { bg: "#161514", surface: "#201e1c", text: "#ece8e1", primary: "#8cc5b0", secondary: "#a49e94", error: "#f2a49a", warning: "#e0b060", success: "#7fc49a", border: "#36332f" },
};

/** Hooden's own (Deck Force's retro poster colours) */
const COMMUNARR: Scheme = {
  slug: "communarr",
  name: "Communarr",
  category: "communarr",
  dark: { bg: "#070b10", surface: "#121b23", text: "#efe3c8", primary: "#d65a2b", secondary: "#e2a634", error: "#e2533a", warning: "#e2a634", success: "#5cc46a", border: "#c9bda3" },
  light: { bg: "#ece2cc", surface: "#f8f1e2", text: "#1c242c", primary: "#c9531f", secondary: "#a26d12", error: "#b3421c", warning: "#a26d12", success: "#2c7436", border: "#3b444c" },
};

export const SCHEMES: Scheme[] = [NOTERAT, COMMUNARR, ...(raw as Scheme[])];
const BY_SLUG = new Map(SCHEMES.map((s) => [s.slug, s]));
export const SCHEME_CATEGORIES: SchemeCategory[] = ["noterat", "communarr", "builtin", "gaming", "community"];

export const isScheme = (slug: unknown): slug is string => typeof slug === "string" && BY_SLUG.has(slug);
export const schemeOf = (slug: string | null | undefined): Scheme => (slug && BY_SLUG.get(slug)) || NOTERAT;

// ── colour maths (Hooden's) ──

function rgb(hex: string): [number, number, number] {
  let h = (hex || "#000").replace("#", "").trim();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex = (c: number[]) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

function luminance(color: string) {
  const f = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb(color);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export const isDark = (color: string) => luminance(color) < 0.25;

/** black or white, whichever reads better on `color` */
export const onColor = (color: string) => (luminance(color) > 0.36 ? "#0b0d10" : "#fff8ec");

/** `a` turned `t` of the way towards `b` */
export function mix(a: string, b: string, t: number) {
  const x = rgb(a);
  const y = rgb(b);
  return hex(x.map((v, i) => v + (y[i]! - v) * t));
}

/** The app's colour variables (styles.css) for one set of a scheme's colours. */
export function lookTokens(scheme: Scheme, set: "light" | "dark"): Record<string, string> {
  if (scheme.slug === NOTERAT.slug) return NOTERAT_TOKENS[set];
  const c = scheme[set];
  const dark = isDark(c.bg);
  const shadow = rgb(dark ? "#000000" : c.text).join(" ");
  return {
    "--bg": c.bg,
    "--surface": c.surface,
    "--text": c.text,
    "--muted": mix(c.bg, c.text, 0.62),
    "--line": mix(c.bg, c.text, dark ? 0.16 : 0.12),
    "--accent": c.primary,
    "--accent-text": onColor(c.primary),
    "--accent-soft": mix(c.bg, c.primary, dark ? 0.16 : 0.12),
    "--danger": c.error,
    "--danger-soft": mix(c.bg, c.error, dark ? 0.18 : 0.12),
    "--hover": mix(c.bg, c.text, dark ? 0.08 : 0.05),
    "--shadow": dark ? `0 10px 30px rgb(${shadow} / 0.45), 0 2px 6px rgb(${shadow} / 0.3)` : `0 10px 30px rgb(${shadow} / 0.12), 0 2px 6px rgb(${shadow} / 0.08)`,
    "color-scheme": dark ? "dark" : "light",
  };
}

const block = (vars: Record<string, string>) =>
  `:root:root{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`;

/**
 * The stylesheet for a scheme and a mode: auto follows the device. (:root:root, so it wins over the
 * app's own colours in styles.css whichever comes first.)
 */
export function lookCss(slug: string, mode: LookMode): string {
  const s = schemeOf(slug);
  if (mode === "light") return block(lookTokens(s, "light"));
  if (mode === "dark") return block(lookTokens(s, "dark"));
  return `${block(lookTokens(s, "light"))}@media (prefers-color-scheme: dark){${block(lookTokens(s, "dark"))}}`;
}

/** the background, for the browser's and the phone's bars (theme-color) */
export const lookBackground = (slug: string, set: "light" | "dark") => schemeOf(slug)[set].bg;
