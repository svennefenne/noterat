import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  initRecipe,
  putRecipeTranslation,
  readRecipe,
  recipeIngredients,
  recipeLanguage,
  recipeSteps,
  recipeTexts,
  setTranslateState,
  showRecipeVersion,
  translatedRecipe,
  translationFits,
  translationTexts,
  type RecipeTexts,
} from "../src";

/**
 * Translating a recipe (decision 9): what the model is given, and how its translations are put back.
 * The model is stood in for by a table of what it says (as opus-mt does, mistakes and all).
 */

const SOUP: RecipeTexts = {
  title: "Cowboy Soup",
  description: "",
  ingredients: [
    "1 pound ground beef or sausage",
    "1 large onion, chopped",
    "2 cloves garlic, minced",
    "1 bell pepper (any color), chopped",
    "1 (15-ounce) can kidney beans, rinsed and drained",
    "4 cups beef broth",
    "small bunch thyme",
    "Salt and pepper to taste",
    "To serve:",
    "green salad, to serve (optional)",
  ].join("\n"),
  steps: "1. In a large pot or Dutch oven, brown the ground beef over medium-high heat. Drain off any excess grease.\n\n**For the topping**\n\n2. Add the scallions and simmer for 30 minutes.",
};

const MODEL: Record<string, string> = {
  "minced beef or sausage": "malet nötkött eller korv",
  "any color": "någon färg",
  "In a large saucepan, fry the minced beef on medium-high heat.": "I en stor kastrull steker du det malda nötköttet på medelhög värme.",
  "Drain off any excess grease.": "Dränera bort överflödigt fett.",
  "For the topping": "För toppingen",
  "Add the spring onions and simmer for 30 minutes.": "Tillsätt vårlöken och puttra i 30 minuter.",
};
const model = (texts: string[]) => texts.map((t) => MODEL[t] ?? `?? ${t}`);

describe("which language a recipe is in", () => {
  it("tells English from Swedish by its little words, and says so when it can't", () => {
    expect(recipeLanguage(`${SOUP.ingredients}\n${SOUP.steps}`)).toBe("en");
    expect(recipeLanguage("2 dl grädde\n1 gul lök, hackad\nStek löken i smör och häll på grädden. Låt koka i fem minuter.")).toBe("sv");
    expect(recipeLanguage("Pasta carbonara")).toBeNull();
  });
});

describe("translating a recipe", () => {
  it("gives the model only what the glossary hasn't got, the measures metric and the amounts left out", () => {
    expect(translationTexts(SOUP)).toEqual([
      "minced beef or sausage",
      "any color",
      "In a large saucepan, fry the minced beef on medium-high heat.",
      "Drain off any excess grease.",
      "For the topping",
      "Add the spring onions and simmer for 30 minutes.",
    ]);
  });

  it("puts the translations in their places: units, glossary names and notes in the singular or plural, the steps' numbers and headings", () => {
    const r = translatedRecipe(SOUP, model(translationTexts(SOUP)));
    expect(r.title).toBe("Cowboy Soup");
    expect(r.ingredients.split("\n")).toEqual([
      "450 g nötfärs eller korv",
      "1 lök, hackad",
      "2 klyftor vitlök, finhackade",
      "1 paprika (någon färg), hackad",
      "1 (430 g) burk kidneybönor, sköljda och avrunna",
      "9 ½ dl köttbuljong",
      "1 litet knippe timjan",
      "Salt och peppar efter smak",
      "Till servering:",
      "grönsallad, till servering (valfritt)",
    ]);
    expect(r.steps).toBe(
      "1. I en stor kastrull steker du nötfärsen på medelhög värme. Dränera bort överflödigt fett.\n\n**För toppingen**\n\n2. Tillsätt salladslöken och puttra i 30 minuter.",
    );
  });

  it("knows the minced meats, which the model gets wrong (\"ground veal\" is \"jordnötskött\" to it)", () => {
    const r: RecipeTexts = { title: "", description: "", ingredients: "1 pound ground beef\n½ pound ground veal\n½ pound ground pork\n1 pound ground chuck", steps: "Mix the ground veal with the pork." };
    expect(translationTexts(r)).toEqual(["Mix the minced veal with the pork."]);
    const t = translatedRecipe(r, ["Blanda malet kalvkött med fläsket."]);
    expect(t.ingredients).toBe("450 g nötfärs\n230 g kalvfärs\n230 g fläskfärs\n450 g nötfärs");
    expect(t.steps).toBe("Blanda kalvfärs med fläsket.");
  });

  it("keeps the English where the model made something up, or went on and on; mends its fractions and capitals", () => {
    const r: RecipeTexts = { title: "", description: "", ingredients: "1 aubergine, roasted\n1 tbsp za'atar", steps: "Bake for 1 ½ hours. Serve." };
    expect(translationTexts(r)).toEqual(["roasted", "za'atar", "Bake for 1 ½ hours.", "Serve."]);
    const t = translatedRecipe(r, ["Ordförande", "Europaparlamentets och rådets förordning om skydd för enskilda", "Grädda i 1 1⁄2 timme.", "servera."]);
    expect(t.ingredients).toBe("1 aubergine, roasted\n1 msk za'atar");
    expect(t.steps).toBe("Grädda i 1 ½ timme. Servera.");
  });

  it("leaves a recipe as it was when the model's answer is missing pieces", () => {
    expect(translatedRecipe(SOUP, []).steps).toBe(
      "1. In a large pot or Dutch oven, brown the ground beef over medium-high heat. Drain off any excess grease.\n\n**For the topping**\n\n2. Add the scallions and simmer for 30 minutes.",
    );
  });
});

describe("a recipe's translation in its document", () => {
  const recipe = () => {
    const doc = new Y.Doc();
    initRecipe(doc, { title: "Cowboy Soup", ingredients: SOUP.ingredients, steps: SOUP.steps, by: 1 });
    return doc;
  };

  it("shows the translation, goes back to the words it came with and keeps what someone changed in either", () => {
    const doc = recipe();
    const original = recipeTexts(doc);
    setTranslateState(doc, { status: "queued", at: 1 }, { from: "en", to: "sv" });
    expect(readRecipe(doc).translation).toEqual({ from: "en", to: "sv", shown: null, job: { status: "queued", error: undefined, at: 1 } });

    putRecipeTranslation(doc, { from: "en", to: "sv", original, translated: translatedRecipe(original, model(translationTexts(original))) });
    expect(readRecipe(doc).translation).toMatchObject({ shown: "translated", job: { status: "done" } });
    expect(recipeIngredients(doc).toString()).toContain("2 klyftor vitlök, finhackade");

    // (someone mends the translation; going to the original and back keeps it)
    recipeSteps(doc).insert(recipeSteps(doc).length, " Rör om.");
    expect(showRecipeVersion(doc, "original")).toBe(true);
    expect(recipeTexts(doc)).toEqual(original);
    expect(translationFits(doc)).toBe(true);
    expect(showRecipeVersion(doc, "translated")).toBe(true);
    expect(recipeSteps(doc).toString()).toMatch(/Rör om\.$/);
    expect(showRecipeVersion(doc, "translated")).toBe(false);

    // (the original changed since it was translated: the translation no longer fits it)
    showRecipeVersion(doc, "original");
    recipeIngredients(doc).insert(0, "2 eggs\n");
    expect(translationFits(doc)).toBe(false);
  });

  it("forgets a translation into another language when one is asked for", () => {
    const doc = recipe();
    const original = recipeTexts(doc);
    putRecipeTranslation(doc, { from: "en", to: "sv", original, translated: { ...original, steps: "Koka." } });
    showRecipeVersion(doc, "original");
    setTranslateState(doc, { status: "queued", at: 2 }, { from: "sv", to: "en" });
    expect(readRecipe(doc).translation).toMatchObject({ from: "sv", to: "en", shown: "original" });
    expect(translationFits(doc)).toBe(false);
  });
});
