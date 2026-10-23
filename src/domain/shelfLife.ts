import type { Category, Location } from "./types.js";

interface Rule {
  pattern: RegExp;
  category: Category;
  location: Location;
  /** Typical days until expiry once bought; null for things that effectively don't spoil. */
  days: number | null;
}

// Order matters: first match wins, so specific phrases ("dish soap") precede generic ones ("soap").
const RULES: Rule[] = [
  { pattern: /\b(detergent|dish ?soap|dishwasher|bleach|cleaner|sponges?|bin bags?|trash bags?|paper towels?|toilet (paper|rolls?)|tissues?|foil|cling ?film)\b/, category: "household", location: "cleaning_cupboard", days: null },
  { pattern: /\b(shampoo|conditioner|toothpaste|soap|deodorant|razors?|body ?wash|sunscreen|lotion|floss)\b/, category: "personal_care", location: "bathroom", days: null },
  { pattern: /\b(ibuprofen|paracetamol|panadol|aspirin|vitamins?|antihistamines?|cough|plasters?|bandages?|medicine|tablets? for)\b/, category: "medicine", location: "medicine_cabinet", days: null },
  { pattern: /\b(dog food|cat food|kibble|cat litter|litter|pet food)\b/, category: "pet", location: "pantry", days: null },
  { pattern: /\b(frozen|ice cream|peas)\b/, category: "frozen", location: "freezer", days: 120 },
  { pattern: /\b(milk|cream|yogh?urt|kefir)\b/, category: "dairy", location: "fridge", days: 7 },
  { pattern: /\b(cheese|cheddar|mozzarella|parmesan|feta)\b/, category: "dairy", location: "fridge", days: 21 },
  { pattern: /\bbutter\b/, category: "dairy", location: "fridge", days: 60 },
  { pattern: /\beggs?\b/, category: "dairy", location: "fridge", days: 28 },
  { pattern: /\b(chicken|beef|pork|lamb|mince|steak|sausages?|bacon|fish|salmon|tuna steak|prawns?|shrimp)\b/, category: "meat_seafood", location: "fridge", days: 3 },
  { pattern: /\b(tofu|hummus)\b/, category: "produce", location: "fridge", days: 7 },
  { pattern: /\b(spinach|lettuce|salad|rocket|herbs?|coriander|cilantro|basil|parsley|berries|strawberr(y|ies)|blueberr(y|ies)|mushrooms?)\b/, category: "produce", location: "fridge", days: 5 },
  { pattern: /\b(bananas?|avocados?|tomato(es)?|peaches|pears?|cucumbers?|capsicums?|peppers?|broccoli|zucchini|courgettes?)\b/, category: "produce", location: "pantry", days: 5 },
  { pattern: /\b(apples?|oranges?|lemons?|limes?|carrots?|onions?|potato(es)?|garlic|ginger)\b/, category: "produce", location: "pantry", days: 21 },
  { pattern: /\b(bread|loaf|bagels?|tortillas?|wraps?|buns?|croissants?)\b/, category: "bakery", location: "pantry", days: 5 },
  { pattern: /\b(juice|oat milk|almond milk)\b/, category: "beverages", location: "fridge", days: 7 },
  { pattern: /\b(coffee|tea|soda|water)\b/, category: "beverages", location: "pantry", days: 270 },
  { pattern: /\b(rice|pasta|spaghetti|flour|oats|lentils|beans|chickpeas|noodles|cereal|sugar|salt|oil|vinegar|sauce|canned|tins?)\b/, category: "pantry", location: "pantry", days: 365 },
];

const DEFAULT_LOCATION: Record<Category, Location> = {
  produce: "fridge",
  dairy: "fridge",
  meat_seafood: "fridge",
  bakery: "pantry",
  pantry: "pantry",
  frozen: "freezer",
  beverages: "pantry",
  household: "cleaning_cupboard",
  personal_care: "bathroom",
  medicine: "medicine_cabinet",
  pet: "pantry",
};

const DEFAULT_DAYS: Record<Category, number | null> = {
  produce: 7,
  dairy: 10,
  meat_seafood: 3,
  bakery: 5,
  pantry: 180,
  frozen: 120,
  beverages: 180,
  household: null,
  personal_care: null,
  medicine: null,
  pet: null,
};

export function classify(name: string): { category: Category; location: Location } {
  const rule = RULES.find((r) => r.pattern.test(name.toLowerCase()));
  return rule ? { category: rule.category, location: rule.location } : { category: "pantry", location: "pantry" };
}

export function defaultLocation(category: Category): Location {
  return DEFAULT_LOCATION[category];
}

/** Estimated days until expiry for a newly bought item, or null when an estimate would be misleading. */
export function estimateShelfLifeDays(name: string, category: Category, location: Location): number | null {
  const rule = RULES.find((r) => r.pattern.test(name.toLowerCase()) && r.category === category);
  const days = rule ? rule.days : DEFAULT_DAYS[category];
  if (days === null) return null;
  // Freezing extends perishables to roughly three months.
  return location === "freezer" ? Math.max(days, 90) : days;
}
