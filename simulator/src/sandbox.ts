// Outer sandbox proxy for MCP Apps views, adapted from the MIT-licensed basic-host example in
// modelcontextprotocol/ext-apps. It runs on a separate origin from the host page and relays
// JSON-RPC messages between the host (parent) and the untrusted view (inner iframe).
import type {
  McpUiSandboxProxyReadyNotification,
  McpUiSandboxResourceReadyNotification,
} from "@modelcontextprotocol/ext-apps/app-bridge";

const ALLOWED_REFERRER = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/;
const RESOURCE_READY: McpUiSandboxResourceReadyNotification["method"] = "ui/notifications/sandbox-resource-ready";
const PROXY_READY: McpUiSandboxProxyReadyNotification["method"] = "ui/notifications/sandbox-proxy-ready";

if (window.self === window.top) throw new Error("sandbox.html must be embedded by the simulator host.");
if (!ALLOWED_REFERRER.test(document.referrer)) throw new Error(`Embedding origin not allowed: ${document.referrer}`);

const hostOrigin = new URL(document.referrer).origin;
const ownOrigin = window.location.origin;

// Self-test: reaching into the host window must fail, or isolation is broken.
try {
  void window.top!.document;
  throw new Error("Sandbox isolation check failed: host document is reachable.");
} catch (err) {
  if (err instanceof Error && err.message.startsWith("Sandbox isolation")) throw err;
}

const inner = document.createElement("iframe");
inner.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
document.body.appendChild(inner);

window.addEventListener("message", (event) => {
  if (event.source === window.parent) {
    if (event.origin !== hostOrigin) return;
    if (event.data?.method === RESOURCE_READY) {
      const { html } = event.data.params as { html?: string };
      if (typeof html !== "string") return;
      const doc = inner.contentDocument;
      if (doc) {
        doc.open();
        doc.write(html);
        doc.close();
      } else {
        inner.srcdoc = html;
      }
    } else {
      inner.contentWindow?.postMessage(event.data, "*");
    }
  } else if (event.source === inner.contentWindow) {
    if (event.origin !== ownOrigin) return;
    window.parent.postMessage(event.data, hostOrigin);
  }
});

window.parent.postMessage({ jsonrpc: "2.0", method: PROXY_READY, params: {} }, hostOrigin);
