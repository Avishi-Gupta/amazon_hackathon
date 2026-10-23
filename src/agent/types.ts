import type { CallToolResult } from "@modelcontextprotocol/client";

/** Browser → simulator server. */
export interface ConverseRequest {
  sessionId: string;
  text: string;
  /** Things the customer did on the Echo Show screen since the last utterance (from MCP Apps updateModelContext). */
  screenEvents?: string[];
}

/** Browser → simulator server, for a receipt or grocery-haul photo. */
export interface PhotoRequest {
  sessionId: string;
  /** Base64-encoded image data, without the data: URL prefix. */
  imageBase64: string;
  format: "jpeg" | "png" | "webp" | "gif";
  /** Optional spoken context, e.g. "this is today's grocery run". */
  text?: string;
}

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: CallToolResult;
}

/** Simulator server → browser. */
export interface ConverseResponse {
  reply: string;
  toolCalls: ToolCallRecord[];
}

export interface SimulatorConfig {
  mcpUrl: string;
  sandboxUrl: string;
}
