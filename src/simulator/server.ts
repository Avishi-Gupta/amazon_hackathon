// Serves the Echo Show simulator: the host page + agent API on one origin, and the MCP Apps
// sandbox proxy on a second origin so add-on UIs stay isolated from the host page.
import express, { type Request, type Response } from "express";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { z } from "zod";
import { HomeStockAgent } from "../agent/agent.js";
import type { SimulatorConfig } from "../agent/types.js";

const MAX_IMAGE_BASE64 = 8_000_000; // ~6 MB of image data

// Bind address. Set SIMULATOR_HOST=0.0.0.0 to reach the simulator from another device on the LAN.
const HOST = process.env.SIMULATOR_HOST ?? "127.0.0.1";
const port = Number(process.env.SIMULATOR_PORT ?? 8080);
const sandboxPort = Number(process.env.SANDBOX_PORT ?? 8081);
// The hostname other devices use to reach this machine. When bound to all interfaces, the LAN
// address is detected so the sandbox origin and MCP endpoint resolve from a phone, not just here.
const publicHost = process.env.PUBLIC_HOST ?? (HOST === "0.0.0.0" ? lanAddress() : HOST);
const mcpUrl = process.env.MCP_URL ?? `http://${publicHost}:3001/mcp`;

function lanAddress(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return "127.0.0.1";
}
const DIST = path.resolve(import.meta.dirname, "../../dist/simulator");

const agent = new HomeStockAgent({
  mcpUrl,
  region: process.env.AWS_REGION ?? "ap-southeast-1",
  // Any tool-capable Bedrock model works; Nova Pro is the default because Anthropic models
  // need a Marketplace agreement that new accounts can't currently complete (see FRICTION_LOG F-004).
  model: process.env.BEDROCK_MODEL ?? "apac.amazon.nova-pro-v1:0",
});

const converseSchema = z.object({
  sessionId: z.string().uuid(),
  text: z.string().trim().min(1).max(2000),
  screenEvents: z.array(z.string().max(500)).max(20).optional(),
});

const photoSchema = z.object({
  sessionId: z.string().uuid(),
  imageBase64: z.string().min(100).max(MAX_IMAGE_BASE64),
  format: z.enum(["jpeg", "png", "webp", "gif"]),
  text: z.string().trim().max(2000).optional(),
});

const app = express();
app.use(express.json({ limit: "12mb" }));

app.get("/api/config", (_req: Request, res: Response) => {
  const config: SimulatorConfig = { mcpUrl, sandboxUrl: `http://${publicHost}:${sandboxPort}/sandbox.html` };
  res.json(config);
});

app.post("/api/converse", async (req: Request, res: Response) => {
  const parsed = converseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    res.json(await agent.converse(parsed.data));
  } catch (err) {
    console.error("converse failed:", err);
    res.status(502).json({ error: describeError(err) });
  }
});

app.post("/api/photo", async (req: Request, res: Response) => {
  const parsed = photoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid photo request" });
    return;
  }
  try {
    res.json(await agent.ingestPhoto(parsed.data));
  } catch (err) {
    console.error("photo failed:", err);
    res.status(502).json({ error: describeError(err) });
  }
});

app.use(express.static(DIST));

const sandbox = express();
sandbox.use((_req, res, next) => {
  // The view HTML is written into the inner frame, so it inherits this policy: inline code only, no network.
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src data:; connect-src 'none'; frame-ancestors http://${publicHost}:${port} http://127.0.0.1:${port} http://localhost:${port}`,
  );
  next();
});
sandbox.use(express.static(DIST));

app.listen(port, HOST, () => console.log(`Simulator:        http://${publicHost}:${port}  (MCP server: ${mcpUrl})`));
sandbox.listen(sandboxPort, HOST, () => console.log(`Sandbox origin:   http://${publicHost}:${sandboxPort}`));

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/credential/i.test(message)) {
    return "AWS credentials not found. Run `aws configure sso` (or set AWS_PROFILE) and restart the simulator.";
  }
  if (/ECONNREFUSED|fetch failed/i.test(message)) {
    return `Can't reach the HomeStock MCP server at ${mcpUrl}. Is \`npm start\` running?`;
  }
  return message;
}
