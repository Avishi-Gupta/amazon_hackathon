import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { classify, defaultLocation, estimateShelfLifeDays } from "./shelfLife.js";
import {
  newItemSchema,
  type Category,
  type Item,
  type Location,
  type NewItem,
  type RestockSuggestion,
  type ShoppingEntry,
} from "./types.js";

export type EventKind = "added" | "used" | "finished" | "discarded";

export interface UseResult {
  item: Item;
  kind: Exclude<EventKind, "added">;
  usedQuantity: number;
  remainingQuantity: number;
  /** True once none of this product is left, whether it was finished or thrown away. */
  restockSuggested: boolean;
  /** True when the household has bought this product more than once, so "you buy this regularly" holds. */
  regularPurchase: boolean;
}

export interface InventoryFilter {
  category?: Category;
  location?: Location;
  search?: string;
}

type Row = Record<string, unknown>;

const DAY_MS = 86_400_000;

/**
 * Today's date as YYYY-MM-DD in the household's timezone (HOMESTOCK_TZ, else the server's local zone).
 * HOMESTOCK_TODAY pins it for reproducible demos and tests.
 */
export function today(): string {
  if (process.env.HOMESTOCK_TODAY) return process.env.HOMESTOCK_TODAY;
  // en-CA formats dates as YYYY-MM-DD.
  return new Date().toLocaleDateString("en-CA", { timeZone: process.env.HOMESTOCK_TZ || undefined });
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Tidies a product name before storing it. Receipt scans arrive shouted and padded with pack sizes
 * ("MEIJI FRH MILK 830M"), which would otherwise sit in the inventory as a separate product from
 * the same thing added by voice.
 */
export function normalizeProductName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/\b\d+(\.\d+)?\s?(ml|l|g|kg|mg|oz|lb|ct|pk|pcs?|s)\b/gi, "") // 500ml, 830m, 30s, 2kg
    .replace(/\bx\s?\d+\b/gi, "") // x2
    .replace(/[^\p{L}\p{N}\s'&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const result = cleaned || name.trim();
  // Receipt shorthand is upper case; everything the customer says keeps its own casing.
  return result === result.toUpperCase() ? result.toLowerCase() : result;
}

const round = (n: number) => Math.round(n * 100) / 100;

export class InventoryStore {
  private readonly db: DatabaseSync;

  constructor(file = process.env.HOMESTOCK_DB ?? "data/homestock.db") {
    if (file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        category TEXT NOT NULL,
        location TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT NOT NULL,
        added_on TEXT NOT NULL,
        expires_on TEXT,
        expiry_estimated INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS items_household ON items (household_id, name_key);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id TEXT NOT NULL,
        name_key TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('added', 'used', 'finished', 'discarded')),
        quantity REAL NOT NULL,
        on_date TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_household ON events (household_id, name_key, kind);
      CREATE TABLE IF NOT EXISTS shopping_list (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT NOT NULL,
        reason TEXT,
        added_on TEXT NOT NULL,
        UNIQUE (household_id, name_key)
      );
    `);
  }

  addItems(
    householdId: string,
    inputs: NewItem[],
    addedOn = today(),
  ): { added: Item[]; clearedFromShoppingList: string[] } {
    const insert = this.db.prepare(`
      INSERT INTO items (id, household_id, name, name_key, category, location, quantity, unit, added_on, expires_on, expiry_estimated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    // A purchase satisfies list entries whose name it contains ("free range eggs" clears "eggs").
    const listMatches = this.db.prepare(
      `SELECT id, name FROM shopping_list WHERE household_id = ? AND (name_key = ? OR ? LIKE '%' || name_key || '%')`,
    );
    const deleteListEntry = this.db.prepare(`DELETE FROM shopping_list WHERE id = ?`);

    const added: Item[] = [];
    const cleared: string[] = [];
    this.transaction(() => {
      for (const raw of inputs) {
        const parsed = newItemSchema.parse(raw);
        const input = { ...parsed, name: normalizeProductName(parsed.name) };
        const guess = classify(input.name);
        const category = input.category ?? guess.category;
        const location = input.location ?? (input.category ? defaultLocation(input.category) : guess.location);
        let expiresOn = input.expiresOn ?? null;
        let expiryEstimated = false;
        if (!expiresOn) {
          const days = estimateShelfLifeDays(input.name, category, location);
          if (days !== null) {
            expiresOn = addDays(addedOn, days);
            expiryEstimated = true;
          }
        }

        const id = randomUUID();
        const key = nameKey(input.name);
        insert.run(id, householdId, input.name, key, category, location, input.quantity, input.unit, addedOn, expiresOn, expiryEstimated ? 1 : 0);
        this.recordEvent(householdId, { name: input.name, category, kind: "added", quantity: input.quantity, onDate: addedOn });

        for (const entry of listMatches.all(householdId, key, key)) {
          deleteListEntry.run(String(entry.id));
          cleared.push(String(entry.name));
        }
        added.push(this.toItem(this.db.prepare(`SELECT * FROM items WHERE id = ?`).get(id)!));
      }
    });
    return { added, clearedFromShoppingList: cleared };
  }

  listItems(householdId: string, filter: InventoryFilter = {}): Item[] {
    const clauses = ["household_id = ?"];
    const params: string[] = [householdId];
    if (filter.category) {
      clauses.push("category = ?");
      params.push(filter.category);
    }
    if (filter.location) {
      clauses.push("location = ?");
      params.push(filter.location);
    }
    if (filter.search) {
      clauses.push("name_key LIKE ?");
      params.push(`%${nameKey(filter.search)}%`);
    }
    return this.db
      .prepare(`SELECT * FROM items WHERE ${clauses.join(" AND ")} ORDER BY expires_on IS NULL, expires_on, name_key`)
      .all(...params)
      .map((row) => this.toItem(row));
  }

  /** Items already expired or expiring within `withinDays`, soonest first. */
  expiring(householdId: string, withinDays: number): Item[] {
    return this.db
      .prepare(`SELECT * FROM items WHERE household_id = ? AND expires_on IS NOT NULL AND expires_on <= ? ORDER BY expires_on, name_key`)
      .all(householdId, addDays(today(), withinDays))
      .map((row) => this.toItem(row));
  }

  /**
   * Records consumption of the best-matching item, using the soonest-expiring one first.
   * `used` subtracts `amount` (default 1); `finished` and `discarded` remove the item entirely.
   */
  useItem(householdId: string, name: string, outcome: "used" | "finished" | "discarded", amount?: number): UseResult | null {
    const key = nameKey(name);
    const row = this.db
      .prepare(
        `SELECT * FROM items WHERE household_id = ? AND name_key LIKE ?
         ORDER BY (name_key = ?) DESC, expires_on IS NULL, expires_on LIMIT 1`,
      )
      .get(householdId, `%${key}%`, key);
    if (!row) return null;

    const item = this.toItem(row);
    const usedQuantity = outcome === "used" ? Math.min(amount ?? 1, item.quantity) : item.quantity;
    const remainingQuantity = round(item.quantity - usedQuantity);
    const kind = outcome === "discarded" ? "discarded" : remainingQuantity <= 0 ? "finished" : "used";

    this.transaction(() => {
      if (remainingQuantity <= 0 || kind === "discarded") {
        this.db.prepare(`DELETE FROM items WHERE id = ?`).run(item.id);
      } else {
        this.db.prepare(`UPDATE items SET quantity = ? WHERE id = ?`).run(remainingQuantity, item.id);
      }
      this.recordEvent(householdId, { name: item.name, category: item.category, kind, quantity: usedQuantity, onDate: today() });
    });

    const stillInStock = this.db
      .prepare(`SELECT 1 FROM items WHERE household_id = ? AND name_key = ? LIMIT 1`)
      .get(householdId, nameKey(item.name));
    // Thrown away counts the same as finished here: either way the household now has none.
    const restockSuggested = (kind === "finished" || kind === "discarded") && !stillInStock;
    const regularPurchase = this.purchaseDates(householdId, nameKey(item.name)).length >= 2;

    return { item, kind, usedQuantity, remainingQuantity: Math.max(0, remainingQuantity), restockSuggested, regularPurchase };
  }

  /**
   * Predicts what will run out from each product's purchase cadence. Products bought at least twice
   * that are now out of stock come first, followed by in-stock products predicted to run out within the horizon.
   */
  restockForecast(householdId: string, horizonDays = 7): RestockSuggestion[] {
    const horizon = addDays(today(), horizonDays);
    const inStock = new Set(
      this.db.prepare(`SELECT DISTINCT name_key FROM items WHERE household_id = ?`).all(householdId).map((r) => String(r.name_key)),
    );
    const onList = new Set(
      this.db.prepare(`SELECT name_key FROM shopping_list WHERE household_id = ?`).all(householdId).map((r) => String(r.name_key)),
    );
    const products = this.db
      .prepare(
        `SELECT name_key, MAX(name) AS name, MAX(category) AS category FROM events
         WHERE household_id = ? AND kind = 'added' GROUP BY name_key`,
      )
      .all(householdId);

    const suggestions: RestockSuggestion[] = [];
    for (const product of products) {
      const key = String(product.name_key);
      const dates = this.purchaseDates(householdId, key);
      if (dates.length < 2) continue;

      const intervals = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d)).filter((n) => n > 0);
      const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null;
      const confidence = intervals.length >= 3 ? "high" : intervals.length === 2 ? "medium" : "low";
      const base = {
        name: String(product.name),
        category: product.category as Category,
        avgDaysBetweenPurchases: avg === null ? null : round(avg),
        confidence,
        onShoppingList: onList.has(key),
      } as const;

      if (!inStock.has(key)) {
        suggestions.push({ ...base, reason: "out_of_stock", predictedOn: null });
      } else if (avg !== null) {
        const predictedOn = addDays(dates.at(-1)!, Math.round(avg));
        if (predictedOn <= horizon) suggestions.push({ ...base, reason: "predicted_run_out", predictedOn });
      }
    }
    return suggestions.sort(
      (a, b) =>
        Number(a.reason === "predicted_run_out") - Number(b.reason === "predicted_run_out") ||
        (a.predictedOn ?? "").localeCompare(b.predictedOn ?? ""),
    );
  }

  addToShoppingList(
    householdId: string,
    entries: { name: string; quantity?: number; unit?: string; reason?: string }[],
  ): ShoppingEntry[] {
    const upsert = this.db.prepare(`
      INSERT INTO shopping_list (id, household_id, name, name_key, quantity, unit, reason, added_on)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (household_id, name_key) DO UPDATE SET
        quantity = shopping_list.quantity + excluded.quantity,
        reason = COALESCE(excluded.reason, shopping_list.reason)`);
    this.transaction(() => {
      for (const e of entries) {
        upsert.run(randomUUID(), householdId, e.name.trim(), nameKey(e.name), e.quantity ?? 1, e.unit ?? "item", e.reason ?? null, today());
      }
    });
    return this.shoppingList(householdId);
  }

  shoppingList(householdId: string): ShoppingEntry[] {
    return this.db
      .prepare(`SELECT * FROM shopping_list WHERE household_id = ? ORDER BY added_on, name_key`)
      .all(householdId)
      .map((r) => ({
        id: String(r.id),
        name: String(r.name),
        quantity: Number(r.quantity),
        unit: String(r.unit),
        reason: r.reason === null ? null : String(r.reason),
        addedOn: String(r.added_on),
      }));
  }

  removeFromShoppingList(householdId: string, name: string): string[] {
    const matches = this.db
      .prepare(`SELECT id, name FROM shopping_list WHERE household_id = ? AND name_key LIKE ?`)
      .all(householdId, `%${nameKey(name)}%`);
    const del = this.db.prepare(`DELETE FROM shopping_list WHERE id = ?`);
    this.transaction(() => matches.forEach((m) => del.run(String(m.id))));
    return matches.map((m) => String(m.name));
  }

  recordEvent(
    householdId: string,
    e: { name: string; category: Category; kind: EventKind; quantity: number; onDate: string },
  ): void {
    this.db
      .prepare(`INSERT INTO events (household_id, name_key, name, category, kind, quantity, on_date) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(householdId, nameKey(e.name), e.name.trim(), e.category, e.kind, e.quantity, e.onDate);
  }

  resetHousehold(householdId: string): void {
    this.transaction(() => {
      for (const table of ["items", "events", "shopping_list"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE household_id = ?`).run(householdId);
      }
    });
  }

  close(): void {
    this.db.close();
  }

  private purchaseDates(householdId: string, key: string): string[] {
    return this.db
      .prepare(`SELECT DISTINCT on_date FROM events WHERE household_id = ? AND name_key = ? AND kind = 'added' ORDER BY on_date`)
      .all(householdId, key)
      .map((r) => String(r.on_date));
  }

  private transaction(fn: () => void): void {
    if (this.db.isTransaction) return fn();
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private toItem(row: Row): Item {
    const expiresOn = row.expires_on == null ? null : String(row.expires_on);
    return {
      id: String(row.id),
      name: String(row.name),
      category: row.category as Category,
      location: row.location as Location,
      quantity: Number(row.quantity),
      unit: String(row.unit),
      addedOn: String(row.added_on),
      expiresOn,
      expiryEstimated: Number(row.expiry_estimated) === 1,
      daysLeft: expiresOn === null ? null : daysBetween(today(), expiresOn),
    };
  }
}
