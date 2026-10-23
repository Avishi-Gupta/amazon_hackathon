import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import cors from "cors";
import type { Request, Response } from "express";
import { InventoryStore } from "./domain/store.js";
import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 3001);
// Bind to loopback by default (MCP transport security guidance); set HOST=0.0.0.0 behind a tunnel or load balancer.
const host = process.env.HOST ?? "127.0.0.1";
const allowedHosts = process.env.ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean);
const householdId = process.env.HOMESTOCK_HOUSEHOLD ?? "demo";

const store = new InventoryStore();
const app = createMcpExpressApp({ host, ...(allowedHosts?.length ? { allowedHosts } : {}) });
app.use(cors({ exposedHeaders: ["Mcp-Session-Id"] }));

app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Stateless Streamable HTTP: a fresh server + transport per request, backed by the shared store.
app.all("/mcp", async (req: Request, res: Response) => {
  const server = createServer({ store, householdId });
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

const httpServer = app.listen(port, host, (err?: Error) => {
  if (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
  console.log(`HomeStock MCP server listening on http://${host}:${port}/mcp`);
});

const shutdown = () => {
  httpServer.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
