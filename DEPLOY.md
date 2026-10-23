# Deploying HomeStock

Everything here has been run end to end on macOS with Node 24. Commands assume you start from the project root.

```bash
cd ~/Documents/amazon_hackathon
```

---

## 1. Prerequisites

| Requirement | Check it | If missing |
| --- | --- | --- |
| Node.js 24+ | `node -v` | `brew install node` |
| AWS credentials | `aws sts get-caller-identity` | `aws configure` (region `ap-southeast-1`) |
| Bedrock model access | step 4 below | see **Troubleshooting → model access** |

Only the simulator needs AWS. The MCP server — the actual hackathon submission — runs with no cloud account at all.

---

## 2. Install and build

```bash
npm install
```

```bash
npm run build
```

`npm run build` produces two things: `dist/ui/board.html` (the Echo Show board, bundled into one self-contained file the MCP server serves as a `ui://` resource) and `dist/simulator/` (the simulator web page). **Re-run it after any change under `ui/` or `simulator/`.**

Load the demo household — 16 items, some expiring, months of purchase history:

```bash
npm run seed
```

Re-run `npm run seed` any time to reset to a clean demo state. It rebuilds the dates relative to today, so the demo always has something expiring "today" and "tomorrow".

---

## 3. Run

Two processes, two terminal tabs.

**Tab 1 — MCP server** (port 3001):

```bash
npm start
```

**Tab 2 — simulator** (ports 8080 and 8081):

```bash
npm run simulator
```

Open **http://127.0.0.1:8080** in Chrome or Edge. Voice input uses the Web Speech API, which Safari and Firefox don't support; typing works everywhere.

Stop either with **Ctrl+C**. If a process is orphaned:

```bash
pkill -f "tsx src/main.ts"; pkill -f "tsx src/simulator/server.ts"
```

---

## 4. Verify

Server alive:

```bash
curl -s http://127.0.0.1:3001/healthz
```

Full MCP conformance test — initialize, tools/list, resources/read, every tool, error handling (**modifies demo data; re-run `npm run seed` afterwards**):

```bash
npm run smoke
```

All 13 checks should print `PASS`.

Agent and Bedrock working:

```bash
curl -s -X POST http://127.0.0.1:8080/api/converse -H 'content-type: application/json' -d '{"sessionId":"11111111-2222-4333-8444-555555555555","text":"What should I use up?"}'
```

Set `DEBUG_AGENT=1` before `npm run simulator` to log each model turn's stop reason and content.

---

## 5. Configuration

All optional — the defaults are what the demo runs on.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | MCP server port |
| `HOST` | `127.0.0.1` | MCP bind address; `0.0.0.0` behind a tunnel |
| `ALLOWED_HOSTS` | — | Comma-separated Host header allowlist (your tunnel hostname) |
| `HOMESTOCK_DB` | `data/homestock.db` | SQLite file; `:memory:` for ephemeral |
| `HOMESTOCK_HOUSEHOLD` | `demo` | Household id — separate inventories in one database |
| `HOMESTOCK_TZ` | system | IANA timezone for "today" |
| `HOMESTOCK_TODAY` | — | Pin today's date (`YYYY-MM-DD`) for reproducible demos |
| `SIMULATOR_PORT` / `SANDBOX_PORT` | `8080` / `8081` | Simulator and sandbox origins |
| `MCP_URL` | `http://127.0.0.1:3001/mcp` | Where the simulator finds the MCP server |
| `AWS_REGION` | `ap-southeast-1` | Bedrock region |
| `BEDROCK_MODEL` | `apac.amazon.nova-pro-v1:0` | Any tool-capable Bedrock model or inference profile |
| `DEBUG_AGENT` | — | `1` to log model turns |

**Pinning the date for a demo recording** keeps "expires today" accurate no matter when you film:

```bash
HOMESTOCK_TODAY=2026-10-23 npm start
```

---

## 6. Exposing it publicly (for real Alexa+, or remote judges)

Alexa+ requires a public HTTPS endpoint. A tunnel is the fastest route:

```bash
brew install cloudflared
```

```bash
cloudflared tunnel --url http://127.0.0.1:3001
```

It prints a `https://<random>.trycloudflare.com` URL. Restart the MCP server so it accepts that hostname:

```bash
HOST=0.0.0.0 ALLOWED_HOSTS=<random>.trycloudflare.com npm start
```

Your MCP endpoint is then `https://<random>.trycloudflare.com/mcp`.

**Two caveats.** The tunnel URL changes every restart, and the endpoint is unauthenticated — fine for a judging window, not for anything lasting. Alexa+ also requires OAuth 2.1 (client credentials plus authorization code with PKCE) before certification; that is not implemented.

---

## 7. Deploying to a server (optional)

Nothing requires this — judges run from the repo. If you want it hosted:

**What travels well:** the MCP server is a single stateless Node process; any container host runs it.

**What to watch:** state lives in a SQLite file on local disk. On an ephemeral host (App Runner, Fargate without storage) the inventory resets on every deploy. Either mount persistent storage, or swap `InventoryStore` for DynamoDB — it's the only file that touches storage, and the interface is small.

Sketch for AWS App Runner:
1. Add a `Dockerfile` based on `node:24-slim`: copy the repo, `npm ci`, `npm run build`, `CMD ["npm", "start"]`.
2. Push to ECR, create an App Runner service from that image, port 3001.
3. Set `HOST=0.0.0.0` and `ALLOWED_HOSTS=<your-apprunner-domain>`.
4. Give the service an IAM role with `bedrock:InvokeModel` only if you deploy the simulator too.

---

## Troubleshooting

**`AccessDeniedException … is not available for this account`** — Bedrock model access. Check it:

```bash
aws bedrock get-foundation-model-availability --model-id amazon.nova-pro-v1:0 --region ap-southeast-1
```

`agreementAvailability: AVAILABLE` means good. `NOT_AVAILABLE` means the account has no Marketplace agreement for that model. Anthropic Claude models on this account are stuck in that state — see FRICTION_LOG F-004 — which is why the default model is Amazon Nova Pro. To switch models, set `BEDROCK_MODEL`; no code changes.

**`UI bundle not found … Run "npm run build:ui" first`** — the board isn't built. Run `npm run build`.

**Simulator says it can't reach the MCP server** — tab 1 isn't running, or `MCP_URL` points elsewhere.

**Blank board in the simulator** — the sandbox origin (8081) is blocked or the port is taken. Check both ports are free: `lsof -i :8080 -i :8081`.

**Agent replies "Done." with no answer** — the model returned an empty turn. See FRICTION_LOG F-005; tool results must be a single text block.

**Voice button greyed out** — not Chrome or Edge. Type instead.

---

## Cost

Bedrock bills per token, with no idle cost — servers can sit running for free. Nova Pro at this prompt size is a fraction of a cent per question; all development and testing to date came to well under a dollar. Check actual spend in the AWS console under Billing → Bills (Bedrock line item).
