import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type CallToolResult, type ReadResourceResult } from "@modelcontextprotocol/server";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { daysBetween, today, type InventoryStore } from "./domain/store.js";
import {
  categorySchema,
  itemSchema,
  locationSchema,
  newItemSchema,
  restockSuggestionSchema,
  shoppingEntrySchema,
} from "./domain/types.js";
import { describeQuantity, expiryPhrase, joinNames, relativeDay } from "./voice.js";

export const BOARD_URI = "ui://homestock/board.html";
const BOARD_HTML = path.resolve(import.meta.dirname, "../dist/ui/board.html");

const INSTRUCTIONS = `HomeStock tracks the food and household consumables in the customer's home: groceries, cleaning supplies, toiletries, medicine and pet supplies.
Use add_items when they bought or put something away, and use_item when they used, finished or threw something out.
When they ask what to use up or what is going off, call get_expiring. When they ask what they need to buy, call get_restock_forecast and get_shopping_list.
Never add items to the shopping list without the customer agreeing.`;

export interface HomeStockServerOptions {
  store: InventoryStore;
  householdId: string;
}

const say = (text: string) => [{ type: "text" as const, text }];

export function createServer({ store, householdId }: HomeStockServerOptions): McpServer {
  const server = new McpServer({ name: "homestock", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "add_items",
    {
      title: "Add items",
      description:
        "Record groceries or household products the customer bought or put away, for example 'I bought eggs, milk and dishwasher tablets'. Category, storage location and expiry are estimated when not given. Matching shopping list entries are crossed off.",
      inputSchema: z.object({ items: z.array(newItemSchema).min(1).max(50) }),
      outputSchema: z.object({ added: z.array(itemSchema), clearedFromShoppingList: z.array(z.string()) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ items }): Promise<CallToolResult> => {
      const result = store.addItems(householdId, items);
      const perishable = result.added.filter((i) => i.daysLeft !== null && i.daysLeft <= 7);
      let text = `Added ${joinNames(result.added.map(describeQuantity))}.`;
      if (perishable.length) {
        text += ` Use the ${joinNames(perishable.map((i) => i.name))} within about ${Math.min(...perishable.map((i) => i.daysLeft!))} days.`;
      }
      if (result.clearedFromShoppingList.length) {
        text += ` I crossed ${joinNames(result.clearedFromShoppingList)} off your shopping list.`;
      }
      return { content: say(text), structuredContent: result };
    },
  );

  server.registerTool(
    "use_item",
    {
      title: "Use an item",
      description:
        "Record that the customer used some of an item, finished it, or threw it away. The soonest-expiring matching item is used first.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Product name as the customer said it"),
        outcome: z
          .enum(["used", "finished", "discarded"])
          .default("used")
          .describe("'used' for part of it, 'finished' when none is left, 'discarded' when thrown away or spoiled"),
        amount: z.number().positive().optional().describe("How much was used, in the item's unit. Defaults to 1."),
      }),
      outputSchema: z.object({
        name: z.string(),
        outcome: z.enum(["used", "finished", "discarded"]),
        remainingQuantity: z.number(),
        restockSuggested: z.boolean(),
        regularPurchase: z.boolean(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ name, outcome, amount }): Promise<CallToolResult> => {
      const result = store.useItem(householdId, name, outcome, amount);
      if (!result) {
        return { isError: true, content: say(`I couldn't find ${name} in your home inventory.`) };
      }
      const { item, kind, remainingQuantity, restockSuggested, regularPurchase } = result;
      let text =
        kind === "discarded"
          ? `Logged the ${item.name} as thrown away.`
          : kind === "finished"
            ? `Marked the ${item.name} as finished.`
            : `Done. You have ${describeQuantity({ ...item, quantity: remainingQuantity })} left.`;
      if (restockSuggested) {
        text += regularPurchase
          ? ` You buy ${item.name} regularly. Should I add it to your shopping list?`
          : ` That was your last ${item.name}. Should I add it to your shopping list?`;
      }
      return {
        content: say(text),
        structuredContent: { name: item.name, outcome: kind, remainingQuantity, restockSuggested, regularPurchase },
      };
    },
  );

  registerAppTool(
    server,
    "get_inventory",
    {
      title: "Show inventory",
      description:
        "List what the customer has at home, optionally filtered by category, storage location or a product name. Use for questions like 'do we have eggs?' or 'what's in the bathroom cupboard?'.",
      inputSchema: z.object({
        category: categorySchema.optional(),
        location: locationSchema.optional(),
        search: z.string().min(1).optional().describe("Product name to look for"),
      }),
      outputSchema: z.object({
        view: z.literal("inventory"),
        today: z.string(),
        filter: z.object({ category: categorySchema.optional(), location: locationSchema.optional(), search: z.string().optional() }),
        items: z.array(itemSchema),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: BOARD_URI } },
    },
    async (filter): Promise<CallToolResult> => {
      const items = store.listItems(householdId, filter);
      let text: string;
      if (!items.length) {
        text = filter.search ? `You don't have any ${filter.search} at home.` : "Nothing in your inventory matches that.";
      } else if (filter.search) {
        text = `You have ${joinNames(items.map(describeQuantity))}.`;
        const soonest = items[0]!;
        if (soonest.daysLeft !== null) text += ` The ${soonest.name} ${expiryPhrase(soonest.daysLeft)}.`;
      } else {
        const urgent = items.filter((i) => i.daysLeft !== null && i.daysLeft <= 3);
        text = `You're tracking ${items.length} items.`;
        if (urgent.length) text += ` ${urgent.length} need attention in the next 3 days: ${joinNames(urgent.map((i) => i.name))}.`;
      }
      return { content: say(text), structuredContent: { view: "inventory", today: today(), filter, items } };
    },
  );

  registerAppTool(
    server,
    "get_expiring",
    {
      title: "What's expiring",
      description:
        "List items that have expired or will expire soon, soonest first. Use when the customer asks what to use up, what's going off, or what to cook first.",
      inputSchema: z.object({
        withinDays: z.number().int().min(0).max(30).default(3).describe("Look-ahead window in days"),
      }),
      outputSchema: z.object({
        view: z.literal("expiring"),
        today: z.string(),
        withinDays: z.number(),
        items: z.array(itemSchema),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: BOARD_URI } },
    },
    async ({ withinDays }): Promise<CallToolResult> => {
      const items = store.expiring(householdId, withinDays);
      const expired = items.filter((i) => i.daysLeft! < 0);
      const soon = items.filter((i) => i.daysLeft! >= 0);
      const parts: string[] = [];
      if (expired.length) parts.push(`${joinNames(expired.map((i) => i.name))} ${expired.length === 1 ? "has" : "have"} expired.`);
      if (soon.length) parts.push(`Use soon: ${joinNames(soon.map((i) => `${i.name} ${relativeDay(i.daysLeft!)}`))}.`);
      const text = parts.length ? parts.join(" ") : `Nothing expires in the next ${withinDays} days.`;
      return { content: say(text), structuredContent: { view: "expiring", today: today(), withinDays, items } };
    },
  );

  registerAppTool(
    server,
    "get_restock_forecast",
    {
      title: "Restock forecast",
      description:
        "Predict which regularly bought products are out of stock or will run out soon, based on how often the household buys them. Use for 'what do we need?' or 'what's running low?'.",
      inputSchema: z.object({
        horizonDays: z.number().int().min(1).max(30).default(7).describe("How far ahead to predict run-outs"),
      }),
      outputSchema: z.object({
        view: z.literal("restock"),
        today: z.string(),
        horizonDays: z.number(),
        suggestions: z.array(restockSuggestionSchema),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: BOARD_URI } },
    },
    async ({ horizonDays }): Promise<CallToolResult> => {
      const suggestions = store.restockForecast(householdId, horizonDays);
      const out = suggestions.filter((s) => s.reason === "out_of_stock");
      const low = suggestions.filter((s) => s.reason === "predicted_run_out");
      const parts: string[] = [];
      if (out.length) parts.push(`You're out of ${joinNames(out.map((s) => s.name))}.`);
      if (low.length) {
        const t = today();
        parts.push(`You'll likely run out of ${joinNames(low.map((s) => `${s.name} ${relativeDay(Math.max(0, daysBetween(t, s.predictedOn!)))}`))}.`);
      }
      const text = parts.length ? parts.join(" ") : `Nothing is likely to run out in the next ${horizonDays} days.`;
      return { content: say(text), structuredContent: { view: "restock", today: today(), horizonDays, suggestions } };
    },
  );

  registerAppTool(
    server,
    "get_shopping_list",
    {
      title: "Shopping list",
      description: "Show the household shopping list.",
      inputSchema: z.object({}),
      outputSchema: z.object({ view: z.literal("shopping"), today: z.string(), items: z.array(shoppingEntrySchema) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: BOARD_URI } },
    },
    async (): Promise<CallToolResult> => {
      const items = store.shoppingList(householdId);
      const text = items.length
        ? `Your shopping list has ${items.length} ${items.length === 1 ? "item" : "items"}: ${joinNames(items.map((i) => i.name), 8)}.`
        : "Your shopping list is empty.";
      return { content: say(text), structuredContent: { view: "shopping", today: today(), items } };
    },
  );

  server.registerTool(
    "add_to_shopping_list",
    {
      title: "Add to shopping list",
      description: "Add products to the shopping list after the customer agrees. Adding an existing entry increases its quantity.",
      inputSchema: z.object({
        items: z
          .array(
            z.object({
              name: z.string().min(1),
              quantity: z.number().positive().default(1),
              unit: z.string().min(1).default("item"),
              reason: z.string().optional().describe("Why it's needed, e.g. 'running low'"),
            }),
          )
          .min(1)
          .max(50),
      }),
      outputSchema: z.object({ items: z.array(shoppingEntrySchema) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ items }): Promise<CallToolResult> => {
      const list = store.addToShoppingList(householdId, items);
      const text = `Added ${joinNames(items.map((i) => i.name))} to your shopping list. It now has ${list.length} ${list.length === 1 ? "item" : "items"}.`;
      return { content: say(text), structuredContent: { items: list } };
    },
  );

  server.registerTool(
    "remove_from_shopping_list",
    {
      title: "Remove from shopping list",
      description: "Remove a product from the shopping list.",
      inputSchema: z.object({ name: z.string().min(1) }),
      outputSchema: z.object({ removed: z.array(z.string()), items: z.array(shoppingEntrySchema) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ name }): Promise<CallToolResult> => {
      const removed = store.removeFromShoppingList(householdId, name);
      const items = store.shoppingList(householdId);
      const text = removed.length
        ? `Removed ${joinNames(removed)} from your shopping list.`
        : `${name} wasn't on your shopping list.`;
      return { content: say(text), structuredContent: { removed, items } };
    },
  );

  registerAppResource(
    server,
    "HomeStock board",
    BOARD_URI,
    { mimeType: RESOURCE_MIME_TYPE, description: "Interactive Echo Show board for inventory, expiry, restock and shopping views" },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(BOARD_HTML, "utf-8").catch(() => {
        throw new Error(`UI bundle not found at ${BOARD_HTML}. Run "npm run build:ui" first.`);
      });
      return { contents: [{ uri: BOARD_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  return server;
}
