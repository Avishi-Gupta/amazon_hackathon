import { z } from "zod";

export const CATEGORIES = [
  "produce",
  "dairy",
  "meat_seafood",
  "bakery",
  "pantry",
  "frozen",
  "beverages",
  "household",
  "personal_care",
  "medicine",
  "pet",
] as const;
export const categorySchema = z.enum(CATEGORIES);
export type Category = z.infer<typeof categorySchema>;

export const LOCATIONS = [
  "fridge",
  "freezer",
  "pantry",
  "bathroom",
  "laundry",
  "cleaning_cupboard",
  "medicine_cabinet",
  "other",
] as const;
export const locationSchema = z.enum(LOCATIONS);
export type Location = z.infer<typeof locationSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: categorySchema,
  location: locationSchema,
  quantity: z.number(),
  unit: z.string(),
  addedOn: isoDate,
  expiresOn: isoDate.nullable(),
  expiryEstimated: z.boolean().describe("True when expiresOn was inferred from typical shelf life"),
  daysLeft: z.number().nullable().describe("Days until expiry; negative once expired"),
});
export type Item = z.infer<typeof itemSchema>;

export const newItemSchema = z.object({
  name: z.string().trim().min(1).describe("Plain product name, e.g. 'eggs' or 'dishwasher tablets'"),
  quantity: z.number().positive().default(1),
  unit: z.string().trim().min(1).default("item").describe("Unit such as 'carton', 'g', 'pack'; 'item' for countable things"),
  category: categorySchema.optional().describe("Inferred from the name when omitted"),
  location: locationSchema.optional().describe("Inferred from the name when omitted"),
  expiresOn: isoDate.optional().describe("Printed expiry or best-before date, if the customer said one"),
});
export type NewItem = z.input<typeof newItemSchema>;

export const shoppingEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.number(),
  unit: z.string(),
  reason: z.string().nullable(),
  addedOn: isoDate,
});
export type ShoppingEntry = z.infer<typeof shoppingEntrySchema>;

export const restockSuggestionSchema = z.object({
  name: z.string(),
  category: categorySchema,
  reason: z.enum(["out_of_stock", "predicted_run_out"]),
  predictedOn: isoDate.nullable(),
  avgDaysBetweenPurchases: z.number().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  onShoppingList: z.boolean(),
});
export type RestockSuggestion = z.infer<typeof restockSuggestionSchema>;
