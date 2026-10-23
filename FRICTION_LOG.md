# Friction Log

Problems I hit while building HomeStock for the Build, Ship, Shape hackathon, written down as they happened. Each entry says what I was trying to do, what I expected, what actually happened, how bad it was, what I did instead, and what would have helped.

Severity scale: Blocker, High, Medium, Low.

## F-001. The Alexa AI CLI cannot be installed from the public npm registry

Date: 16 September 2026

Tool: Alexa+ MCP Toolkit, the alexa-ai CLI

What I was doing: installing the CLI so I could scaffold and deploy an MCP add-on.

Steps: I followed the Set Up Your Development Environment page, which tells you to run npm install -g @alexa-ai/cli on Node 24 or later. When that failed I checked the package directly against registry.npmjs.org.

Expected: the package installs.

What happened: a 404 saying the package could not be found or I do not have permission to access it. I tried several likely names for the local inspector too, and none of them exist publicly either.

Severity: High. Without the CLI there is no way to deploy an add-on.

Root cause, which I found later the same day: further down the same setup page there is a step about authenticating npm against a private Alexa AI CodeArtifact registry, using an AWS account you have given to an Alexa Solutions Architect. So the CLI is partner gated. The problem is that you only discover this after the install command has already failed.

What I did instead: I built against the MCP specification directly, 2025-11-25 over Streamable HTTP with the MCP Apps extension, so the server works in any compliant host, and I wrote my own Alexa+ simulator to demonstrate it.

What would have helped: put the CodeArtifact and Solutions Architect prerequisite above the install command rather than below it, give individual developers a way to request access themselves, and publish the local inspector publicly so people outside the partner programme can at least check their server against the Alexa+ rules.

## F-002. The documentation gives three different answers about who can use the toolkit

Date: 16 September 2026

Tool: Alexa+ MCP Toolkit documentation

What I was doing: working out whether an individual developer outside the United States could use the toolkit at all, before investing time in it.

Steps: I read the Alexa+ for Builders landing page, the MCP Toolkit Overview, and the development environment setup page.

Expected: one clear statement about who is eligible.

What happened: the landing page says it is currently available to select partners working directly with the team. The overview says it is available in the United States. The setup page asks only for a free developer account, then mentions handing credentials to an Alexa Solutions Architect. Three pages, three different pictures, and no way to tell which applies to me.

Severity: Medium.

What I did instead: I assumed the most restrictive reading was true and designed so that nothing depended on getting access.

What would have helped: a short eligibility box at the top of the Overview and the QuickStart saying who can use it, in which countries, and how to ask for access.

## F-003. The client lifecycle example uses an older protocol version than the one the toolkit requires

Date: 16 September 2026

Tool: Alexa+ MCP Toolkit, Client Lifecycle documentation

What I was doing: checking which MCP protocol version the Alexa+ client negotiates, so my server would accept it.

Steps: I compared the QuickStart, which requires MCP specification 2025-11-25 over Streamable HTTP, with the initialize example on the Client Lifecycle page.

Expected: the example to show the same version the QuickStart requires.

What happened: the example shows protocol version 2025-03-26 instead.

Severity: Low. The SDK negotiates versions anyway, so nothing broke. It just made me doubt which version to target.

What I did instead: I let the SDK handle negotiation and moved on.

What would have helped: updating the example, or a sentence explaining that the client negotiates and which versions it accepts.

## F-004. Anthropic models on Bedrock were unusable on a new account for three weeks, with no way to fix it

Date: 18 September to 12 October 2026, never resolved

Tool: Amazon Bedrock model access

What I was doing: calling Claude from a new personal AWS account, to use Bedrock for the AWS Builder mini challenge.

Steps: I created an IAM user with the AmazonBedrockLimitedAccess policy. The console's Model access page is now retired, and the page that replaced it says serverless models are enabled automatically across all commercial regions the first time you invoke them. So I invoked one, from the Playground and from the CLI. I also submitted the Anthropic use case form. I retried over several days, in both ap-southeast-1 and us-west-2.

Expected: the first invocation enables the model, as the retirement notice describes.

What happened: every single call returned AccessDeniedException saying the model is not available for this account and that I should contact AWS Sales. The diagnostics made clear the account itself was fine and only one thing was missing. Running aws bedrock get-foundation-model-availability showed agreementAvailability NOT_AVAILABLE while authorizationStatus was AUTHORIZED, entitlementAvailability was AVAILABLE and regionAvailability was AVAILABLE. Running aws bedrock get-use-case-for-model-access confirmed my form had been accepted. Running aws bedrock list-foundation-model-agreement-offers returned a real pending offer that nothing in the console ever showed me. Amazon Nova models on the same account, same credentials, same region reported agreementAvailability AVAILABLE and worked immediately, so this is specific to the Anthropic listing and not to my account.

Severity: Blocker for what I originally planned, and the single biggest time loss in the project.

What I did instead: I rewrote the agent to use the Bedrock Converse API rather than an Anthropic specific SDK, and switched to Amazon Nova Pro, which worked on the first try. That turned out to be a better design anyway, because the model is now a single environment variable.

What would have helped, in order of how much difference it would make:

1. An error message that names the real cause. Saying there is no Marketplace agreement for this model, with a link to accept it, would have saved three weeks. Contact AWS Sales reads as though the account is too small, which sends you looking in completely the wrong place.
2. Somewhere in the console to accept a pending agreement offer. Now that Model access is retired, the offer that list-foundation-model-agreement-offers returns is reachable only from the CLI, and nothing tells you it exists.
3. A line on the retirement page saying the automatic enabling does not cover Anthropic models on new accounts, and explaining what does.

## F-005. Nova returns an empty response when a tool result mixes text with a large JSON block

Date: 12 October 2026

Tool: Amazon Bedrock Converse API with Amazon Nova Pro

What I was doing: sending an MCP tool result back to the model as both a spoken summary and the structured data behind it, using a toolResult with a text block and a json block, which is the shape the Converse API documents.

Steps: the agent calls the get_expiring tool, posts the result back as a text block plus a json block holding the structured payload, which was an object containing an array of 16 items, then calls Converse again.

Expected: a spoken summary that refers to the structured data.

What happened: the model returned stopReason end_turn with an empty content array. No error, no warning, no explanation. The same conversation with a short text only tool result answers perfectly, so the trigger is the mixed content, or its size, rather than anything about the conversation. This was the hardest problem in the project to diagnose, because an empty successful response looks exactly like a prompting mistake. I spent a while rewriting prompts before suspecting the API.

Severity: High, because it is silent and because the obvious reading of the documentation leads straight into it.

What I did instead: I send one text block per tool result with the JSON written into the text, capped at 6000 characters.

What would have helped: either reject the request with a validation error naming the block that caused it, or document the size and shape limits for json blocks in tool results. Returning a successful but empty turn with no diagnostic is the least helpful of the three possibilities.
