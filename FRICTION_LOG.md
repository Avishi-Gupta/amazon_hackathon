# Friction Log

Running log of developer friction hit while building HomeStock for the Build, Ship, Shape hackathon.
Each entry: task, steps, expected vs. actual, severity, workaround, suggestion.

Severity: **Blocker** · **High** · **Medium** · **Low**

---

## F-001 — Alexa AI CLI not installable from the public npm registry

- **Date:** 2026-09-16
- **Tool:** Alexa+ MCP Toolkit — `@alexa-ai/cli`
- **Task:** Install the Alexa AI CLI to scaffold and deploy an MCP add-on.
- **Steps:** Followed *Set Up Your Development Environment*, which gives `npm install -g @alexa-ai/cli` (Node 24+). Ran `npm view @alexa-ai/cli` against registry.npmjs.org.
- **Expected:** Package resolves and installs.
- **Actual:** `404 Not Found — '@alexa-ai/cli@*' could not be found or you do not have permission to access it`. Same for several guessed names of the local inspector (`addon-local-inspector`).
- **Severity:** High (blocks `alexa-ai new mcp` / `deploy`)
- **Root cause (found later the same day):** Further down, the setup page says to "authenticate npm against the Alexa AI private CodeArtifact registry" using the AWS account "provided to the Alexa Solutions Architect". The CLI is effectively partner-gated, but the gating is only visible after the install command has already failed.
- **Workaround:** Target the MCP spec directly (2025-11-25, Streamable HTTP, MCP Apps) so the server runs in any compliant host, and demo through a simulated Alexa+ client.
- **Suggestion:** Put the CodeArtifact/Solutions Architect prerequisite *before* the install command, give individual developers a self-serve request path, and publish the local inspector publicly so non-partners can at least validate servers against Alexa+ rules.

## F-002 — Contradictory access signals for the MCP Toolkit

- **Date:** 2026-09-16
- **Tool:** Alexa+ MCP Toolkit docs
- **Task:** Determine whether an individual, non-US developer can use the toolkit.
- **Steps:** Read the Alexa+ for Builders landing page, MCP Toolkit Overview, and dev-environment setup page.
- **Expected:** One clear eligibility statement.
- **Actual:** Landing page says "currently available to select partners working directly with our team"; Overview says "available in the United States"; setup page only requires a free developer account but mentions giving credentials "to the Alexa Solutions Architect".
- **Severity:** Medium
- **Workaround:** Build a standards-compliant MCP server that also runs in any MCP Apps host, plus a simulated Alexa+ client, so the project isn't blocked on access.
- **Suggestion:** Add an eligibility box (who, which countries, how to request access) at the top of the Overview and QuickStart.

## F-004 — Anthropic models on Bedrock unusable on a new account, with no actionable path

- **Date:** 2026-09-18 → 2026-10-12 (unresolved for 3+ weeks)
- **Tool:** Amazon Bedrock — model access for Anthropic models
- **Task:** Invoke Claude from a new personal AWS account for the hackathon's AWS Builder mini challenge.
- **Steps:** Created an IAM user with `AmazonBedrockLimitedAccess`; the console's *Model access* page is retired and states serverless models "are now automatically enabled across all AWS commercial regions when first invoked"; invoked from the Playground and via `bedrock-runtime converse`; submitted the Anthropic use-case form; retried over several days in `ap-southeast-1` and `us-west-2`.
- **Expected:** First invocation enables the model, as the retirement notice describes.
- **Actual:** Every call returns `AccessDeniedException: anthropic.claude-opus-5 is not available for this account … contact AWS Sales`. Diagnostics show the account is fine and only the agreement is missing:
  `get-foundation-model-availability` → `agreementAvailability: NOT_AVAILABLE`, `authorizationStatus: AUTHORIZED`, `entitlementAvailability: AVAILABLE`, `regionAvailability: AVAILABLE`, while `get-use-case-for-model-access` confirms the form was accepted. `list-foundation-model-agreement-offers` returns an offer that nothing in the console ever presents. Amazon Nova models on the same account show `agreementAvailability: AVAILABLE` and invoke fine, so this is specific to the Anthropic listing.
- **Severity:** Blocker (for the AWS Builder challenge as originally planned)
- **Workaround:** Switched the agent from Anthropic's Bedrock SDK to the AWS Converse API and run Amazon Nova Pro, which works on the same account with the same credentials.
- **Suggestion:** Three fixes. (1) Make the error name the real cause — "no Marketplace agreement for this model; subscribe here" — instead of "contact AWS Sales", which reads as "your account is too small". (2) Since *Model access* is retired, give the console a visible way to accept a pending `list-foundation-model-agreement-offers` offer; today the offer is reachable only through the CLI. (3) State on the retirement page that the auto-enable path does not cover Anthropic models for new accounts, and say what does.

## F-005 — Nova returns an empty turn when a tool result mixes text with a large JSON block

- **Date:** 2026-10-12
- **Tool:** Amazon Bedrock Converse API — Amazon Nova Pro (`apac.amazon.nova-pro-v1:0`)
- **Task:** Return an MCP tool result to the model as both a spoken summary and its structured payload, using `toolResult.content: [{ text }, { json }]` — the shape the Converse API documents.
- **Steps:** Agent loop calls `get_expiring`, posts the result back with a text block plus a `json` block holding the tool's `structuredContent` (an object with a 16-item array), then re-invokes Converse.
- **Expected:** A spoken summary referring to the structured data.
- **Actual:** `stopReason: "end_turn"` with `content: []` — an empty assistant turn, no error, no warning. The same conversation with a short text-only tool result answers correctly, so the trigger is the mixed text + `json` content block (or its size), not the conversation itself. An empty success response is hard to attribute: it looks like a prompt problem, not an API one.
- **Severity:** High (silent, and the natural reading of the docs leads straight into it)
- **Workaround:** Send one text block per tool result with the JSON serialised into it, capped at 6,000 characters.
- **Suggestion:** Either reject the request with a validation error naming the offending block, or document the size and shape limits for `toolResult` `json` blocks. Returning `end_turn` with no content and no diagnostic is the worst of the three options.

## F-003 — Client lifecycle example uses an older protocol version than the required spec

- **Date:** 2026-09-16
- **Tool:** Alexa+ MCP Toolkit — Client Lifecycle docs
- **Task:** Confirm which MCP protocol version the Alexa+ client negotiates.
- **Steps:** Compared QuickStart ("MCP specification 2025-11-25", Streamable HTTP) with the Client Lifecycle page's `initialize` example.
- **Expected:** `protocolVersion: "2025-11-25"` in the example.
- **Actual:** Example shows `"2025-03-26"`.
- **Severity:** Low
- **Workaround:** Server negotiates any supported version via the SDK; verify against the real client once deployed.
- **Suggestion:** Update the example, or document the version-negotiation behavior explicitly.
