import { NUM, readNumber } from "./ingredients";
import { toMetric } from "./units";

/**
 * Translating a recipe (decision 9). The worker's model (opus-mt, English to Swedish) translates text
 * well enough in sentences, but an ingredient on its own is often too little for it to go on: "heavy
 * cream" comes back "tung grädde", "cloves garlic" "kryddnejlikor vitlök", and a word it doesn't know
 * can come back as something from the EU texts it learnt from. So this decides what the model is given:
 *
 * - the measures in metric ones first (units.ts), as a Swedish recipe has them;
 * - an ingredient line's amount and unit are kept out of it ("2 cloves" is "2 klyftor" here), its name
 *   comes from a glossary of common ingredients when it's there, and its notes ("minced", "rinsed and
 *   drained") from a list of their own, in the singular or the plural as the line goes;
 * - what's left, and the method and the description, go to the model sentence by sentence, with a few English
 *   words it gets wrong put in words it gets right ("heavy cream" as "whipping cream"), and a few of its
 *   habits mended after ("vårlök" is "salladslök");
 * - a translation that looks like none (much longer than what it was given, or the EU's words) is let
 *   go of, and the English kept;
 * - the title stays as it is: a dish's name is where the model goes most wrong.
 *
 * The same walk over the recipe says what the model is to translate (translationTexts) and puts its
 * translations in their places (translatedRecipe), so the two always agree on what's where.
 */

export type RecipeLanguage = "sv" | "en";

/** What a translation takes the place of. */
export interface RecipeTexts {
  title: string;
  description: string;
  ingredients: string;
  steps: string;
}

/** What can be translated into what: English into Swedish (the one model the worker has). */
export const TRANSLATIONS: readonly (readonly [RecipeLanguage, RecipeLanguage])[] = [["en", "sv"]];
export const canTranslate = (from: RecipeLanguage, to: RecipeLanguage) => TRANSLATIONS.some(([f, t]) => f === from && t === to);

// ── which language a recipe is in ──

const ENGLISH = new Set(
  "the and of to a an in with for until into or add stir minutes minute heat oven bake cook pan pot bowl large small medium cup cups tablespoon tablespoons teaspoon teaspoons chopped about over then from let aside each is it on at until while remove place serve divided taste".split(
    " ",
  ),
);
const SWEDISH = new Set(
  "och i med till på en ett att av som tills eller tillsätt rör minuter värm ugn ugnen grädda koka stek panna pannan skål stor liten dl msk tsk krm hackad hackade låt sedan från ställ åt varje det är lägg häll blanda servera smaka".split(
    " ",
  ),
);

/** The language a recipe is written in, by its little words: English, Swedish, or null when it can't be told. */
export function recipeLanguage(text: string): RecipeLanguage | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  let en = 0;
  let sv = 0;
  for (const w of words) {
    if (ENGLISH.has(w)) en++;
    if (SWEDISH.has(w) || /[åäö]/.test(w)) sv++;
  }
  if (en + sv < 4) return null;
  if (en >= 2 * sv + 2) return "en";
  if (sv >= 2 * en + 2) return "sv";
  return null;
}

// ── the glossary ──

/** Ingredients by their English names (as a recipe writes them), in Swedish. */
const NAMES: Record<string, string> = {};
const names = (sv: string, ...en: string[]) => {
  for (const e of en) NAMES[e] = sv;
};
// eggs and dairy
names("ägg", "egg", "eggs", "large egg", "large eggs");
names("äggula", "egg yolk", "large egg yolk");
names("äggulor", "egg yolks", "large egg yolks");
names("äggvita", "egg white", "large egg white");
names("äggvitor", "egg whites", "large egg whites");
names("smör", "butter");
names("osaltat smör", "unsalted butter");
names("saltat smör", "salted butter");
names("mjölk", "milk", "whole milk");
names("vispgrädde", "heavy cream", "heavy whipping cream", "whipping cream", "double cream", "cream");
names("matlagningsgrädde", "light cream", "single cream");
names("kaffegrädde", "half-and-half", "half and half");
names("gräddfil", "sour cream");
names("crème fraiche", "crème fraîche", "creme fraiche");
names("färskost", "cream cheese");
names("kärnmjölk", "buttermilk");
names("naturell yoghurt", "plain yogurt", "plain yoghurt", "natural yogurt", "natural yoghurt");
names("grekisk yoghurt", "greek yogurt", "greek yoghurt", "plain greek yogurt");
names("parmesan", "parmesan", "parmesan cheese", "parmigiano-reggiano", "parmigiano reggiano");
names("riven parmesan", "grated parmesan", "grated parmesan cheese", "freshly grated parmesan", "freshly grated parmesan cheese", "shredded parmesan");
names("cheddarost", "cheddar", "cheddar cheese", "sharp cheddar", "sharp cheddar cheese");
names("riven cheddarost", "grated cheddar", "grated cheddar cheese", "shredded cheddar", "shredded cheddar cheese", "shredded sharp cheddar cheese");
names("mozzarella", "mozzarella", "mozzarella cheese", "fresh mozzarella");
names("riven mozzarella", "shredded mozzarella", "shredded mozzarella cheese", "grated mozzarella");
names("fetaost", "feta", "feta cheese", "crumbled feta", "crumbled feta cheese");
// flour, sugar and baking
names("vetemjöl", "flour", "all-purpose flour", "all purpose flour", "plain flour");
names("vetemjöl special", "bread flour", "strong white flour");
names("strösocker", "sugar", "white sugar", "granulated sugar", "caster sugar", "superfine sugar");
names("farinsocker", "brown sugar", "light brown sugar", "packed brown sugar", "packed light brown sugar");
names("mörkt farinsocker", "dark brown sugar", "packed dark brown sugar");
names("florsocker", "powdered sugar", "confectioners' sugar", "confectioners sugar", "icing sugar");
names("bikarbonat", "baking soda", "bicarbonate of soda");
names("bakpulver", "baking powder");
names("vaniljextrakt", "vanilla extract", "pure vanilla extract", "vanilla essence", "vanilla");
names("majsstärkelse", "cornstarch", "corn starch", "cornflour");
names("honung", "honey");
names("lönnsirap", "maple syrup", "pure maple syrup");
names("kakao", "cocoa powder", "unsweetened cocoa powder", "cocoa");
names("chokladbitar", "chocolate chips", "semisweet chocolate chips", "semi-sweet chocolate chips", "dark chocolate chips");
names("torrjäst", "yeast", "active dry yeast", "instant yeast", "dry yeast");
names("havregryn", "rolled oats", "oats", "old-fashioned oats");
// salt and spices
names("salt", "salt", "table salt", "fine salt");
names("flingsalt", "kosher salt", "flaky salt", "flaky sea salt", "sea salt flakes");
names("havssalt", "sea salt");
names("svartpeppar", "black pepper", "ground black pepper", "pepper");
names("nymalen svartpeppar", "freshly ground black pepper", "freshly ground pepper");
names("salt och peppar", "salt and pepper", "salt & pepper", "kosher salt and pepper");
names("salt och svartpeppar", "salt and black pepper", "salt and ground black pepper", "salt and freshly ground black pepper", "kosher salt and freshly ground black pepper");
names("tacokrydda", "taco seasoning", "taco seasoning mix");
names("chilipulver", "chili powder", "chilli powder");
names("paprikapulver", "paprika", "ground paprika", "sweet paprika");
names("rökt paprikapulver", "smoked paprika");
names("spiskummin", "cumin", "ground cumin");
names("kanel", "cinnamon", "ground cinnamon");
names("muskotnöt", "nutmeg", "ground nutmeg");
names("chiliflakes", "red pepper flakes", "crushed red pepper", "crushed red pepper flakes", "chilli flakes", "chili flakes");
names("cayennepeppar", "cayenne", "cayenne pepper");
names("vitlökspulver", "garlic powder");
names("lökpulver", "onion powder");
names("torkad oregano", "dried oregano");
names("torkad timjan", "dried thyme");
names("torkad basilika", "dried basil");
names("lagerblad", "bay leaf", "bay leaves", "dried bay leaf", "dried bay leaves");
names("ingefära", "ginger", "fresh ginger");
names("koriander", "cilantro", "fresh cilantro", "coriander", "fresh coriander");
names("hackad koriander", "chopped cilantro", "chopped fresh cilantro", "chopped coriander", "chopped fresh coriander");
names("persilja", "parsley", "fresh parsley", "flat-leaf parsley", "italian parsley");
names("hackad persilja", "chopped fresh parsley", "chopped parsley", "chopped flat-leaf parsley");
names("basilika", "basil", "fresh basil", "fresh basil leaves", "basil leaves");
names("timjan", "thyme", "fresh thyme", "thyme sprigs");
names("rosmarin", "rosemary", "fresh rosemary");
names("dill", "dill", "fresh dill");
names("gräslök", "chives", "fresh chives");
names("mynta", "mint", "fresh mint", "mint leaves");
// meat and fish
names("nötfärs", "ground beef", "lean ground beef", "extra-lean ground beef", "minced beef", "beef mince", "ground chuck", "ground sirloin", "ground round");
names("fläskfärs", "ground pork", "minced pork", "pork mince");
names("kalkonfärs", "ground turkey", "turkey mince");
names("kycklingfärs", "ground chicken", "chicken mince");
names("lammfärs", "ground lamb", "lamb mince");
names("köttfärs", "ground meat", "minced meat");
// ("ground veal" is "jordnötskött" to the model: ground as in the earth's, and then some)
names("kalvfärs", "ground veal", "minced veal", "veal mince");
names("viltfärs", "ground venison", "minced venison", "venison mince");
names("bisonfärs", "ground bison", "minced bison");
names("salsiccia", "italian sausage", "ground italian sausage", "bulk italian sausage", "italian sausage, casings removed");
names("kycklingfilé", "chicken breast", "boneless skinless chicken breast", "boneless, skinless chicken breast");
names("kycklingfiléer", "chicken breasts", "boneless skinless chicken breasts", "boneless, skinless chicken breasts");
names("kycklinglår", "chicken thigh", "chicken thighs", "bone-in chicken thighs");
names("kycklinglårfilé", "boneless skinless chicken thigh", "boneless, skinless chicken thigh");
names("kycklinglårfiléer", "boneless skinless chicken thighs", "boneless, skinless chicken thighs");
names("bacon", "bacon", "streaky bacon");
names("lax", "salmon", "salmon fillet");
names("laxfiléer", "salmon fillets");
names("räkor", "shrimp", "prawns", "large shrimp");
// vegetables, fruit and the rest
names("lök", "onion", "large onion", "medium onion", "small onion");
names("lökar", "onions", "large onions", "medium onions", "small onions");
names("gul lök", "yellow onion", "large yellow onion", "medium yellow onion", "brown onion");
names("gula lökar", "yellow onions", "brown onions");
names("rödlök", "red onion", "large red onion", "medium red onion", "small red onion");
names("rödlökar", "red onions");
names("vitlök", "garlic", "fresh garlic");
names("vitlöksklyfta", "garlic clove", "clove garlic", "clove of garlic");
names("vitlöksklyftor", "garlic cloves", "cloves garlic", "cloves of garlic");
names("salladslök", "green onion", "scallion", "spring onion");
names("salladslökar", "green onions", "scallions", "spring onions");
names("schalottenlök", "shallot", "shallots");
names("morot", "carrot", "large carrot", "medium carrot");
names("morötter", "carrots", "large carrots", "medium carrots");
names("blekselleri", "celery");
names("selleristjälk", "celery stalk", "stalk celery", "celery rib", "rib celery");
names("selleristjälkar", "celery stalks", "stalks celery", "celery ribs", "ribs celery");
names("potatis", "potato", "potatoes", "large potato", "large potatoes", "medium potatoes");
names("sötpotatis", "sweet potato", "sweet potatoes");
names("tomat", "tomato");
names("tomater", "tomatoes");
names("körsbärstomater", "cherry tomatoes", "grape tomatoes");
names("tärnade tomater", "diced tomatoes", "canned diced tomatoes", "chopped tomatoes");
names("krossade tomater", "crushed tomatoes", "canned crushed tomatoes");
names("tomatpuré", "tomato paste", "tomato purée", "tomato puree");
names("passerade tomater", "tomato sauce", "passata");
names("paprika", "bell pepper", "red bell pepper", "green bell pepper", "yellow bell pepper", "red pepper", "green pepper", "yellow pepper");
names("paprikor", "bell peppers", "red bell peppers", "green bell peppers", "red peppers", "green peppers", "peppers");
names("jalapeño", "jalapeño", "jalapeno", "jalapeño pepper", "jalapeno pepper");
names("zucchini", "zucchini", "courgette", "courgettes", "zucchinis");
names("aubergine", "eggplant", "aubergine");
names("auberginer", "eggplants", "aubergines");
names("champinjoner", "mushrooms", "button mushrooms", "white mushrooms", "sliced mushrooms", "cremini mushrooms");
names("spenat", "spinach", "fresh spinach");
names("babyspenat", "baby spinach");
names("gurka", "cucumber");
names("grönsallad", "green salad", "mixed salad", "side salad", "mixed greens");
names("avokado", "avocado", "ripe avocado");
names("avokador", "avocados", "ripe avocados");
names("citron", "lemon");
names("citroner", "lemons");
names("lime", "lime", "limes");
names("citronsaft", "lemon juice", "fresh lemon juice", "freshly squeezed lemon juice");
names("limesaft", "lime juice", "fresh lime juice");
names("rivet citronskal", "lemon zest");
names("rivet limeskal", "lime zest");
names("kidneybönor", "kidney beans", "red kidney beans");
names("svarta bönor", "black beans");
names("vita bönor", "white beans", "cannellini beans");
names("kikärter", "chickpeas", "garbanzo beans");
names("linser", "lentils", "red lentils");
names("majs", "corn", "sweetcorn", "sweet corn", "corn kernels", "whole kernel corn", "frozen corn");
names("gröna ärter", "peas", "frozen peas", "green peas");
names("ris", "rice", "long-grain rice", "long grain rice", "white rice");
names("basmatiris", "basmati rice");
names("jasminris", "jasmine rice");
names("pasta", "pasta");
names("spaghetti", "spaghetti");
names("nudlar", "noodles", "egg noodles");
names("olivolja", "olive oil", "extra-virgin olive oil", "extra virgin olive oil");
names("rapsolja", "vegetable oil", "canola oil", "rapeseed oil", "neutral oil", "cooking oil");
names("sesamolja", "sesame oil", "toasted sesame oil");
names("köttbuljong", "beef broth", "beef stock", "low-sodium beef broth");
names("kycklingbuljong", "chicken broth", "chicken stock", "low-sodium chicken broth");
names("grönsaksbuljong", "vegetable broth", "vegetable stock", "low-sodium vegetable broth");
names("soja", "soy sauce", "low-sodium soy sauce");
names("worcestershiresås", "worcestershire sauce");
names("fisksås", "fish sauce");
names("dijonsenap", "dijon mustard");
names("senap", "mustard", "yellow mustard");
names("majonnäs", "mayonnaise", "mayo");
names("ketchup", "ketchup");
names("vitvinsvinäger", "white wine vinegar");
names("rödvinsvinäger", "red wine vinegar");
names("äppelcidervinäger", "apple cider vinegar", "cider vinegar");
names("balsamvinäger", "balsamic vinegar");
names("vitt vin", "white wine", "dry white wine");
names("rött vin", "red wine", "dry red wine");
names("vatten", "water");
names("kallt vatten", "cold water");
names("ljummet vatten", "warm water", "lukewarm water");
names("ströbröd", "breadcrumbs", "bread crumbs", "dry bread crumbs", "dried breadcrumbs");
names("pankoströbröd", "panko", "panko breadcrumbs", "panko bread crumbs");
names("smördeg", "puff pastry");
names("bröd", "bread");
names("dagsgammalt bröd", "day-old bread", "stale bread");

/** An ingredient's notes, in the singular and the plural ("1 lök, hackad", "2 lökar, hackade"). */
const NOTES: Record<string, readonly [string, string]> = {};
const notes = (one: string, many: string, ...en: string[]) => {
  for (const e of en) NOTES[e] = [one, many];
};
notes("hackad", "hackade", "chopped", "diced small");
notes("finhackad", "finhackade", "finely chopped", "minced", "finely diced");
notes("grovhackad", "grovhackade", "roughly chopped", "coarsely chopped");
notes("tärnad", "tärnade", "diced", "cubed");
notes("skivad", "skivade", "sliced");
notes("tunt skivad", "tunt skivade", "thinly sliced", "finely sliced");
notes("riven", "rivna", "grated", "shredded");
notes("finriven", "finrivna", "finely grated");
notes("pressad", "pressade", "crushed", "pressed");
notes("skalad", "skalade", "peeled");
notes("halverad", "halverade", "halved");
notes("i kvartar", "i kvartar", "quartered");
notes("smält", "smälta", "melted", "melted and cooled", "melted and slightly cooled");
notes("i rumstemperatur", "i rumstemperatur", "softened", "at room temperature", "room temperature", "softened to room temperature");
notes("uppvispat", "uppvispade", "beaten", "lightly beaten", "whisked");
notes("avrunnen", "avrunna", "drained");
notes("sköljd", "sköljda", "rinsed");
notes("sköljd och avrunnen", "sköljda och avrunna", "rinsed and drained", "drained and rinsed");
notes("med spadet", "med spadet", "undrained", "with juices", "with their juices");
notes("putsad", "putsade", "trimmed");
notes("urkärnad", "urkärnade", "seeded", "deseeded", "seeds removed");
notes("kokt", "kokta", "cooked");
notes("okokt", "okokta", "uncooked");
notes("kall", "kalla", "cold", "chilled");
notes("fryst", "frysta", "frozen");
notes("tinad", "tinade", "thawed", "thawed if frozen");
notes("siktat", "siktat", "sifted");
notes("packat", "packat", "packed", "firmly packed", "lightly packed");
notes("delat", "delat", "divided");
notes("efter smak", "efter smak", "to taste", "or to taste", "plus more to taste", "more to taste");
notes("valfritt", "valfritt", "optional");
notes("till servering", "till servering", "for serving", "to serve");
notes("till servering (valfritt)", "till servering (valfritt)", "for serving (optional)", "to serve (optional)", "optional, for serving");
notes("till garnering", "till garnering", "for garnish", "to garnish", "for garnishing");
notes("till stekning", "till stekning", "for frying", "for cooking");
notes("till formen", "till formen", "for greasing", "for the pan");
notes("i klyftor", "i klyftor", "cut into wedges");
notes("i bitar", "i bitar", "cut into chunks", "cut into pieces", "cut into bite-sized pieces", "cut into bite-size pieces", "chopped into chunks");
notes("i tärningar", "i tärningar", "cut into cubes", "cut into 1-inch cubes", "cut into small cubes");
notes("i strimlor", "i strimlor", "cut into strips", "cut into thin strips");
notes("i ringar", "i ringar", "cut into rings", "sliced into rings");
notes("i skivor", "i skivor", "cut into slices");

/** Headings of an ingredient list the model gets wrong ("To serve" is "Att tjäna"). */
const HEADINGS: Record<string, string> = {
  "to serve": "Till servering",
  "for serving": "Till servering",
  "to garnish": "Till garnering",
  "for garnish": "Till garnering",
  garnish: "Garnering",
  optional: "Valfritt",
  "optional toppings": "Valfria tillbehör",
  toppings: "Tillbehör",
  "for the topping": "Till toppingen",
};

/** Units a line's amount comes with, in Swedish (the metric ones stay as they are). */
const COUNT_UNITS: [RegExp, string, string][] = [
  [/^cloves?$/i, "klyfta", "klyftor"],
  [/^slices?$/i, "skiva", "skivor"],
  [/^(?:cans?|tins?|jars?)$/i, "burk", "burkar"],
  [/^(?:packages?|packets?|pkgs?\.?|packs?|envelopes?)$/i, "paket", "paket"],
  [/^pinch(?:es)?$/i, "nypa", "nypor"],
  [/^dash(?:es)?$/i, "skvätt", "skvättar"],
  [/^bunch(?:es)?$/i, "knippe", "knippen"],
  [/^handfuls?$/i, "näve", "nävar"],
  [/^sprigs?$/i, "kvist", "kvistar"],
  [/^heads?$/i, "huvud", "huvuden"],
  [/^(?:stalks?|ribs?)$/i, "stjälk", "stjälkar"],
  [/^pieces?$/i, "bit", "bitar"],
  [/^bottles?$/i, "flaska", "flaskor"],
  [/^bags?$/i, "påse", "påsar"],
  [/^sheets?$/i, "platta", "plattor"],
  [/^drops?$/i, "droppe", "droppar"],
];
/** "small bunch thyme", "a pinch of salt": how much, without an amount (and whether it's an ett-word). */
const SOME = /^(?:(?:a|one)\s+)?(small\s+|large\s+|big\s+)?(bunch|handful|pinch|sprig|dash|knob|splash)\s+(?:of\s+)?(?=\S)/i;
const SOME_WORDS: Record<string, [boolean, string]> = {
  bunch: [true, "knippe"],
  handful: [false, "näve"],
  pinch: [false, "nypa"],
  sprig: [false, "kvist"],
  dash: [false, "skvätt"],
  knob: [false, "klick"],
  splash: [false, "skvätt"],
};
const METRIC_UNIT = /^(?:g|kg|hg|mg|ml|cl|dl|l|msk|tsk|krm|st|cm|mm)\.?$/i;

/** English the model gets wrong, put as it gets it right (in the method and in names not in the glossary). */
const BEFORE: [RegExp, string][] = [
  [/\bheavy (?:whipping )?cream\b/gi, "whipping cream"],
  [/\bdouble cream\b/gi, "whipping cream"],
  [/\b(?:scallions?|green onions?)\b/gi, "spring onions"],
  [/\bcilantro\b/gi, "coriander"],
  [/\bground (?:chuck|sirloin|round)\b/gi, "minced beef"],
  [/\bground (beef|pork|lamb|turkey|chicken|veal|venison|bison|meat)\b/gi, "minced $1"],
  [/\bcloves? (?:of )?garlic\b/gi, "garlic cloves"],
  [/\bbaking soda\b/gi, "bicarbonate"],
  [/\b(?:powdered|confectioners'?) sugar\b/gi, "icing sugar"],
  [/\ball[- ]purpose flour\b/gi, "flour"],
  // ("a large pot or Dutch oven" is one pot, not "kastrull eller saucepan")
  [/\s+or (?:a )?Dutch oven\b/gi, ""],
  [/\bDutch oven or (?:a )?/gi, ""],
  [/\b(?:Dutch oven|stockpot|soup pot|pot)\b/g, "saucepan"],
  [/\bbell peppers\b/gi, "peppers"],
  [/\bbell pepper\b/gi, "sweet pepper"],
  [/\b(?:roasting tin|roasting pan|baking dish|ovenproof dish|baking tray|sheet pan)\b/gi, "oven dish"],
  [/\broll (?:the mixture |them |it )?into balls\b/gi, "shape into balls"],
  [/\btoss\b/gi, "mix"],
  [/\beasy\b/gi, "simple"],
  [/\b(\d{2,3}) ?°? ?C ?\/ ?(\d{2,3}) ?°? ?C fan(?: ?\/ ?gas(?: mark)? \d+)?/gi, "$1 °C ($2 °C fan)"],
  // ("and season." alone is "and säsongen")
  [/\b(and |then )season(?=[.;]|$)/gi, "$1season with salt and pepper"],
  // ("brown the meat" is to fry it; the model leaves "Brown" as it is)
  [/\bbrown (the|it|them|both|all|on)\b/gi, "fry $1"],
  [/\bover (low|medium|medium-low|medium-high|high) heat\b/gi, "on $1 heat"],
];

/** The model's habits, mended. */
const AFTER: [RegExp, string][] = [
  [/\bvårlök(ar|en|arna)?\b/g, "salladslök$1"],
  [/\b(?:kryddnejlikor|nejlikor) (?:av )?vitlök\b/gi, "vitlöksklyftor"],
  [/\bmalet nötkött\b/gi, "nötfärs"],
  [/\bdet malda nötköttet\b/gi, "nötfärsen"],
  [/\bmalet fläsk(?:kött)?\b/gi, "fläskfärs"],
  [/\bdet malda fläsk(?:köttet|et)\b/gi, "fläskfärsen"],
  [/\bmalet kalvkött\b|\bjordnötskött\b/gi, "kalvfärs"],
  [/\bmalet lamm(?:kött)?\b/gi, "lammfärs"],
  [/\bmald kalkon\b/gi, "kalkonfärs"],
  [/\bmald kyckling\b/gi, "kycklingfärs"],
  [/\bmalet vilt(?:kött)?\b/gi, "viltfärs"],
  [/\böver (?:en )?(låg|medel|medelhög|hög|svag|stark) ?värme\b/gi, "på $1värme"],
  [/\b[Ll]aga mat\b/g, "tillaga"],
  [/\bIsbildningssocker\b|\bglasyrsocker\b/gi, "florsocker"],
  [/\bbikarbonat av soda\b/gi, "bikarbonat"],
  [/\bsöt(?:peppar|paprika)\b/gi, "paprika"],
  [/\bnjurbön(or|orna)\b/gi, "kidneybön$1"],
  [/\btaco ?krydd(a|an)\b/gi, "tacokrydd$1"],
  [/\bnötkött ?buljong(en)?\b/gi, "köttbuljong$1"],
  [/\bkyckling ?buljong(en)?\b/gi, "kycklingbuljong$1"],
  [/\bugnskopp(en)?\b/gi, "ugnsform$1"],
  [/°C fläkt\b/g, "°C varmluft"],
];
const FRACTIONS: Record<string, string> = { "1⁄2": "½", "1⁄3": "⅓", "2⁄3": "⅔", "1⁄4": "¼", "3⁄4": "¾", "1⁄8": "⅛" };

/** What gives away a sentence the model made up: the EU's documents it learnt from. */
const MADE_UP = /ordförande|förordning|europaparlament|kommissionen|rådets|talman|\bEGT\b|\bEUT\b|gemenskaps/i;

/** (with the case of what it replaces: "Brown the" is "Fry the") */
function before(s: string): string {
  return BEFORE.reduce(
    (t, [re, to]) =>
      t.replace(re, (...m: string[]) => {
        const out = to.replace(/\$(\d)/g, (_, n: string) => m[Number(n)] ?? "");
        return /^\p{Lu}/u.test(m[0]!) ? out[0]!.toUpperCase() + out.slice(1) : out;
      }),
    s,
  );
}

/** The model's translation of `source`, mended; the source itself when it doesn't look like one. */
function checked(source: string, translated: string): string {
  let t = translated.replace(/\s+/g, " ").trim();
  t = t.replace(/(\d+)⁄(\d+)/g, (all) => FRACTIONS[all] ?? all.replace("⁄", "/"));
  if (!t || MADE_UP.test(t) || t.length > source.length * 2.5 + 20) return source;
  t = AFTER.reduce((x, [re, to]) => x.replace(re, to), t);
  // (the source's first letter's case: "koriander, hackad", not "Koriander, hackad")
  const first = source.trimStart()[0] ?? "";
  if (first && first === first.toLowerCase() && first !== first.toUpperCase()) t = t[0]!.toLowerCase() + t.slice(1);
  else if (first && first !== first.toLowerCase()) t = t[0]!.toUpperCase() + t.slice(1);
  return t;
}

// ── the walk over a recipe ──

/** A piece of English for the model; its translation. */
type Say = (english: string) => string;

const hasWords = (s: string) => /\p{L}{2}/u.test(s);
const sentences = (text: string, say: Say) =>
  text
    .split(/(?<=[.!?])\s+(?=["“(]?[\p{Lu}\d])/u)
    .map((s) => (hasWords(s) ? say(s) : s))
    .join(" ");

const LEAD = new RegExp(String.raw`^((?:about|approx\.?|approximately|ca\.?)\s+)?(${NUM}(?:\s*(?:[-–]|to)\s*${NUM})?)(?:\s*(\([^()]{1,40}\)))?\s*`, "i");
const WORD = /^([A-Za-z]+\.?)(?=[\s,]|$)\s*/;

function note(english: string, plural: boolean, say: Say): string {
  const key = english.trim().toLowerCase().replace(/^\((.*)\)$/, "$1");
  const known = NOTES[key];
  if (known) return known[plural ? 1 : 0];
  // ("rinsed and drained" when the two are known one by one)
  const parts = key.split(/\s+and\s+/);
  if (parts.length === 2 && parts.every((p) => NOTES[p])) return parts.map((p) => NOTES[p]![plural ? 1 : 0]).join(" och ");
  return hasWords(english) ? say(english.trim()) : english.trim();
}

function ingredientLine(line: string, say: Say): string {
  const t = line.trim();
  if (!t) return line;
  if (t.endsWith(":")) {
    const h = t.slice(0, -1).trim();
    return `${HEADINGS[h.toLowerCase()] ?? (hasWords(h) ? say(h) : h)}:`;
  }
  const m = LEAD.exec(t);
  const lead: string[] = [];
  let rest = t;
  let plural = false;
  let unit = false;
  if (m && m[2]) {
    if (m[1]) lead.push("ca");
    lead.push(m[2].replace(/\s+to\s+/i, "–"));
    if (m[3]) lead.push(hasWords(m[3].replace(/\b(?:g|kg|ml|cl|dl|l|msk|tsk|°C)\b/g, "")) ? `(${say(m[3].slice(1, -1))})` : m[3]);
    const amount = readNumber(m[2].split(/\s*(?:[-–]|to)\s*/i).pop() ?? "") ?? 1;
    rest = t.slice(m[0].length);
    const w = WORD.exec(rest);
    const count = w && COUNT_UNITS.find(([re]) => re.test(w[1]!));
    if (w && (count || METRIC_UNIT.test(w[1]!))) {
      lead.push(count ? count[amount > 1 ? 2 : 1] : w[1]!);
      unit = true;
      rest = rest.slice(w[0].length);
    }
    plural = amount > 1 && (!unit || !!count);
  }
  rest = rest.replace(/^of\s+/i, "").replace(/^boneless,\s+skinless\b/i, "boneless skinless");
  if (!lead.length) {
    const some = SOME.exec(rest);
    if (some) {
      const [neuter, word] = SOME_WORDS[some[2]!.toLowerCase()]!;
      const size = some[1] ? (/small/i.test(some[1]) ? (neuter ? "litet " : "liten ") : neuter ? "stort " : "stor ") : "";
      lead.push(`1 ${size}${word}`);
      rest = rest.slice(some[0].length);
    }
  }
  // the name, and its notes: after its first comma, or "to taste" at its end
  let name = rest;
  let notes = "";
  let joint = ", ";
  const comma = rest.indexOf(", ");
  if (comma > 0) {
    name = rest.slice(0, comma);
    notes = rest.slice(comma + 2);
  } else {
    const tail = /\s+((?:or |plus more )?to taste|\(optional\)|for serving|to serve|for garnish)$/i.exec(rest);
    if (tail) {
      name = rest.slice(0, tail.index);
      notes = tail[1]!;
      joint = " ";
    }
  }
  // (a note in brackets in the name: "bell pepper (any color)")
  const inner = /\s*\(([^()]+)\)\s*$/.exec(name);
  const bare = inner ? name.slice(0, inner.index) : name;
  plural ||= /[^s]s$/i.test(bare.trim()) && !/\b(?:asparagus|hummus|couscous|molasses|swiss|citrus|lettuce)$/i.test(bare.trim());
  const known = NAMES[bare.trim().toLowerCase()];
  let said: string;
  if (known) said = inner ? `${known} (${note(inner[1]!, plural, say)})` : known;
  else said = hasWords(name) ? say(name) : name;
  const noted = notes
    ? notes
        .split(/,\s+/)
        .map((n) => note(n, plural, say))
        .join(", ")
    : "";
  const out = [...lead, said].filter(Boolean).join(" ") + (noted ? joint + noted : "");
  // ("Salt and pepper to taste" as "Salt och peppar efter smak")
  return /^\p{Lu}/u.test(t) ? out[0]!.toUpperCase() + out.slice(1) : out;
}

function stepLine(line: string, say: Say): string {
  if (!line.trim()) return line;
  const bold = /^(\s*\*\*)(.+?)(\*\*:?\s*)$/.exec(line);
  if (bold) return bold[1]! + (hasWords(bold[2]!) ? say(bold[2]!) : bold[2]!) + bold[3]!;
  const marked = /^(\s*(?:\d+[.)]|[-*•]|#{1,6})\s+)(.*)$/.exec(line);
  if (marked) return marked[1]! + sentences(marked[2]!, say);
  return sentences(line, say);
}

function walk(r: RecipeTexts, say: Say): RecipeTexts {
  return {
    // (not the title: the model makes "Cowboy Soup" "Kosslesoppa" and "Classic Beef Stew" "Klassiskt
    //  nötkött"; a dish's name is better left as it is, for someone to put in Swedish if they like)
    title: r.title,
    description: r.description
      .split(/\n{2,}/)
      .map((p) => sentences(p.trim(), say))
      .join("\n\n"),
    ingredients: toMetric(r.ingredients, "sv")
      .split("\n")
      .map((l) => ingredientLine(l, say))
      .join("\n"),
    steps: toMetric(r.steps, "sv")
      .split("\n")
      .map((l) => stepLine(l, say))
      .join("\n"),
  };
}

/** What the model is to translate in a recipe (each piece once, in order). */
export function translationTexts(r: RecipeTexts): string[] {
  const texts: string[] = [];
  walk(r, (s) => {
    texts.push(before(s));
    return s;
  });
  return texts;
}

/** The recipe with the model's translations (of translationTexts, in the same order) in their places. */
export function translatedRecipe(r: RecipeTexts, translated: readonly string[]): RecipeTexts {
  let i = 0;
  return walk(r, (s) => {
    const t = translated[i++];
    return typeof t === "string" ? checked(s, t) : s;
  });
}
