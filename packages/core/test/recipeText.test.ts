import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { initRecipe, putPastedRecipe, readRecipe, readRecipeText, recipeIngredients, recipeSteps, setImportState, writeSteps } from "../src";

/**
 * A recipe copied from its page and pasted (decision 9). The texts are made up, but laid out as two big
 * sites' pages come out when copied whole: a blog part with "ingredients" in prose before the recipe,
 * scale buttons, a photo credit after each step, a row of tabs, a carousel of other recipes, notes on
 * lines of their own, and questions and reviews after.
 */

const WHOLE_PAGE = `RECIPES
DINNERS
MEATBALL RECIPES
Grandma's Sunday Meatballs
4.8
(2,104)
1,377 Reviews
212 Photos
Jump to Recipe

These meatballs are the ones my grandmother made every Sunday, tender and full of flavor.

Submitted by Someone  Updated on May 2, 2026
SAVE
RATE
Add Photo
212
Prep Time:
20 mins
Cook Time:
25 mins
Total Time:
45 mins
Servings:
6
Jump to Nutrition Facts

Meatball Ingredients

Here's what you'll need for meatballs everyone will ask about again:

· Ground meat: A mix of beef and pork keeps them juicy, but all beef works fine as well, so use what you have.
· Cheese: Grate it yourself; the grated kind in a tub doesn't melt into the meat the same way at all.
· Bread: Day-old bread soaked in milk makes them soft. Fresh bread turns to paste.

What to Serve With Meatballs?

Spaghetti and a simple tomato sauce, or mashed potatoes and lingonberries.

How to Store Meatballs

Keep them in the fridge in a closed container for up to three days.

Community Tips and Praise

"Best meatballs ever," says one reader.

Keep Screen Awake
Ingredients
1/2X
1X
2X

Original recipe (1X) yields 6 servings

1 pound ground beef

½ pound ground pork

1 cup grated parmesan

2 eggs

2 cloves garlic, minced

salt and ground black pepper to taste

2 slices day-old bread

½ cup milk

Directions

Gather all ingredients.

Example Food Studios

Soak the bread in the milk until soft, then squeeze it out.

Example Food Studios

Mix the meat, cheese, eggs, garlic and bread; season with salt and pepper.

Example Food Studios

Roll into balls and brown them in a pan over medium heat, about 10 minutes.

Example Food Studios

Cook’s Note

Wet your hands so the mixture doesn't stick.

Nutrition Facts (per serving)
480
Calories
Reviews (1,377)
Most helpful positive review
These were wonderful and my kids ate every one of them.`;

const TABS_AND_CAROUSEL = `Skip to main content
Recipes
Home
Recipes
Easy chicken traybake
Easy chicken traybake
Some Cook
Save recipe
Serves 4
Easy
Prep:
15 mins
Cook:
1 hr and 5 mins
A star rating of 4.7 out of 5.
812 ratings
Print
Skip to ingredients
Alternatives
Showing items 1 to 3 of 6
Lemon chicken
A star rating of 4.5 out of 5.
120 ratings
Chicken pie
A star rating of 4.6 out of 5.
98 ratings
Lemon chicken
A star rating of 4.5 out of 5.
120 ratings
Chicken pie
A star rating of 4.6 out of 5.
98 ratings
next item
Ingredients
Nutrition
Units:
Metric
US
For the traybake
8 chicken thighs
trimmed
2 red onions
cut into wedges
3 garlic cloves
crushed
500g new potatoes
halved
2 tbsp olive oil
small bunch thyme
To serve
green salad
to serve (optional)
Keep the screen awake with cook mode on the app.
Method
Step 1
Heat the oven to 200C/180C fan.
Step 2
Put everything in a roasting tin, toss with the oil and season.
Step 3
Roast for 1 hr, turning halfway, until golden.
Frequently asked questions
Can I use chicken breasts?
Yes, but cook them for less time so they don't dry out.`;

const SWEDISH_BLOG = `Krämig kycklinggryta
Publicerad 3 mars 2026
En enkel vardagsrätt som hela familjen gillar, och den är klar på en halvtimme.
Tid: 30 min
Ingredienser
4 portioner
600 g kycklingfilé
1 gul lök
2 dl grädde
1 msk soja
Till servering:
ris
Gör så här
1. Skär kycklingen i bitar och bryn den i en panna.
2. Hacka löken och fräs den med kycklingen.
3. Häll på grädde och soja och låt sjuda i tio minuter.
Tips
Byt grädden mot kokosmjölk om du vill.
Kommentarer
Så gott!`;

describe("reading a pasted recipe", () => {
  it("finds the recipe in a whole page: past the blog part, the buttons, the credits and the reviews", () => {
    const r = readRecipeText(WHOLE_PAGE, { source: "https://recipes.example.com/recipe/40399/grandmas-sunday-meatballs/" })!;
    expect(r.title).toBe("Grandma's Sunday Meatballs");
    expect(r.servings).toBe(6);
    expect(r.minutes).toBe(45);
    expect(r.ingredients).toEqual([
      "1 pound ground beef",
      "½ pound ground pork",
      "1 cup grated parmesan",
      "2 eggs",
      "2 cloves garlic, minced",
      "salt and ground black pepper to taste",
      "2 slices day-old bread",
      "½ cup milk",
    ]);
    expect(r.steps).toEqual([
      "Gather all ingredients.",
      "Soak the bread in the milk until soft, then squeeze it out.",
      "Mix the meat, cheese, eggs, garlic and bread; season with salt and pepper.",
      "Roll into balls and brown them in a pan over medium heat, about 10 minutes.",
    ]);
  });

  it("goes by the heading under a row of tabs, not a carousel; joins notes on their own lines; stops at the questions", () => {
    const r = readRecipeText(TABS_AND_CAROUSEL, { source: "https://food.example.com/recipes/easy-chicken-traybake" })!;
    expect(r.title).toBe("Easy chicken traybake");
    expect(r.servings).toBe(4);
    expect(r.minutes).toBe(80);
    expect(r.ingredients).toEqual([
      "For the traybake:",
      "8 chicken thighs, trimmed",
      "2 red onions, cut into wedges",
      "3 garlic cloves, crushed",
      "500g new potatoes, halved",
      "2 tbsp olive oil",
      "small bunch thyme",
      "To serve:",
      "green salad, to serve (optional)",
    ]);
    expect(r.steps).toEqual(["Heat the oven to 200C/180C fan.", "Put everything in a roasting tin, toss with the oil and season.", "Roast for 1 hr, turning halfway, until golden."]);
    // (with no link to go by, the line that talks about what's in the recipe, not "Skip to main content")
    expect(readRecipeText(TABS_AND_CAROUSEL)!.title).toBe("Easy chicken traybake");
  });

  it("reads a Swedish post: the servings under the heading, a part's heading, numbered steps, no tips", () => {
    const r = readRecipeText(SWEDISH_BLOG)!;
    expect(r).toEqual({
      title: "Krämig kycklinggryta",
      servings: 4,
      minutes: 30,
      ingredients: ["600 g kycklingfilé", "1 gul lök", "2 dl grädde", "1 msk soja", "Till servering:", "ris"],
      steps: ["Skär kycklingen i bitar och bryn den i en panna.", "Hacka löken och fräs den med kycklingen.", "Häll på grädde och soja och låt sjuda i tio minuter."],
    });
  });

  it("does without headings: lines with amounts are ingredients, sentences after them steps", () => {
    const r = readRecipeText("Pannkakor\n\n3 ägg\n6 dl mjölk\n2 ½ dl vetemjöl\n½ tsk salt\n\nVispa ihop mjöl, salt och hälften av mjölken.\nVispa i resten av mjölken och äggen.\nStek tunna pannkakor i smör.")!;
    expect(r.title).toBe("Pannkakor");
    expect(r.ingredients).toEqual(["3 ägg", "6 dl mjölk", "2 ½ dl vetemjöl", "½ tsk salt"]);
    expect(r.steps).toEqual(["Vispa ihop mjöl, salt och hälften av mjölken.", "Vispa i resten av mjölken och äggen.", "Stek tunna pannkakor i smör."]);
  });

  it("joins an amount on a line of its own to its ingredient, and takes bullets and step numbers off", () => {
    const r = readRecipeText("Ingredienser\n• 600 g\nkycklingfilé\n• 2\ngula lökar\n▢ 1 msk smör\nInstruktioner\nSteg 1\nStek kycklingen.\n2) Lägg i löken och smöret.")!;
    expect(r.ingredients).toEqual(["600 g kycklingfilé", "2 gula lökar", "1 msk smör"]);
    expect(r.steps).toEqual(["Stek kycklingen.", "Lägg i löken och smöret."]);
  });

  it("finds nothing in text that isn't a recipe", () => {
    expect(readRecipeText("")).toBeNull();
    expect(readRecipeText("Hej! Vi ses på lördag hos mormor.\nTa med något gott.")).toBeNull();
  });
});

describe("putting a pasted recipe in", () => {
  it("takes the place of the ingredients and steps, keeps a title someone wrote, and ends a failed import", () => {
    const doc = new Y.Doc();
    initRecipe(doc, { title: "Mormors köttbullar", source: "https://recipes.example.com/x", ingredients: "gammal rad", steps: "1. Gammalt steg", by: 1, importing: true });
    setImportState(doc, { status: "failed", error: "the page answered 403", reason: "blocked", at: 1 });
    expect(readRecipe(doc).import?.reason).toBe("blocked");

    putPastedRecipe(doc, readRecipeText(SWEDISH_BLOG)!);
    const r = readRecipe(doc);
    expect(r.title).toBe("Mormors köttbullar");
    expect([r.servings, r.minutes]).toEqual([4, 30]);
    expect(recipeIngredients(doc).toString()).toBe("600 g kycklingfilé\n1 gul lök\n2 dl grädde\n1 msk soja\nTill servering:\nris");
    expect(recipeSteps(doc).toString()).toBe("1. Skär kycklingen i bitar och bryn den i en panna.\n2. Hacka löken och fräs den med kycklingen.\n3. Häll på grädde och soja och låt sjuda i tio minuter.");
    expect(r.import?.status).toBe("done");
    expect(r.import?.reason).toBeUndefined();
  });

  it("writes a part of the steps as a heading between them, the numbers going on", () => {
    expect(writeSteps(["Gör degen.", "Till fyllningen:", "Hacka.", "Fyll."])).toBe("1. Gör degen.\n\n**Till fyllningen**\n\n2. Hacka.\n3. Fyll.");
  });
});
