// End-to-end check against a running server over Streamable HTTP.
// Usage: npm start (in another terminal), then npm run smoke. Mutates the demo household; re-run npm run seed afterwards.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const url = new URL(process.env.MCP_URL ?? "http://127.0.0.1:3001/mcp");
const client = new Client({ name: "homestock-smoke", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(url);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

type Result = Awaited<ReturnType<typeof client.callTool>>;
const spoken = (r: Result) =>
  (r.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text ?? "";

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  check(`${name}`, !result.isError && result.structuredContent !== undefined, spoken(result));
  return result;
}

await client.connect(transport);
const negotiated = (transport as unknown as { protocolVersion?: string }).protocolVersion;
check("initialize", true, `server ${JSON.stringify(client.getServerVersion())}, protocol ${negotiated ?? "unknown"}`);

const { tools } = await client.listTools();
const expected = [
  "add_items",
  "use_item",
  "get_inventory",
  "get_expiring",
  "get_restock_forecast",
  "get_shopping_list",
  "add_to_shopping_list",
  "remove_from_shopping_list",
];
check("tools/list", expected.every((n) => tools.some((t) => t.name === n)), tools.map((t) => t.name).join(", "));

const board = tools.find((t) => t.name === "get_expiring");
const uri = (board?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri;
check("get_expiring links a UI resource", uri === "ui://homestock/board.html", String(uri));

const resource = await client.readResource({ uri: uri! });
const html = (resource.contents[0] as { text?: string; mimeType?: string }) ?? {};
check("resources/read board", (html.text?.length ?? 0) > 1000 && html.mimeType === "text/html;profile=mcp-app", `${html.text?.length} chars, ${html.mimeType}`);

await call("get_expiring", { withinDays: 3 });
await call("get_restock_forecast");
await call("get_inventory", { search: "milk" });
await call("add_items", { items: [{ name: "free range bananas", quantity: 6 }, { name: "dish soap" }] });
await call("use_item", { name: "spinach", outcome: "discarded" });
await call("use_item", { name: "eggs", amount: 2 });
await call("add_to_shopping_list", { items: [{ name: "coffee beans", reason: "Out of stock" }] });
await call("get_shopping_list");

const missing = await client.callTool({ name: "use_item", arguments: { name: "unicorn steak" } });
check("use_item unknown product returns an error", missing.isError === true, spoken(missing));

await client.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
