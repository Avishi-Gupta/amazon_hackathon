# Submission pack

Deadline: **Friday 23 October 2026, 12:00 pm Pacific** (3:00 am Saturday, Singapore time).

Draft material for the Devpost form. Everything below describes what the code actually does today — check anything you change before pasting.

---

## Order of work

1. **Publish the repo** (~10 min) — nothing else matters if judges can't see the code.
2. **Record the video** (~45 min including retakes) — required, and the thing judges actually watch.
3. **Fill the Devpost form** (~30 min) — drafts below.
4. **Open-source mini challenge** (~20 min, optional) — a separate contribution.

---

## 1. Publishing the repo

Create an **empty public** repo on GitHub (no README, no .gitignore, no licence — the repo already has them), then:

```bash
cd ~/Documents/amazon_hackathon
```

```bash
git add -A && git commit -m "HomeStock: Alexa+ MCP add-on for home consumables"
```

```bash
git remote add origin https://github.com/<you>/<repo>.git && git branch -M main && git push -u origin main
```

**Then check:** the repo page's **About** panel shows "MIT licence". The rules require a detectable licence there. `LICENSE` is already in place, so GitHub should pick it up automatically.

**Before pushing, confirm no secrets:** `.gitignore` already excludes `data/`, `.env` and `node_modules/`. AWS credentials live in `~/.aws/`, outside the project, so they can't be committed. Worth a glance at `git status` anyway.

---

## 2. Video (under 3 minutes)

Judges stop watching at three minutes. Shot list, roughly 20 seconds each:

1. **The problem**, spoken over the idle Echo Show screen: food gets forgotten at the back of the fridge, detergent runs out mid-wash.
2. **"What should I use up?"** — spoken aloud. Show the board filling with expiring items. This is the core loop.
3. **Tap "Used it"** on an item. Show the board updating. Point out that touch and voice share one state.
4. **"We finished the milk."** Then **"What do I need to buy?"** — milk now appears as out of stock. This shows memory, which separates it from a Q&A bot.
5. **Photo scan.** Point the camera at a receipt, show the items landing with inferred expiry dates. The strongest moment — lead with it if you cut anything.
6. **Ask in another language** (Mandarin or Malay) and get an answer back in that language. Say that product names are stored in English so one household shares one inventory.
7. **Close on the architecture:** a standards-compliant MCP server, spec 2025-11-25 over Streamable HTTP, with the Echo Show board as an MCP App; the simulator stands in for Alexa+ because toolkit access is partner-gated.

**Setup for filming:** run `npm run seed` first so dates are fresh, maximise the browser window so the board gets room, and test your microphone once before the real take. Pin the date with `HOMESTOCK_TODAY=2026-10-23` if you re-record across midnight.

**Say out loud that the simulator is a simulator.** The rules explicitly permit it; pretending otherwise would be the problem.

---

## 3. Devpost form

**Track:** Alexa+
**Mini challenges:** AWS Builder (Amazon Bedrock). Open Source only if you complete step 4.

### Description (draft)

> HomeStock is an Alexa+ add-on that tracks every consumable in a home — groceries, cleaning supplies, toiletries, medicine, pet food — and knows two things no shopping-list app does: when each item expires, and how fast the household actually gets through it.
>
> Say "what should I use up?" and it answers from what's really in the fridge, soonest-expiring first. Say "we finished the milk" and it logs it; because it has watched you buy milk every six days for months, it tells you two days ahead that you're about to run out. Photograph a receipt and it reads the shorthand — "ORG BAN" becomes bananas, "SKIM MLK 1L x2" becomes two milk — files each item with an estimated shelf life, and crosses matching entries off your shopping list. Ask in Mandarin, Malay or Hindi and it answers in the same language, while storing product names in English so a multilingual household shares one inventory.
>
> It is a self-hosted MCP server implementing spec 2025-11-25 over Streamable HTTP, with eight tools and an Echo Show board built as an MCP App — a touch surface where "Used it" and "Add to list" call the same tools the voice path uses, and taps feed back into the conversation so a follow-up question knows what you just pressed. Every tool returns voice-ready plain text alongside a typed structured payload.
>
> Because Alexa+ MCP Toolkit access is partner-gated, the repo ships a simulated Alexa+ Echo Show client: voice in, voice out, the add-on's real MCP App rendered in a sandboxed frame, driven by an agent running Amazon Nova Pro on Amazon Bedrock through the Converse API. The agent is model-agnostic — the Bedrock model is one environment variable.

### Product feedback (required)

**Which developer tools, APIs and SDKs did you use, and for what?**

> MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, `/node`, `/express`, `/client`) for the server, Streamable HTTP transport and the test client. `@modelcontextprotocol/ext-apps` v2 for the MCP Apps extension — `registerAppTool`/`registerAppResource` on the server side, `App` in the view, `AppBridge` in the simulated host. Amazon Bedrock Converse API via `@aws-sdk/client-bedrock-runtime` for the agent loop, tool calling and vision-based receipt reading with Amazon Nova Pro. Alexa+ MCP Toolkit documentation for tool and display-mode design. Node 24's built-in `node:sqlite` for storage, Vite for bundling the board into a single self-contained HTML resource.

**What worked well?**

> The MCP Apps two-part pattern — a tool carrying `_meta.ui.resourceUri` plus a `ui://` resource — is a genuinely elegant way to pair voice output with a screen, and the vanilla-JS example in `ext-apps` was enough to get a working board without a framework. MCP spec 2025-11-25 over Streamable HTTP in stateless mode made the server trivially testable: the official client connects and lists tools in a dozen lines, and version negotiation worked first try. The Alexa+ tool-design guidance (one intent per tool, voice-intelligible output, never return nothing) directly improved the API. Amazon Nova Pro handled multi-step tool chaining, multilingual replies and receipt OCR without prompt gymnastics, and `bedrock get-foundation-model-availability` gave a precise answer when invocation was failing.

**What needs work?**

> Alexa+ MCP Toolkit access is effectively partner-gated, and the docs don't say so up front: the setup page gives `npm install -g @alexa-ai/cli`, which 404s on the public registry because the package lives in a private CodeArtifact repository reachable only through an AWS account arranged with a solutions architect. The landing page says "select partners", the overview says "available in the United States", and the setup page implies a free developer account is enough — three different answers. The local inspector is similarly unavailable, so an independent developer cannot validate a server against Alexa+ rules at all. Separately, Anthropic models on Bedrock were unusable on a new personal account: `agreementAvailability: NOT_AVAILABLE` with an error pointing to AWS Sales, while the retired Model access page says first invocation auto-enables models, and the pending Marketplace offer is reachable only through the CLI. And Nova returns an empty `end_turn` — no error — when a tool result mixes a text block with a large JSON block. Full write-ups in FRICTION_LOG.md.

**How was onboarding, from zero to hello world?**

> MCP: excellent, under an hour from `npm init` to a tool call over Streamable HTTP, helped by runnable examples in the `ext-apps` repo. MCP Apps: a few hours, mostly spent understanding the double-iframe sandbox model, which the spec explains well but which has no shortcut. Bedrock: fast once a model was reachable, but three weeks were lost to Anthropic model access that never resolved; switching to Nova took about an hour, most of it rewriting the agent for the Converse API. Alexa+ Toolkit: never reached hello world — blocked at CLI installation.

**Would you build with these devices and services again?**

> Yes for MCP and MCP Apps — the standard is well-specified, the SDKs are solid, and one server now serves a voice agent, a touch UI and an automated test with no duplicated logic. Yes for Bedrock, with the caveat that model-access failures need much clearer errors. For Alexa+ specifically, only once the MCP Toolkit is self-serve; the docs are good enough that the gate, not the technology, is the obstacle.

### Feature requests

> **Self-serve Alexa+ MCP Toolkit access for individual developers** — Critical. A hackathon inviting MCP submissions should let entrants test against the thing they're building for. Even a sandbox-only tier with a simulator and no certification path would be enough.
>
> **Publish the local inspector publicly** — Important. Rule-checking a server against Alexa+ display and latency requirements doesn't need production access, and it would raise the quality of every submission.
>
> **A documented local Alexa+ conversation simulator** — Important. Building a credible stand-in took a meaningful share of this project's time; it is pure scaffolding that every entrant has to reinvent.
>
> **Clearer Bedrock model-access errors** — Important. "Not available for this account, contact AWS Sales" should instead say which agreement is missing and link to where it's accepted.

### Friction log

Point judges at **FRICTION_LOG.md** in the repo. Five entries, each with steps, expected vs. actual, severity, workaround and a concrete suggestion. Submitting friction logs is worth up to a 10% scoring bonus.

---

## 4. Open-source mini challenge (optional)

Needs a *separate* contribution made during the hackathon window: a new repo with an open-source licence, or a PR to an existing project (merging isn't required). Submit the contribution URL, repo URL, GitHub username, and a note on what it does and why it matters.

Natural candidate from this project: the **sandboxed MCP Apps host** in `simulator/src/` — a minimal, framework-free MCP Apps host with the double-iframe sandbox, extracted as a standalone repo. Anyone building an MCP Apps client currently has to read the reference implementation and reimplement it.

---

## Honest gaps

Don't claim these; judges check:

- **OAuth 2.1 is not implemented.** Alexa+ requires it for certification. The server is unauthenticated, which is fine for local judging. Listed as a roadmap item.
- **Never tested against real Alexa+** — toolkit access is partner-gated. The simulator is a stand-in, and the rules permit it.
- **Recipes and cook mode were not built.**
- **No hosted deployment.** Runs locally; DEPLOY.md § 7 sketches the path.
