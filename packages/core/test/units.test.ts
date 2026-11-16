import { describe, expect, it } from "vitest";
import { foreignMeasures, scaleLine, toMetric } from "../src";

describe("American measures in metric ones", () => {
  it("turns a recipe's lines into dl, msk, tsk, g and kg", () => {
    const lines: [string, string][] = [
      ["1 pound ground beef or sausage", "450 g ground beef or sausage"],
      ["1 (15-ounce) can kidney beans, rinsed and drained", "1 (430 g) can kidney beans, rinsed and drained"],
      ["1 (14.5-ounce) can diced tomatoes, undrained", "1 (410 g) can diced tomatoes, undrained"],
      ["4 cups beef broth", "9 ½ dl beef broth"],
      ["1 cup milk", "2,4 dl milk"],
      ["1/2 cup sugar", "1,2 dl sugar"],
      ["1/3 cup oil", "¾ dl oil"],
      ["1/4 cup cream", "½ dl cream"],
      ["2 tablespoons olive oil", "2 msk olive oil"],
      ["1 1/2 teaspoons salt", "1 ½ tsk salt"],
      ["1 tbsp. butter", "1 msk butter"],
      ["8 oz. cream cheese, softened", "230 g cream cheese, softened"],
      ["3 lbs potatoes", "1,4 kg potatoes"],
      ["6 cups water", "1,4 l water"],
      ["2-3 cups flour", "4 ½–7 dl flour"],
      ["1 stick butter, melted", "110 g butter, melted"],
      ["1 packet taco seasoning", "1 packet taco seasoning"],
      ["Salt and pepper to taste", "Salt and pepper to taste"],
      ["2 cupcakes", "2 cupcakes"],
      ["500 g blandfärs", "500 g blandfärs"],
    ];
    for (const [line, metric] of lines) expect(toMetric(line)).toBe(metric);
  });

  it("keeps the recipe's own metric measure where it gives one", () => {
    expect(toMetric("1 cup (240 ml) milk")).toBe("240 ml milk");
    expect(toMetric("240 ml (1 cup) milk")).toBe("240 ml milk");
    expect(toMetric("Preheat the oven to 350°F (175°C).")).toBe("Preheat the oven to 175°C.");
    expect(toMetric("Bake at 400°F/200°C.")).toBe("Bake at 200°C.");
  });

  it("does temperatures and sizes in the method", () => {
    expect(toMetric("Preheat the oven to 350°F and grease a 9x13-inch pan.")).toBe("Preheat the oven to 175 °C and grease a 23 x 33 cm pan.");
    expect(toMetric("Bake at 375 F for 20 minutes.")).toBe("Bake at 190 °C for 20 minutes.");
    expect(toMetric("Heat to 425 degrees.")).toBe("Heat to 220 °C.");
    // (not hot enough to be Fahrenheit, said without the F)
    expect(toMetric("Bake at 200 degrees.")).toBe("Bake at 200 degrees.");
    expect(toMetric("Cut into 1-inch pieces.")).toBe("Cut into 2,5 cm pieces.");
    expect(toMetric("Simmer about 5-7 minutes. Step 2 F")).toBe("Simmer about 5-7 minutes. Step 2 F");
  });

  it("says the spoons in English to someone reading English, and converts the rest", () => {
    expect(toMetric("2 tablespoons olive oil", "en")).toBe("2 tablespoons olive oil");
    expect(toMetric("1 cup milk", "en")).toBe("2.4 dl milk");
    expect(toMetric("3 lbs potatoes", "en")).toBe("1.4 kg potatoes");
  });

  it("finds the measures there are to convert", () => {
    expect(foreignMeasures("4 cups beef broth\n1 (15-ounce) can corn\n1 pound beef\nBake at 350°F.")).toEqual(["cups", "ounces", "pounds", "°F"]);
    expect(foreignMeasures("2 tbsp oil")).toEqual(["tablespoons"]);
    expect(foreignMeasures("2 tbsp oil", "en")).toEqual([]);
    expect(foreignMeasures("3 dl mjölk\n500 g färs\n1 cup (240 ml) milk\nUgn 200 grader")).toEqual([]);
  });

  it("goes after scaling", () => {
    expect(toMetric(scaleLine("1 1/2 cups milk", 2))).toBe("7 dl milk");
  });
});
