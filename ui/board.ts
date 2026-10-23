import { App, applyDocumentTheme, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { Category, Item, Location, RestockSuggestion, ShoppingEntry } from "../src/domain/types.js";
import "./board.css";

type BoardState =
  | { view: "inventory"; today: string; items: Item[] }
  | { view: "expiring"; today: string; withinDays: number; items: Item[] }
  | { view: "restock"; today: string; horizonDays: number; suggestions: RestockSuggestion[] }
  | { view: "shopping"; today: string; items: ShoppingEntry[] };

interface ToolResultLike {
  isError?: boolean;
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
}

const ICONS: Record<Category, string> = {
  produce: "🥬",
  dairy: "🥛",
  meat_seafood: "🍗",
  bakery: "🍞",
  pantry: "🥫",
  frozen: "🧊",
  beverages: "🧃",
  household: "🧽",
  personal_care: "🧴",
  medicine: "💊",
  pet: "🐾",
};

const contentEl = document.getElementById("content")!;
const toastEl = document.getElementById("toast")!;
const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];

let state: BoardState | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const app = new App({ name: "HomeStock Board", version: "0.1.0" });

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const pretty = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function spokenText(result: ToolResultLike): string {
  return result.content?.find((c) => c.type === "text")?.text ?? "";
}

function quantity(i: { quantity: number; unit: string }): string {
  const q = Number.isInteger(i.quantity) ? i.quantity : i.quantity.toFixed(1);
  return i.unit === "item" ? `×${q}` : `${q} ${i.unit}`;
}

function expiryBadge(item: Item): string {
  if (item.daysLeft === null) return "";
  const d = item.daysLeft;
  const tone = d < 0 ? "danger" : d <= 2 ? "warn" : "ok";
  const label = d < 0 ? `Expired ${-d}d ago` : d === 0 ? "Today" : d === 1 ? "Tomorrow" : `${d} days`;
  const estimated = item.expiryEstimated ? ` title="Estimated from typical shelf life"` : "";
  return `<span class="badge ${tone}"${estimated}>${label}${item.expiryEstimated ? " ≈" : ""}</span>`;
}

function itemCard(item: Item, actions: boolean): string {
  const name = escape(item.name);
  return `
    <article class="card">
      <span class="icon" aria-hidden="true">${ICONS[item.category]}</span>
      <div class="body">
        <h3>${name}</h3>
        <p class="meta">${escape(quantity(item))} · ${pretty(item.location)}</p>
      </div>
      ${expiryBadge(item)}
      ${
        actions
          ? `<div class="actions">
              <button data-action="use" data-name="${name}" data-outcome="finished">Used it</button>
              <button class="secondary" data-action="use" data-name="${name}" data-outcome="discarded">Tossed</button>
            </div>`
          : ""
      }
    </article>`;
}

function renderInventory(items: Item[]): string {
  if (!items.length) return `<p class="empty">Nothing tracked yet. Try “Alexa, I bought eggs and milk.”</p>`;
  const groups = new Map<Location, Item[]>();
  for (const item of items) groups.set(item.location, [...(groups.get(item.location) ?? []), item]);
  return [...groups]
    .map(([location, group]) => `<h2>${pretty(location)}</h2><div class="grid">${group.map((i) => itemCard(i, false)).join("")}</div>`)
    .join("");
}

function renderExpiring(items: Item[], withinDays: number): string {
  if (!items.length) return `<p class="empty">Nothing expires in the next ${withinDays} days. 🎉</p>`;
  return `<h2>Use these first</h2><div class="grid">${items.map((i) => itemCard(i, true)).join("")}</div>`;
}

function renderRestock(suggestions: RestockSuggestion[], todayIso: string): string {
  if (!suggestions.length) return `<p class="empty">Nothing is running low this week.</p>`;
  const cards = suggestions.map((s) => {
    const name = escape(s.name);
    const when =
      s.reason === "out_of_stock"
        ? "Out of stock"
        : (() => {
            const days = Math.round((Date.parse(s.predictedOn!) - Date.parse(todayIso)) / 86_400_000);
            return days <= 0 ? "Runs out today" : `Runs out in ${days} day${days === 1 ? "" : "s"}`;
          })();
    const cadence = s.avgDaysBetweenPurchases ? `Bought every ~${Math.round(s.avgDaysBetweenPurchases)} days` : "";
    return `
      <article class="card">
        <span class="icon" aria-hidden="true">${ICONS[s.category]}</span>
        <div class="body">
          <h3>${name}</h3>
          <p class="meta">${cadence}</p>
        </div>
        <span class="badge ${s.reason === "out_of_stock" ? "danger" : "warn"}">${when}</span>
        <div class="actions">
          ${
            s.onShoppingList
              ? `<button class="secondary" disabled>On your list ✓</button>`
              : `<button data-action="add-to-list" data-name="${name}">Add to list</button>`
          }
        </div>
      </article>`;
  });
  return `<h2>Running low</h2><div class="grid">${cards.join("")}</div>`;
}

function renderShopping(items: ShoppingEntry[]): string {
  if (!items.length) return `<p class="empty">Your shopping list is empty.</p>`;
  const rows = items.map((i) => {
    const name = escape(i.name);
    return `
      <li class="row">
        <div class="body">
          <h3>${name} <span class="qty">${escape(quantity(i))}</span></h3>
          ${i.reason ? `<p class="meta">${escape(i.reason)}</p>` : ""}
        </div>
        <button class="secondary" data-action="remove" data-name="${name}">Remove</button>
      </li>`;
  });
  return `<h2>Shopping list</h2><ul class="list">${rows.join("")}</ul>`;
}

function render(next: BoardState) {
  state = next;
  for (const tab of tabs) tab.setAttribute("aria-current", String(tab.dataset.view === next.view));
  switch (next.view) {
    case "inventory":
      contentEl.innerHTML = renderInventory(next.items);
      break;
    case "expiring":
      contentEl.innerHTML = renderExpiring(next.items, next.withinDays);
      break;
    case "restock":
      contentEl.innerHTML = renderRestock(next.suggestions, next.today);
      break;
    case "shopping":
      contentEl.innerHTML = renderShopping(next.items);
      break;
  }
}

function showToast(text: string, action?: { label: string; run: () => Promise<void> }) {
  if (!text) return;
  toastEl.replaceChildren(text);
  if (action) {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      await action.run();
      toastEl.hidden = true;
    });
    toastEl.append(button);
  }
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  // An offer to act stays up longer than a plain confirmation.
  toastTimer = setTimeout(() => (toastEl.hidden = true), action ? 12_000 : 4000);
}

function applyResult(result: ToolResultLike) {
  const data = result.structuredContent as BoardState | undefined;
  if (data && "view" in data) render(data);
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResultLike> {
  const result = (await app.callServerTool({ name, arguments: args })) as ToolResultLike;
  if (result.isError) showToast(spokenText(result) || "Something went wrong.");
  return result;
}

const VIEW_TOOLS: Record<BoardState["view"], string> = {
  inventory: "get_inventory",
  expiring: "get_expiring",
  restock: "get_restock_forecast",
  shopping: "get_shopping_list",
};

async function refresh() {
  if (state) applyResult(await callTool(VIEW_TOOLS[state.view]));
}

/** Keeps the assistant aware of taps so a follow-up like "what else?" has context. */
async function tellModel(text: string) {
  try {
    await app.updateModelContext({ content: [{ type: "text", text }] });
  } catch {
    // Hosts without updateModelContext support still get the visual update.
  }
}

document.addEventListener("click", async (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!target || target.disabled) return;
  target.disabled = true;
  try {
    if (target.dataset.tool) {
      applyResult(await callTool(target.dataset.tool));
      return;
    }
    const name = target.dataset.name!;
    let result: ToolResultLike | undefined;
    switch (target.dataset.action) {
      case "use":
        result = await callTool("use_item", { name, outcome: target.dataset.outcome });
        break;
      case "add-to-list":
        result = await callTool("add_to_shopping_list", { items: [{ name, reason: "Running low" }] });
        break;
      case "remove":
        result = await callTool("remove_from_shopping_list", { name });
        break;
    }
    if (result && !result.isError) {
      const text = spokenText(result);
      // Running out by using or tossing the last one offers a one-tap way to put it on the list.
      const outOfStock = (result.structuredContent as { restockSuggested?: boolean } | undefined)?.restockSuggested;
      showToast(
        text,
        outOfStock
          ? {
              label: "Add to list",
              run: async () => {
                await callTool("add_to_shopping_list", { items: [{ name, reason: "Ran out" }] });
                await tellModel(`On the HomeStock screen the customer added ${name} to the shopping list.`);
                await refresh();
              },
            }
          : undefined,
      );
      await tellModel(`On the HomeStock screen the customer tapped: ${text}`);
      await refresh();
    }
  } catch (err) {
    console.error(err);
    showToast("Couldn't reach HomeStock. Try again.");
  } finally {
    target.disabled = false;
  }
});

function handleHostContext(ctx: McpUiHostContext) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
}

app.ontoolresult = (result) => applyResult(result as ToolResultLike);
app.onhostcontextchanged = handleHostContext;
app.onteardown = async () => ({});
app.onerror = console.error;

await app.connect();
const ctx = app.getHostContext();
if (ctx) handleHostContext(ctx);
