import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addRecipePhoto,
  cleanUrl,
  doneChoosing,
  initRecipe,
  putImportedRecipe,
  readDuration,
  readIngredient,
  readRecipe,
  readSchemaRecipe,
  readServings,
  recipeIngredients,
  recipeSteps,
  removeRecipePhoto,
  scaleLine,
  searchable,
  writeNumber,
} from "../src";

describe("an ingredient line", () => {
  it("is read with its amount", () => {
    expect(readIngredient("1 1/2 dl mjölk")).toMatchObject({ amount: 1.5, rest: "dl mjölk" });
    expect(readIngredient("½ tsk salt")).toMatchObject({ amount: 0.5, rest: "tsk salt" });
    expect(readIngredient("2–3 morötter")).toMatchObject({ amount: 2, upTo: 3, rest: "morötter" });
    expect(readIngredient("1,5 kg potatis")).toMatchObject({ amount: 1.5 });
    expect(readIngredient("500g blandfärs")).toMatchObject({ amount: 500, rest: "g blandfärs" });
    expect(readIngredient("Salt och peppar")).toMatchObject({ amount: null, rest: "Salt och peppar" });
  });

  it("is scaled and written as a recipe would", () => {
    expect(scaleLine("1 1/2 dl mjölk", 2)).toBe("3 dl mjölk");
    expect(scaleLine("½ tsk salt", 0.5)).toBe("¼ tsk salt");
    expect(scaleLine("2–3 morötter", 2)).toBe("4–6 morötter");
    expect(scaleLine("1 ägg", 1.5)).toBe("1 ½ ägg");
    expect(scaleLine("500 g blandfärs", 1.5)).toBe("750 g blandfärs");
    expect(scaleLine("ca 2 dl grädde", 0.5)).toBe("ca 1 dl grädde");
    expect(scaleLine("Salt", 3)).toBe("Salt");
    expect(writeNumber(0.4)).toBe("0,4");
    expect(writeNumber(466.67)).toBe("467");
  });

  it("servings and times are read from what pages say", () => {
    expect(readServings("4 portioner")).toBe(4);
    expect(readServings("4-6 servings")).toBe(4);
    expect(readServings(null)).toBeNull();
    expect(readDuration("PT1H30M")).toBe(90);
    expect(readDuration("PT45M")).toBe(45);
    expect(readDuration("")).toBeNull();
  });
});

const PAGE = `<html><head><title>x</title>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Sida"},
{"@type":["Recipe"],"name":"Köttbullar med gr&auml;ddsås","recipeYield":["4 portioner"],"totalTime":"PT45M",
"image":{"@type":"ImageObject","url":"/bilder/kottbullar.jpg"},"description":"Klassiska.",
"recipeIngredient":["500 g blandfärs","1 dl ströbröd","1 ägg","2 dl mjölk"],
"recipeInstructions":[{"@type":"HowToSection","name":"Bullar","itemListElement":[{"@type":"HowToStep","text":"Blanda allt."},{"@type":"HowToStep","text":"Rulla bullar."}]},{"@type":"HowToStep","text":"Stek i smör."}]}]}
</script></head><body></body></html>`;

describe("a page's schema.org recipe", () => {
  it("is found in its JSON-LD, sections and all", () => {
    expect(readSchemaRecipe(PAGE, "https://example.se/recept/kottbullar")).toEqual({
      title: "Köttbullar med gräddsås",
      ingredients: ["500 g blandfärs", "1 dl ströbröd", "1 ägg", "2 dl mjölk"],
      steps: ["Blanda allt.", "Rulla bullar.", "Stek i smör."],
      servings: 4,
      minutes: 45,
      description: "Klassiska.",
      image: "https://example.se/bilder/kottbullar.jpg",
    });
    expect(readSchemaRecipe("<html><script type='application/ld+json'>{bad json</script></html>", "https://x.se")).toBeNull();
    // (Arla writes the + as an entity)
    expect(readSchemaRecipe(PAGE.replace("application/ld+json", "application/ld&#x2B;json"), "https://x.se")?.title).toBe("Köttbullar med gräddsås");
  });

  it("goes into a recipe, without overwriting what someone wrote", () => {
    const doc = new Y.Doc();
    initRecipe(doc, { source: "https://example.se/recept/kottbullar", steps: "Mitt eget sätt.", by: 1, importing: true });
    expect(readRecipe(doc).import?.status).toBe("wanted");
    putImportedRecipe(doc, readSchemaRecipe(PAGE, "https://example.se/")!, { hash: "a".repeat(64), type: "image/jpeg", size: 1, width: 1, height: 1 });
    const r = readRecipe(doc);
    expect(r).toMatchObject({ title: "Köttbullar med gräddsås", servings: 4, minutes: 45, import: { status: "done" } });
    expect(r.photos).toHaveLength(1);
    expect(recipeIngredients(doc).toString()).toBe("500 g blandfärs\n1 dl ströbröd\n1 ägg\n2 dl mjölk");
    expect(recipeSteps(doc).toString()).toBe("Mitt eget sätt.");
    expect(searchable("recipe", "r", doc).text).toContain("ströbröd");
  });

  it("a guess comes with the pictures to choose from, until the choosing's done", () => {
    const doc = new Y.Doc();
    initRecipe(doc, { source: "https://blogg.example.se/bullar", by: 1, importing: true });
    const pic = (c: string) => ({ hash: c.repeat(64), type: "image/jpeg", size: 5000, width: 0, height: 0 });
    putImportedRecipe(doc, { title: "Bullar", ingredients: ["5 dl mjöl", "2 dl mjölk"], guessed: true }, pic("a"), [pic("a"), pic("b"), pic("c")]);
    let r = readRecipe(doc);
    expect(r.guessed).toBe(true);
    expect(r.photoChoices.map((p) => p.hash[0])).toEqual(["a", "b", "c"]);
    expect(r.photos.map((p) => p.hash[0])).toEqual(["a"]);
    doneChoosing(doc);
    r = readRecipe(doc);
    expect(r).toMatchObject({ guessed: false, photoChoices: [] });
    expect(r.photos).toHaveLength(1);

    // fetched again, with another chosen: the guess isn't put back
    removeRecipePhoto(doc, "a".repeat(64));
    addRecipePhoto(doc, pic("b"));
    putImportedRecipe(doc, { title: "Bullar", guessed: true }, pic("a"), [pic("a"), pic("b"), pic("c")]);
    expect(readRecipe(doc).photos.map((p) => p.hash[0])).toEqual(["b"]);
    doneChoosing(doc);

    // a single picture is no choice; and fetched again from a page with a recipe, it's no guess
    putImportedRecipe(doc, { title: "Bullar", guessed: true }, pic("d"), [pic("d")]);
    expect(readRecipe(doc).photoChoices).toEqual([]);
    putImportedRecipe(doc, { title: "Bullar" });
    expect(readRecipe(doc).guessed).toBe(false);
  });

  it("links are made whole, or turned down", () => {
    expect(cleanUrl("www.ica.se/recept/x")).toBe("https://www.ica.se/recept/x");
    expect(cleanUrl("ftp://x.se")).toBeNull();
    expect(cleanUrl("hej")).toBeNull();
  });
});
