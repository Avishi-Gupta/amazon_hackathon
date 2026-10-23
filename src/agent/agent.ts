import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ImageFormat,
  type Message,
  type Tool,
  type ToolInputSchema,
  type ToolResultBlock,
  type ToolResultContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import type { ConverseRequest, ConverseResponse, PhotoRequest, ToolCallRecord } from "./types.js";

const MAX_STEPS = 8;
const SESSION_TTL_MS = 30 * 60_000;

// Model-agnostic: this talks the Bedrock Converse API, so any tool-capable Bedrock model works
// (Amazon Nova today; set BEDROCK_MODEL to an Anthropic profile if that listing is available).
const SYSTEM_PROMPT = `You are Alexa, the voice assistant on an Echo Show in the customer's kitchen, using the HomeStock add-on. HomeStock tracks the food and household consumables in their home: groceries, cleaning supplies, toiletries, medicine and pet supplies.

Your reply is spoken aloud. Answer in one to three short, natural sentences with no markdown, lists, emoji or symbols. The screen shows HomeStock's details, so summarise instead of reading everything out.

Reply in the same language the customer used. Always pass product names to the tools in English, however the customer said them, so the household's inventory stays consistent across languages.

Use HomeStock's tools for anything about what is in the home and never guess the inventory. When the customer clearly says they bought, used, finished or threw something out, record it right away, with one tool call for each thing that happened.

Ask before adding anything to the shopping list. When you have just asked whether to add a product to the shopping list and the customer agrees, call add_to_shopping_list for it. Only call add_items when the customer has actually bought or brought home a product; agreeing to a shopping list entry is not a purchase. Pass along quantities and expiry dates they mention, resolving relative dates such as "Friday" against today's date given in their message.

If a request has nothing to do with their home supplies, answer briefly without tools.`;

const PHOTO_PROMPT = `This photo is either a shopping receipt or groceries the customer has just brought home.

Identify every food or household product you can see or read, ignoring prices, totals, store names, loyalty numbers and anything that is not a product. Expand abbreviated receipt names into ordinary English product names: "ORG BAN" is "bananas", "SKIM MLK 1L" is "milk". Read a printed use-by or best-before date when one is clearly legible, and otherwise leave the expiry out so HomeStock can estimate it.

Leave the category and storage location out of every item: HomeStock classifies products itself, and its shelf-life rules are more accurate than a guess from the photo.

Record everything you found in one add_items call, then tell the customer what you added in one or two spoken sentences. Only mention an expiry window if the tool's result gives one, and say which products it applies to. If the photo contains no recognisable products, say so instead of calling any tool.`;

export interface AgentOptions {
  mcpUrl: string;
  region: string;
  model: string;
}

interface Session {
  messages: Message[];
  lastUsed: number;
}

export class HomeStockAgent {
  private readonly bedrock: BedrockRuntimeClient;
  private readonly sessions = new Map<string, Session>();
  private mcp: Client | null = null;
  private tools: Tool[] = [];

  constructor(private readonly options: AgentOptions) {
    this.bedrock = new BedrockRuntimeClient({ region: options.region });
  }

  async converse({ sessionId, text, screenEvents = [] }: ConverseRequest): Promise<ConverseResponse> {
    await this.ensureMcp();
    const session = this.session(sessionId);
    const preamble = screenEvents.length
      ? `${todayLine()} Since the last turn, on the screen: ${screenEvents.join(" ")}`
      : todayLine();
    return this.run(session, [{ text: `${preamble}\n\n${text}` }]);
  }

  /** Reads a receipt or grocery-haul photo and records what it finds. */
  async ingestPhoto({ sessionId, imageBase64, format, text }: PhotoRequest): Promise<ConverseResponse> {
    await this.ensureMcp();
    const session = this.session(sessionId);
    const instruction = text ? `${PHOTO_PROMPT}\n\nThe customer also said: ${text}` : PHOTO_PROMPT;
    return this.run(session, [
      { image: { format: format as ImageFormat, source: { bytes: Buffer.from(imageBase64, "base64") } } },
      { text: `${todayLine()}\n\n${instruction}` },
    ]);
  }

  /** Runs the tool-calling loop for one customer turn. */
  private async run(session: Session, content: ContentBlock[]): Promise<ConverseResponse> {
    const turnStart = session.messages.length;
    session.messages.push({ role: "user", content });

    const toolCalls: ToolCallRecord[] = [];
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const response = await this.bedrock.send(
          new ConverseCommand({
            modelId: this.options.model,
            system: [{ text: SYSTEM_PROMPT }],
            messages: session.messages,
            toolConfig: { tools: this.tools },
            inferenceConfig: { maxTokens: 1024, temperature: 0.2 },
          }),
        );

        const reply = response.output?.message?.content ?? [];
        if (process.env.DEBUG_AGENT) {
          console.log(`[agent] step ${step} stop=${response.stopReason} content=${JSON.stringify(reply).slice(0, 800)}`);
        }
        session.messages.push({ role: "assistant", content: reply });

        const toolUses = reply.flatMap((block) => (block.toolUse ? [block.toolUse] : []));
        if (response.stopReason !== "tool_use" || toolUses.length === 0) {
          return { reply: spokenText(reply) || "Done.", toolCalls };
        }

        // Identical calls in one turn run once: models sometimes emit a duplicate, and replaying a
        // write ("we finished the milk") would fail the second time and surface that error as the reply.
        const seen = new Map<string, Promise<ToolCallRecord>>();
        const records = await Promise.all(
          toolUses.map((use) => {
            const args = (use.input ?? {}) as Record<string, unknown>;
            const key = `${use.name}:${JSON.stringify(args)}`;
            const existing = seen.get(key);
            if (existing) return existing;
            const pending = this.callTool(use.name!, args);
            seen.set(key, pending);
            return pending;
          }),
        );
        toolCalls.push(...records);
        session.messages.push({
          role: "user",
          content: toolUses.map((use, i): ContentBlock => ({ toolResult: toolResultBlock(use.toolUseId!, records[i]!.result) })),
        });
      }
      return { reply: "Sorry, that took too many steps. Could you try asking another way?", toolCalls };
    } catch (err) {
      // Keep history consistent (every toolUse answered) by dropping the failed turn.
      session.messages.length = turnStart;
      throw err;
    }
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallRecord> {
    try {
      const result = (await this.mcp!.callTool({ name, arguments: args })) as CallToolResult;
      return { name, arguments: args, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { name, arguments: args, result: { isError: true, content: [{ type: "text", text: message }] } };
    }
  }

  private async ensureMcp(): Promise<void> {
    if (this.mcp) return;
    const client = new Client({ name: "homestock-alexa-simulator-agent", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(this.options.mcpUrl)));
    const { tools } = await client.listTools();
    this.tools = tools.map((tool) => ({
      toolSpec: {
        name: tool.name,
        description: tool.description ?? tool.title ?? tool.name,
        // Cast: Bedrock types JSON payloads as DocumentType, which an MCP JSON Schema satisfies structurally.
        inputSchema: { json: tool.inputSchema } as ToolInputSchema,
      },
    }));
    this.mcp = client;
  }

  private session(id: string): Session {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now - session.lastUsed > SESSION_TTL_MS) this.sessions.delete(key);
    }
    const session = this.sessions.get(id) ?? { messages: [], lastUsed: now };
    session.lastUsed = now;
    this.sessions.set(id, session);
    return session;
  }
}

function todayLine(): string {
  return `Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;
}

/** Spoken reply text, with any model scratchpad (<thinking>…</thinking>) stripped out. */
function spokenText(content: ContentBlock[]): string {
  return content
    .flatMap((block) => (block.text ? [block.text] : []))
    .join(" ")
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_RESULT_CHARS = 6000;

function toolResultBlock(toolUseId: string, result: CallToolResult): ToolResultBlock {
  const spoken = result.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
  // One text block, data inlined: Nova returns an empty turn when a tool result mixes text with a
  // large `json` document block, so the structured payload travels as text (see FRICTION_LOG F-005).
  const data = result.structuredContent ? `\n\nData: ${JSON.stringify(result.structuredContent)}` : "";
  const payload = `${spoken}${data}`.slice(0, MAX_RESULT_CHARS) || "(no output)";
  return {
    toolUseId,
    status: result.isError ? "error" : "success",
    content: [{ text: payload }] as ToolResultContentBlock[],
  };
}
