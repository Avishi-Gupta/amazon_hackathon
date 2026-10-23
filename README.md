# HomeStock

**An Alexa+ add-on that knows what's in your home — and what's about to run out or go off.**

HomeStock is a self-hosted [Model Context Protocol](https://modelcontextprotocol.io) server (spec **2025-11-25**, Streamable HTTP) built for the Alexa+ track of the Build, Ship, Shape Amazon Developer Hackathon. It tracks every *consumable* in a household — groceries, cleaning supplies, toiletries, medicine, pet supplies — with expiry dates and purchase history, and renders an interactive Echo Show board through the [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) extension.

> "Alexa, what should I use up?"
> *"Ibuprofen and greek yogurt have expired. Use soon: spinach today, chicken thighs tomorrow, milk tomorrow, bread in 2 days and tomatoes in 3 days."*

## What it does

| Capability | How |
| --- | --- |
| **Hands-free intake** | "I bought eggs, milk and dishwasher tablets" → category, storage location and a shelf-life–based expiry are inferred when not spoken. |
| **Expiry awareness** | Soonest-expiring first, including expired medicine in the cabinet. |
| **Run-out prediction** | Learns each product's purchase cadence and predicts when staples run out — before you notice. |
| **Consumption & waste log** | "We finished the milk" / "I threw out the spinach" — FIFO against the soonest-expiring stock. Running out either way offers the item for the shopping list, by voice or a one-tap button on the board. |
| **Shopping list** | Suggests restocks, never adds without consent, and auto-crosses items off when you buy them. |
| **Photo intake** | Snap a receipt or the groceries on the counter; Amazon Nova reads it, expands receipt shorthand ("ORG BAN" → bananas, "SKIM MLK 1L x2" → 2 milk) and files everything with inferred shelf lives. |
| **Multilingual** | Ask in English, Mandarin, Malay or Hindi and get answers in the same language, while product names are stored in English so one household's inventory stays consistent across languages. |
| **Echo Show board (MCP App)** | Large, touch-first views for *Use soon*, *Running low*, *Shopping list* and *Everything*. Taps call tools and keep the assistant's context in sync. |

Every tool returns **voice-ready plain text** (no markdown or pipes, per Alexa+ tool design guidance) plus typed `structuredContent` that matches a declared `outputSchema`.

## Architecture

```
Alexa+ / any MCP Apps host
        │  Streamable HTTP (POST /mcp), protocol 2025-11-25
        ▼
src/main.ts ── Express + NodeStreamableHTTPServerTransport (stateless)
        │
src/server.ts ── 8 tools + ui://homestock/board.html resource
        │
src/domain/ ── InventoryStore (SQLite via node:sqlite), shelf-life rules, forecast
        │
ui/ ── Echo Show board (vanilla TS, bundled to a single HTML file)
```

### Tools

| Tool | Kind | Purpose |
| --- | --- | --- |
| `add_items` | write | Record purchases; infer category/location/expiry; clear matching list entries |
| `use_item` | write | Log used / finished / discarded; suggests restock for regular purchases |
| `get_inventory` | read · UI | What's at home, filterable by category, location or name |
| `get_expiring` | read · UI | Expired and soon-to-expire items |
| `get_restock_forecast` | read · UI | Out-of-stock staples and predicted run-outs |
| `get_shopping_list` | read · UI | Current list |
| `add_to_shopping_list` | write | Add with consent; merges quantities |
| `remove_from_shopping_list` | write | Remove entries |

## Quick start

Requires **Node.js 24+** (uses the built-in `node:sqlite`).

```bash
npm install
npm run build:ui     # bundle the Echo Show board
npm run seed         # load a realistic demo household
npm start            # http://127.0.0.1:3001/mcp
```

In a second terminal, run the end-to-end check (it modifies demo data — run `npm run seed` again afterwards):

```bash
npm run smoke
```

For development, `npm run dev` rebuilds the UI and restarts the server on change.

### Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` behind a tunnel or load balancer. |
| `ALLOWED_HOSTS` | — | Comma-separated Host header allowlist (e.g. your tunnel hostname) |
| `HOMESTOCK_DB` | `data/homestock.db` | SQLite file (`:memory:` for ephemeral) |
| `HOMESTOCK_HOUSEHOLD` | `demo` | Household id |
| `HOMESTOCK_TZ` | server local | IANA timezone used for "today" |
| `HOMESTOCK_TODAY` | — | Pin today's date (YYYY-MM-DD) for reproducible demos |

## Connecting a host

- **Alexa+ MCP Toolkit:** the server speaks Streamable HTTP on the 2025-11-25 spec and uses the MCP Apps extension, which Alexa+ supports. Expose it over HTTPS (for local development, e.g. `cloudflared tunnel --url http://127.0.0.1:3001`, then set `HOST=0.0.0.0` and `ALLOWED_HOSTS=<tunnel host>`) and register the `/mcp` URL as an add-on. OAuth 2.1, which Alexa+ requires for production, is on the roadmap below.
- **Other MCP Apps hosts** (Claude, VS Code Copilot, Goose, MCPJam…): add `http://127.0.0.1:3001/mcp` as a remote MCP server.

## Alexa+ Echo Show simulator

Because Alexa+ MCP Toolkit access is currently partner-gated, the repo includes a simulated Alexa+ experience that exercises the add-on the same way Alexa+ does:

```
Browser (Echo Show frame, voice in/out)
   │  POST /api/converse                      ▲ board rendered via MCP Apps AppBridge
   ▼                                          │ (sandboxed iframe on a second origin)
src/simulator/server.ts ── HomeStockAgent ────┘
   │  Amazon Bedrock Converse API (model-agnostic; Amazon Nova Pro by default)
   ▼  MCP tools over Streamable HTTP
HomeStock MCP server (npm start)
```

- **Voice**: speak with the mic button (Web Speech API in Chrome/Edge — the browser's speech service processes the audio) or type. Replies are read aloud with `speechSynthesis`.
- **Camera**: the 📷 button sends a receipt or grocery photo to `/api/photo`, which hands it to Nova's vision input and lets the model call `add_items` with what it reads.
- **Agent**: `src/agent/agent.ts` lists HomeStock's MCP tools, lets Claude pick and chain them, and returns the spoken reply plus every tool call.
- **Screen**: the last UI-linked tool call is rendered as the add-on's MCP App; taps on the board flow back to the agent as conversation context (`updateModelContext`).

### Running it

1. Configure AWS credentials (`aws configure` or an `AWS_PROFILE`) for an account with Amazon Bedrock access.
2. Build and start:

```bash
npm run build
npm start
```

In a second terminal:

```bash
npm run simulator
```

3. Open http://127.0.0.1:8080.

| Variable | Default | Description |
| --- | --- | --- |
| `AWS_REGION` | `ap-southeast-1` | Bedrock region |
| `BEDROCK_MODEL` | `apac.amazon.nova-pro-v1:0` | Any tool-capable Bedrock model or inference profile |
| `DEBUG_AGENT` | unset | Set to `1` to log each model turn's stop reason and content |
| `MCP_URL` | `http://127.0.0.1:3001/mcp` | HomeStock MCP endpoint |
| `SIMULATOR_PORT` / `SANDBOX_PORT` | `8080` / `8081` | Host page and sandbox-proxy origins |

## Roadmap

- [x] Simulated Alexa+ Echo Show client (voice in, board rendered through MCP Apps)
- [x] Receipt / grocery-haul photo intake with Amazon Bedrock vision
- [x] Multilingual conversation with English-normalised product names
- [ ] "Cook before it spoils" recipe suggestions and step-by-step cook mode
- [ ] OAuth 2.1 (client credentials + authorization code with PKCE) for Alexa+ account linking
- [ ] Hosted deployment (see [DEPLOY.md](DEPLOY.md) § 7)

## Deploying

Step-by-step setup, configuration, public exposure via tunnel, and troubleshooting: **[DEPLOY.md](DEPLOY.md)**.

## Friction log

Developer friction encountered while building is tracked in [FRICTION_LOG.md](FRICTION_LOG.md).

## License

[MIT](LICENSE)
