# HomeStock

**An Alexa+ add-on that knows what's in a home — and what's about to run out or go off.**

HomeStock is a self-hosted [Model Context Protocol](https://modelcontextprotocol.io) server (spec **2025-11-25**, Streamable HTTP) built for the Alexa+ track of the Build, Ship, Shape Amazon Developer Hackathon. It tracks every *consumable* in a household — groceries, cleaning supplies, toiletries, medicine, pet supplies — with expiry dates and purchase history, and renders an interactive Echo Show board through the [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) extension.

> "Alexa, what should I use up?"
> *"Ibuprofen and greek yogurt have expired. Use soon: spinach today, chicken thighs tomorrow, milk tomorrow, bread in 2 days and tomatoes in 3 days."*

## What it does

| Capability | How |
| --- | --- |
| **Hands-free intake** | "I bought eggs, milk and dishwasher tablets" → category, storage location and a shelf-life–based expiry are inferred when not spoken. |
| **Expiry awareness** | Soonest-expiring first, including expired medicine in the cabinet. |
| **Run-out prediction** | Learns each product's purchase cadence and predicts when staples run out — before anyone notices. |
| **Consumption & waste log** | "We finished the milk" / "I threw out the spinach" — FIFO against the soonest-expiring stock. Running out either way offers the item for the shopping list, by voice or a one-tap button on the board. |
| **Shopping list** | Suggests restocks, never adds without consent, and auto-crosses items off when they're bought. |
| **Meal suggestions** | "What can I cook with what's expiring?" answers from real stock, built around the items closest to spoiling, and never invents an ingredient the inventory doesn't hold. |
| **Photo intake** | A photo of a receipt or the groceries on the counter is read by Amazon Nova, which expands receipt shorthand ("ORG BAN" → bananas, "SKIM MLK 1L x2" → 2 milk) and files everything with inferred shelf lives. |
| **Multilingual** | Questions in English, Mandarin, Malay or Hindi are answered in the same language, while product names are stored in English so one household's inventory stays consistent across languages. |
| **Echo Show board (MCP App)** | Large, touch-first views for *Use soon*, *Running low*, *Shopping list* and *Everything*. Taps call tools and keep the assistant's context in sync. |

Every tool returns **voice-ready plain text** (no markdown or pipes, per Alexa+ tool design guidance) plus typed `structuredContent` matching a declared `outputSchema`.

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
| `use_item` | write | Log used / finished / discarded; offer a restock when the last one goes |
| `get_inventory` | read · UI | What's at home, filterable by category, location or name |
| `get_expiring` | read · UI | Expired and soon-to-expire items |
| `get_restock_forecast` | read · UI | Out-of-stock staples and predicted run-outs |
| `get_shopping_list` | read · UI | Current list |
| `add_to_shopping_list` | write | Add with consent; merges quantities |
| `remove_from_shopping_list` | write | Remove entries |

## Requirements

- **Node.js 24+** — the storage layer uses the built-in `node:sqlite` module (`node -v` to check).
- **AWS credentials with Amazon Bedrock access** — only for the simulator. The MCP server itself needs no cloud account.
- **Chrome or Edge** — for the simulator's microphone, which uses the Web Speech API. Typing works in any browser.

## Quick start

```bash
npm install
```

```bash
npm run build
```

`npm run build` produces `dist/ui/board.html` (the Echo Show board, bundled into one self-contained file the server returns as a `ui://` resource) and `dist/simulator/` (the simulator page). Re-run it after changing anything under `ui/` or `simulator/`.

Load a realistic demo household — 16 items, several expiring, months of purchase history:

```bash
npm run seed
```

Start the MCP server, which listens on `http://127.0.0.1:3001/mcp`:

```bash
npm start
```

That alone is the complete add-on, ready for an MCP host to connect to. To drive it through the bundled Alexa+ simulator, start this in a second terminal and open **http://127.0.0.1:8080**:

```bash
npm run simulator
```

Stop either process with Ctrl+C. During development, `npm run dev` rebuilds the UI and restarts the server on change.

## Verifying

Server health:

```bash
curl -s http://127.0.0.1:3001/healthz
```

Full MCP conformance check — initialize, `tools/list`, `resources/read`, every tool, and error handling. It modifies demo data, so re-run `npm run seed` afterwards:

```bash
npm run smoke
```

All 13 checks should print `PASS`.

## Configuration

Every variable is optional; the defaults are what the demo runs on.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | MCP server port |
| `HOST` | `127.0.0.1` | MCP bind address; use `0.0.0.0` behind a tunnel or load balancer |
| `ALLOWED_HOSTS` | — | Comma-separated Host header allowlist (e.g. a tunnel hostname) |
| `HOMESTOCK_DB` | `data/homestock.db` | SQLite file; `:memory:` for ephemeral storage |
| `HOMESTOCK_HOUSEHOLD` | `demo` | Household id — separate inventories within one database |
| `HOMESTOCK_TZ` | system zone | IANA timezone used to decide "today" |
| `HOMESTOCK_TODAY` | — | Pin today's date (`YYYY-MM-DD`) for reproducible demos |
| `SIMULATOR_PORT` / `SANDBOX_PORT` | `8080` / `8081` | Simulator page and sandbox-proxy origins |
| `MCP_URL` | `http://127.0.0.1:3001/mcp` | Where the simulator looks for the MCP server |
| `AWS_REGION` | `ap-southeast-1` | Bedrock region |
| `BEDROCK_MODEL` | `apac.amazon.nova-pro-v1:0` | Any tool-capable Bedrock model or inference profile |
| `DEBUG_AGENT` | — | Set to `1` to log each model turn's stop reason and content |

## Connecting a host

**Alexa+ MCP Toolkit.** The server speaks Streamable HTTP on the 2025-11-25 spec and uses the MCP Apps extension, both of which Alexa+ supports. It needs a public HTTPS endpoint; a tunnel is the quickest route:

```bash
cloudflared tunnel --url http://127.0.0.1:3001
```

Restart the server so it accepts the tunnel hostname, then register `https://<tunnel-host>/mcp` as an add-on:

```bash
HOST=0.0.0.0 ALLOWED_HOSTS=<tunnel-host> npm start
```

Note that the endpoint is unauthenticated. Alexa+ requires OAuth 2.1 (client credentials plus authorization code with PKCE) before certification; that is not implemented here.

**Any other MCP Apps host** (Claude, VS Code Copilot, Goose, MCPJam): add `http://127.0.0.1:3001/mcp` as a remote MCP server.

## The Alexa+ simulator

Alexa+ MCP Toolkit access is currently partner-gated, so this repo includes a simulated Alexa+ experience that exercises the add-on the same way Alexa+ would — a path the hackathon rules explicitly permit.

```
Browser (Echo Show frame, voice in/out)
   │  POST /api/converse                      ▲ board rendered via MCP Apps AppBridge
   ▼                                          │ (sandboxed iframe on a second origin)
src/simulator/server.ts ── HomeStockAgent ────┘
   │  Amazon Bedrock Converse API (model-agnostic; Amazon Nova Pro by default)
   ▼  MCP tools over Streamable HTTP
HomeStock MCP server (npm start)
```

- **Agent**: `src/agent/agent.ts` fetches HomeStock's tools over MCP, lets the model choose and chain them, and returns the spoken reply plus every tool call made. The model is one environment variable; nothing in the code is Nova-specific.
- **Voice**: the microphone button uses the Web Speech API for recognition (the browser's speech service processes the audio); replies are spoken with `speechSynthesis`, which picks the best installed voice for the reply's language.
- **Camera**: the 📷 button posts a photo to `/api/photo`, which passes it to the model's vision input and lets it call `add_items` with whatever it reads.
- **Screen**: the most recent UI-linked tool result is rendered as the add-on's MCP App inside a double-sandboxed iframe, matching the MCP Apps security model. Taps on the board flow back into the conversation through `updateModelContext`, so a follow-up question knows what was just pressed.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `UI bundle not found … Run "npm run build:ui" first` | The board isn't built. Run `npm run build`. |
| Simulator reports the add-on is offline | The MCP server isn't running, or `MCP_URL` points elsewhere. |
| Blank board in the simulator | Port 8081 (the sandbox origin) is blocked or in use. Check with `lsof -i :8080 -i :8081`. |
| `AccessDeniedException … is not available for this account` | No Bedrock model agreement for that model. Check with `aws bedrock get-foundation-model-availability --model-id amazon.nova-pro-v1:0 --region ap-southeast-1`; `agreementAvailability` must be `AVAILABLE`. Set `BEDROCK_MODEL` to switch models. |
| Agent replies "Done." with nothing useful | The model returned an empty turn — see FRICTION_LOG F-005. Tool results must be a single text block. |
| Microphone button disabled | The browser lacks Web Speech API support. Use Chrome or Edge, or type instead. |

## Project layout

```
src/domain/     inventory store, shelf-life rules, restock forecast, demo seed
src/server.ts   the 8 MCP tools and the ui:// board resource
src/main.ts     Streamable HTTP entry point
src/agent/      Bedrock Converse agent used by the simulator
src/simulator/  simulator web server and sandbox origin
ui/             Echo Show board (MCP App)
simulator/      simulator page: device frame, microphone, transcript
scripts/        MCP conformance smoke test
```

## Not implemented

- **OAuth 2.1**: required by Alexa+ for certification. The server is unauthenticated.
- **Tested against production Alexa+**: toolkit access is partner-gated, hence the simulator.
- **Hosted deployment**: runs locally. The MCP server is a stateless Node process and containerises easily, but state lives in a SQLite file on local disk, so an ephemeral host needs persistent storage or a different `InventoryStore` backend.

## Friction log

Developer friction encountered while building — with steps, expected versus actual behaviour, severity, workarounds and suggestions — is recorded in [FRICTION_LOG.md](FRICTION_LOG.md).

## License

[MIT](LICENSE)
