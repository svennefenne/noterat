import { NUM, readNumber, writeNumber } from "./ingredients";

/**
 * A recipe's American measures in the ones a Swedish kitchen uses (decision 9): "4 cups" is
 * "9 ½ dl", "2 tablespoons" "2 msk", "1 pound" "450 g", "1 (15-ounce) can" "1 (430 g) can", "350°F"
 * "175 °C", "9x13-inch" "23 x 33 cm". Only shown: the recipe keeps its own words. Rounded as a cook
 * would (a cup is 2,4 dl, not 2,37), and where the recipe gives its own metric measure beside the
 * other ("1 cup (240 ml)"), that's the one kept.
 */

export type MeasureLang = "sv" | "en";

type Kind = "tsp" | "tbsp" | "volume" | "weight" | "stick" | "inch";

interface Unit {
  kind: Kind;
  /** the words for it (a regular expression's source) */
  words: string;
  /** ml, g or cm in one */
  size: number;
  /** what it's called where the recipe is said to use it */
  name: string;
}

// (an abbreviation's full stop goes with it when the sentence goes on: "8 oz. cream cheese")
const DOT = String.raw`(?:\.(?=\s+[a-zåäö(]))?`;
const UNITS: Unit[] = [
  { kind: "volume", words: String.raw`fluid\s+ounces?|fl\.?\s?oz${DOT}`, size: 29.5735, name: "fl oz" },
  { kind: "tbsp", words: String.raw`tablespoons?|tbsps?${DOT}|tbls?${DOT}|tbs${DOT}`, size: 15, name: "tablespoons" },
  { kind: "tsp", words: String.raw`teaspoons?|tsps?${DOT}`, size: 5, name: "teaspoons" },
  { kind: "volume", words: String.raw`cups?`, size: 236.588, name: "cups" },
  { kind: "volume", words: String.raw`pints?`, size: 473.176, name: "pints" },
  { kind: "volume", words: String.raw`quarts?|qts?${DOT}`, size: 946.353, name: "quarts" },
  { kind: "volume", words: String.raw`gallons?|gal${DOT}`, size: 3785.41, name: "gallons" },
  { kind: "weight", words: String.raw`ounces?|oz${DOT}`, size: 28.3495, name: "ounces" },
  { kind: "weight", words: String.raw`pounds?|lbs?${DOT}`, size: 453.592, name: "pounds" },
  { kind: "stick", words: String.raw`sticks?`, size: 113.4, name: "sticks" },
  { kind: "inch", words: String.raw`inch(?:es)?`, size: 2.54, name: "inches" },
];
const WHICH = UNITS.map((u) => ({ unit: u, re: new RegExp(`^(?:${u.words})\\.?$`, "i") }));
const unitOf = (word: string) => WHICH.find((w) => w.re.test(word))!.unit;

// The recipe's own metric measure after the other, "(240 ml)", "(about 175°C)", "/175°C": kept.
const METRIC = String.raw`\d\s*(?:ml|cl|dl|l|g|kg|grams?|liters?|litres?|°\s?C|ºC)\b`;
const GIVEN = String.raw`(?:\s*\(\s*(?:about\s+|approx\.?\s+|ca\.?\s+)?([^()]*?${METRIC}[^()]*)\)|\s*\/\s*([\d.,]+\s*(?:ml|cl|dl|l|g|kg|°\s?C|ºC)))?`;
const START = String.raw`(?<![\w.,/])`;
const SEP = String.raw`(?:\s*-\s*|\s+)?`;
const QUANTITY = new RegExp(`${START}(${NUM})(?:\\s*(?:[-–]|to)\\s*(${NUM}))?${SEP}(${UNITS.map((u) => u.words).join("|")})(?![a-zåäö])${GIVEN}`, "gi");
const DIMENSION = new RegExp(`${START}(${NUM})\\s*[x×]\\s*(${NUM})(?:\\s*[x×]\\s*(${NUM}))?${SEP}inch(?:es)?(?![a-z])`, "gi");
// (no i: "F" is a capital; "350 F" and "350 degrees" alone are Fahrenheit only when hot enough)
const TEMPERATURE = new RegExp(`${START}(\\d{2,3})(?:\\s*[-–]\\s*(\\d{2,3}))?\\s*(°\\s*F|º\\s*F|[Dd]egrees\\s+(?:F|[Ff]ahrenheit)|F|[Dd]egrees)(?![A-Za-z])${GIVEN}`, "g");
// "240 ml (1 cup)": the recipe's own measure, and the other in brackets after it, to go
const METRIC_FIRST = new RegExp(`(${METRIC})\\s*\\(([^()]{1,40})\\)`, "gi");

const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const fraction = (n: number, lang: MeasureLang) => (lang === "en" ? writeNumber(n).replace(",", ".") : writeNumber(n));
const decimal = (n: number, lang: MeasureLang) => {
  const s = String(Math.round(n * 10) / 10);
  return lang === "en" ? s : s.replace(".", ",");
};
/** "2–3", or "2" when both ends come out the same */
const range = (ns: number[], write: (n: number) => string) => [...new Set(ns.map(write))].join("–");

function volume(ml: number[], lang: MeasureLang): string {
  const top = Math.max(...ml);
  if (top < 45) return `${range(ml.map((v) => roundTo(v / 15, 0.5)), (n) => fraction(n, lang))} ${lang === "sv" ? "msk" : "tbsp"}`;
  if (top < 1000) {
    const step = top < 100 ? 0.25 : top < 500 ? 0.1 : 0.5;
    return `${range(ml.map((v) => roundTo(v / 100, step)), (n) => fraction(n, lang))} dl`;
  }
  return `${range(ml.map((v) => v / 1000), (n) => decimal(n, lang))} l`;
}

function weight(g: number[], lang: MeasureLang): string {
  const top = Math.max(...g);
  if (top >= 1000) return `${range(g.map((v) => v / 1000), (n) => decimal(n, lang))} kg`;
  const step = top < 20 ? 1 : top < 100 ? 5 : 10;
  return `${range(g.map((v) => Math.max(step, roundTo(v, step))), String)} g`;
}

const centimetres = (cm: number[], lang: MeasureLang) => range(cm.map((v) => roundTo(v, Math.max(...cm) < 10 ? 0.5 : 1)), (n) => decimal(n, lang));

/** One amount in a metric measure, or null to leave it as it is. */
function metric(unit: Unit, amounts: number[], lang: MeasureLang, text: string): string | null {
  const n = amounts.map((a) => a * unit.size);
  switch (unit.kind) {
    case "tsp":
    case "tbsp":
      // (the same spoon: only the word is Swedish)
      return lang === "sv" ? `${range(amounts, (a) => fraction(a, lang))} ${unit.kind === "tsp" ? "tsk" : "msk"}` : null;
    case "volume":
      return volume(n, lang);
    case "stick":
      return /butter|margarine|smör/i.test(text) ? weight(n, lang) : null;
    case "weight":
      return weight(n, lang);
    case "inch":
      return `${centimetres(n, lang)} cm`;
  }
}

const celsius = (f: number) => roundTo(((f - 32) * 5) / 9, 5);
const hotEnough = (f: number, said: string) => (said === "F" ? f >= 200 && f <= 550 : /^degrees$/i.test(said) ? f > 260 && f <= 550 : true);

/** The text with its American measures in metric ones (lang: what tsp and tbsp are called). */
export function toMetric(text: string, lang: MeasureLang = "sv"): string {
  return text
    .replace(METRIC_FIRST, (all, own: string, other: string) => (foreignMeasures(other, lang).length ? own : all))
    .replace(DIMENSION, (all, a: string, b: string, c?: string) => {
      const sides = [a, b, c].filter((x): x is string => !!x).map(readNumber);
      return sides.every((x) => x !== null) ? `${sides.map((x) => centimetres([x! * 2.54], lang)).join(" x ")} cm` : all;
    })
    .replace(TEMPERATURE, (all, a: string, b: string | undefined, said: string, given?: string, slashed?: string) => {
      if (given || slashed) return (given ?? slashed)!.trim();
      const f = [Number(a), ...(b ? [Number(b)] : [])];
      if (!f.every((x) => hotEnough(x, said.replace(/\s+/g, "")))) return all;
      return `${range(f.map(celsius), String)} °C`;
    })
    .replace(QUANTITY, (all, a: string, b: string | undefined, word: string, given?: string, slashed?: string, offset?: number, whole?: string) => {
      if (given || slashed) return (given ?? slashed)!.trim();
      const amounts = [readNumber(a), ...(b ? [readNumber(b)] : [])];
      if (amounts.some((x) => x === null)) return all;
      return metric(unitOf(word), amounts as number[], lang, whole ?? text) ?? all;
    });
}

/** The American measures a text uses ("cups", "ounces", "°F"), each once: none, and there's nothing to convert. */
export function foreignMeasures(text: string, lang: MeasureLang = "sv"): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(QUANTITY)) {
    const unit = unitOf(m[3]!);
    if (m[4] || m[5]) continue;
    if ((unit.kind === "tsp" || unit.kind === "tbsp") && lang !== "sv") continue;
    if (unit.kind === "stick" && !/butter|margarine|smör/i.test(text)) continue;
    found.add(unit.name);
  }
  if ([...text.matchAll(DIMENSION)].length) found.add("inches");
  for (const m of text.matchAll(TEMPERATURE)) if (!m[4] && !m[5] && hotEnough(Number(m[1]), m[3]!.replace(/\s+/g, ""))) found.add("°F");
  return [...found];
}
