// Resets the demo household to a realistic state: perishables close to expiry, an expired
// medicine, and months of purchase history so the restock forecast has patterns to find.
import { classify } from "./shelfLife.js";
import { addDays, InventoryStore, today } from "./store.js";
import type { NewItem } from "./types.js";

const householdId = process.env.HOMESTOCK_HOUSEHOLD ?? "demo";
const t = today();

interface StockSeed {
  item: NewItem;
  addedDaysAgo: number;
  /** Regular purchase cadence; generates `pastPurchases` earlier buy/finish cycles. */
  buyEvery?: number;
  pastPurchases?: number;
}

const stock: StockSeed[] = [
  { item: { name: "milk", quantity: 1, unit: "carton", expiresOn: addDays(t, 1) }, addedDaysAgo: 4, buyEvery: 6, pastPurchases: 5 },
  { item: { name: "spinach", quantity: 1, unit: "bag", expiresOn: t }, addedDaysAgo: 5, buyEvery: 7, pastPurchases: 4 },
  { item: { name: "chicken thighs", quantity: 500, unit: "g", expiresOn: addDays(t, 1) }, addedDaysAgo: 2 },
  { item: { name: "greek yogurt", quantity: 2, unit: "tub", expiresOn: addDays(t, -1) }, addedDaysAgo: 9 },
  { item: { name: "eggs", quantity: 8, expiresOn: addDays(t, 18) }, addedDaysAgo: 7, buyEvery: 9, pastPurchases: 4 },
  { item: { name: "cheddar", quantity: 200, unit: "g", expiresOn: addDays(t, 20) }, addedDaysAgo: 6 },
  { item: { name: "tomatoes", quantity: 4, expiresOn: addDays(t, 3) }, addedDaysAgo: 2 },
  { item: { name: "bread", quantity: 1, unit: "loaf", expiresOn: addDays(t, 2) }, addedDaysAgo: 3 },
  { item: { name: "frozen peas", quantity: 1, unit: "bag" }, addedDaysAgo: 30 },
  { item: { name: "rice", quantity: 2, unit: "kg" }, addedDaysAgo: 40 },
  { item: { name: "pasta", quantity: 3, unit: "pack" }, addedDaysAgo: 20 },
  { item: { name: "dishwasher tablets", quantity: 6 }, addedDaysAgo: 24, buyEvery: 28, pastPurchases: 4 },
  { item: { name: "laundry detergent", quantity: 1, unit: "bottle" }, addedDaysAgo: 15 },
  { item: { name: "toothpaste", quantity: 1, unit: "tube" }, addedDaysAgo: 30, buyEvery: 40, pastPurchases: 3 },
  { item: { name: "ibuprofen", quantity: 1, unit: "box", expiresOn: addDays(t, -20) }, addedDaysAgo: 400 },
  { item: { name: "cat litter", quantity: 1, unit: "bag" }, addedDaysAgo: 11, buyEvery: 14, pastPurchases: 4 },
];

const outOfStock = [{ name: "coffee beans", buyEvery: 18, pastPurchases: 3, finishedDaysAgo: 2 }];

const store = new InventoryStore();
store.resetHousehold(householdId);

function recordCycles(name: string, lastAdded: string, buyEvery: number, cycles: number) {
  const { category } = classify(name);
  for (let i = cycles; i >= 1; i--) {
    const boughtOn = addDays(lastAdded, -buyEvery * i);
    store.recordEvent(householdId, { name, category, kind: "added", quantity: 1, onDate: boughtOn });
    store.recordEvent(householdId, { name, category, kind: "finished", quantity: 1, onDate: addDays(boughtOn, buyEvery - 1) });
  }
}

for (const s of stock) {
  const addedOn = addDays(t, -s.addedDaysAgo);
  if (s.buyEvery && s.pastPurchases) recordCycles(s.item.name, addedOn, s.buyEvery, s.pastPurchases);
  store.addItems(householdId, [s.item], addedOn);
}

for (const o of outOfStock) {
  // Treat the finish date as the end of the latest cycle so cadence stays consistent.
  const lastAdded = addDays(t, -o.finishedDaysAgo - o.buyEvery + 1);
  recordCycles(o.name, addDays(lastAdded, o.buyEvery), o.buyEvery, o.pastPurchases);
}

store.addToShoppingList(householdId, [
  { name: "bananas", quantity: 6 },
  { name: "olive oil", quantity: 1, unit: "bottle" },
]);

console.log(
  `Seeded household "${householdId}" for ${t}: ${store.listItems(householdId).length} items, ` +
    `${store.restockForecast(householdId).length} restock suggestions, ${store.shoppingList(householdId).length} list entries.`,
);
store.close();
