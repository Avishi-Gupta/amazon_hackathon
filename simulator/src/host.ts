import {
  AppBridge,
  PostMessageTransport,
  RESOURCE_MIME_TYPE,
  getToolUiResourceUri,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client, StreamableHTTPClientTransport, type Tool } from "@modelcontextprotocol/client";
import type { ConverseResponse, SimulatorConfig, ToolCallRecord } from "../../src/agent/types.js";
import "./host.css";

const HOST_INFO = { name: "HomeStock Alexa+ Simulator", version: "0.1.0" };

const screenEl = document.getElementById("screen")!;
const idleEl = document.getElementById("idle")!;
const clockEl = document.getElementById("clock")!;
const transcriptEl = document.getElementById("transcript")!;
const statusEl = document.getElementById("status")!;
const form = document.getElementById("ask") as HTMLFormElement;
const input = document.getElementById("utterance") as HTMLInputElement;
const micBtn = document.getElementById("mic") as HTMLButtonElement;
const cameraBtn = document.getElementById("camera") as HTMLButtonElement;
const photoInput = document.getElementById("photo-input") as HTMLInputElement;
const lightBar = document.getElementById("light-bar")!;

type AssistantState = "idle" | "listening" | "thinking" | "speaking";

interface ActiveApp {
  uri: string;
  iframe: HTMLIFrameElement;
  bridge: AppBridge;
  lastCall: Pick<ToolCallRecord, "name" | "arguments">;
}

const sessionId = crypto.randomUUID();
const pendingScreenEvents: string[] = [];
let active: ActiveApp | null = null;

function setState(state: AssistantState) {
  lightBar.dataset.state = state;
  statusEl.textContent = state === "idle" ? "" : `${state[0]!.toUpperCase()}${state.slice(1)}…`;
}

function addTurn(role: "you" | "alexa", text: string, toolNames: string[] = [], imageUrl?: string) {
  const li = document.createElement("li");
  li.className = `turn ${role}`;
  if (imageUrl) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.src = imageUrl;
    img.alt = "Photo you scanned";
    li.append(img);
  }
  const p = document.createElement("p");
  p.textContent = text;
  li.append(p);
  if (toolNames.length) {
    const tools = document.createElement("p");
    tools.className = "tools";
    tools.textContent = toolNames.map((n) => `⚙ ${n}`).join("  ");
    li.append(tools);
  }
  transcriptEl.append(li);
  li.scrollIntoView({ behavior: "smooth", block: "end" });
}

// --- MCP connection -------------------------------------------------------------------------

const connectionEl = document.getElementById("connection")!;

const config = (await (await fetch("/api/config")).json()) as SimulatorConfig;
const mcp = new Client(HOST_INFO);
let tools: Map<string, Tool>;
try {
  await mcp.connect(new StreamableHTTPClientTransport(new URL(config.mcpUrl)));
  tools = new Map((await mcp.listTools()).tools.map((t) => [t.name, t]));
  connectionEl.dataset.state = "ready";
  connectionEl.textContent = `HomeStock add-on · ${tools.size} tools`;
} catch (err) {
  connectionEl.dataset.state = "error";
  connectionEl.textContent = "Add-on offline — run npm start";
  throw err;
}
const uiUriFor = (name: string) => {
  const tool = tools.get(name);
  return tool ? getToolUiResourceUri(tool) : undefined;
};

// --- MCP Apps rendering ---------------------------------------------------------------------

async function mountApp(uri: string): Promise<Omit<ActiveApp, "lastCall">> {
  const resource = await mcp.readResource({ uri });
  const content = resource.contents[0];
  if (!content || content.mimeType !== RESOURCE_MIME_TYPE || !("text" in content)) {
    throw new Error(`Unsupported UI resource: ${uri}`);
  }

  const iframe = document.createElement("iframe");
  iframe.className = "app-frame";
  iframe.title = "Add-on screen";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  const proxyReady = new Promise<void>((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.source === iframe.contentWindow && event.data?.method === "ui/notifications/sandbox-proxy-ready") {
        window.removeEventListener("message", listener);
        resolve();
      }
    };
    window.addEventListener("message", listener);
  });
  iframe.src = config.sandboxUrl;
  screenEl.append(iframe);
  await proxyReady;

  const capabilities = mcp.getServerCapabilities();
  const bridge = new AppBridge(
    mcp,
    HOST_INFO,
    {
      serverTools: capabilities?.tools,
      serverResources: capabilities?.resources,
      updateModelContext: { text: {} },
    },
    {
      hostContext: {
        theme: "dark",
        platform: "web",
        displayMode: "fullscreen",
        availableDisplayModes: ["fullscreen"],
        containerDimensions: { width: screenEl.clientWidth, height: screenEl.clientHeight },
      },
    },
  );

  // Taps on the screen become context for the next spoken turn, like Alexa+ conversation state.
  bridge.onupdatemodelcontext = async (params) => {
    for (const block of params.content ?? []) {
      if (block.type === "text") pendingScreenEvents.push(block.text);
    }
    return {};
  };
  bridge.onmessage = async (params) => {
    const text = params.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join(" ");
    if (text) void ask(text);
    return {};
  };
  bridge.onsizechange = async () => {};
  bridge.onrequestdisplaymode = async () => ({ mode: "fullscreen" });
  bridge.onloggingmessage = (params) => console.info("[add-on]", params);

  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve();
  });
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  await bridge.sendSandboxResourceReady({ html: content.text });
  await initialized;
  return { uri, iframe, bridge };
}

async function showOnScreen(call: Pick<ToolCallRecord, "name" | "arguments">, result: ToolCallRecord["result"]) {
  const uri = uiUriFor(call.name);
  if (!uri) return;
  if (active?.uri !== uri) {
    if (active) {
      await active.bridge.teardownResource({}).catch(() => {});
      active.iframe.remove();
    }
    active = { ...(await mountApp(uri)), lastCall: call };
  }
  idleEl.hidden = true;
  active.lastCall = call;
  await active.bridge.sendToolInput({ arguments: call.arguments });
  await active.bridge.sendToolResult(result);
}

/** After a voice command changes data (e.g. "we finished the milk"), refresh whatever is on screen. */
async function refreshScreen() {
  if (!active) return;
  const { name, arguments: args } = active.lastCall;
  const result = (await mcp.callTool({ name, arguments: args })) as ToolCallRecord["result"];
  await active.bridge.sendToolResult(result);
}

// --- Conversation ---------------------------------------------------------------------------

/** Guesses a BCP-47 tag from the reply's script, so a Mandarin answer isn't read by an English voice. */
function detectLang(text: string): string {
  if (/[一-鿿]/.test(text)) return "zh-CN";
  if (/[ऀ-ॿ]/.test(text)) return "hi-IN";
  if (/[஀-௿]/.test(text)) return "ta-IN";
  return "en-US";
}

/**
 * Picks the best installed voice for a language. The platform default is usually a low-quality
 * compact voice, while Chrome's networked "Google" voices and macOS Premium/Enhanced downloads
 * sound far better, so prefer those when present.
 */
function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const base = lang.split("-")[0]!;
  const candidates = speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").startsWith(base));
  if (!candidates.length) return undefined;
  const rank = (v: SpeechSynthesisVoice) =>
    /Google/i.test(v.name) ? 0 : /Premium|Enhanced|Neural|Natural/i.test(v.name) ? 1 : v.localService ? 2 : 3;
  return [...candidates].sort((a, b) => rank(a) - rank(b) || Number(b.default) - Number(a.default))[0];
}

function speak(text: string) {
  const settle = () => setState("idle");
  if (!("speechSynthesis" in window) || !text) return settle();
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = detectLang(text);
  const voice = pickVoice(utterance.lang);
  if (voice) utterance.voice = voice;
  utterance.rate = 1.03; // a touch quicker than default reads as more natural
  utterance.onend = settle;
  utterance.onerror = settle;
  setState("speaking");
  speechSynthesis.speak(utterance);
}

// Voice lists load asynchronously in Chrome; touching it early primes the list before the first reply.
speechSynthesis?.getVoices();
speechSynthesis?.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices());

async function ask(text: string) {
  addTurn("you", text);
  setState("thinking");
  try {
    const response = await fetch("/api/converse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, text, screenEvents: pendingScreenEvents.splice(0) }),
    });
    const data = (await response.json()) as ConverseResponse | { error: string };
    if (!response.ok || "error" in data) throw new Error("error" in data ? data.error : response.statusText);

    addTurn("alexa", data.reply, data.toolCalls.map((c) => c.name));
    const uiCall = data.toolCalls.findLast((c) => uiUriFor(c.name) && !c.result.isError);
    if (uiCall) {
      await showOnScreen(uiCall, uiCall.result);
    } else if (data.toolCalls.length) {
      await refreshScreen();
    }
    speak(data.reply);
  } catch (err) {
    console.error(err);
    addTurn("alexa", "Sorry, I'm having trouble reaching HomeStock right now.");
    statusEl.textContent = err instanceof Error ? err.message : String(err);
    lightBar.dataset.state = "idle";
  }
}

// --- Photo intake ---------------------------------------------------------------------------

const MAX_IMAGE_EDGE = 1568;

/** Shrinks a camera photo so the upload stays small enough for the model's image limits. */
async function toScaledJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function sendPhoto(file: File) {
  let dataUrl: string;
  try {
    dataUrl = await toScaledJpeg(file);
  } catch {
    statusEl.textContent = "I couldn't read that image file.";
    return;
  }
  addTurn("you", "Scanned a photo", [], dataUrl);
  setState("thinking");
  try {
    const response = await fetch("/api/photo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, imageBase64: dataUrl.split(",")[1], format: "jpeg" }),
    });
    const data = (await response.json()) as ConverseResponse | { error: string };
    if (!response.ok || "error" in data) throw new Error("error" in data ? data.error : response.statusText);

    addTurn("alexa", data.reply, data.toolCalls.map((c) => c.name));
    // add_items has no screen of its own, so show the refreshed inventory after a successful scan.
    if (data.toolCalls.some((c) => !c.result.isError)) {
      const call = { name: "get_inventory", arguments: {} };
      await showOnScreen(call, (await mcp.callTool(call)) as ToolCallRecord["result"]);
    }
    speak(data.reply);
  } catch (err) {
    console.error(err);
    addTurn("alexa", "Sorry, I couldn't read that photo.");
    statusEl.textContent = err instanceof Error ? err.message : String(err);
    lightBar.dataset.state = "idle";
  }
}

cameraBtn.addEventListener("click", () => photoInput.click());
photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  photoInput.value = "";
  if (file) void sendPhoto(file);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  void ask(text);
});

document.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) =>
  chip.addEventListener("click", () => void ask(chip.dataset.say!)),
);

// --- Voice input (Web Speech API; Chrome and Edge) ------------------------------------------

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
const speechWindow = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const RecognitionCtor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;

if (!RecognitionCtor) {
  micBtn.disabled = true;
  micBtn.title = "Voice input needs Chrome or Edge on a secure page. Type instead.";
} else {
  micBtn.addEventListener("click", () => {
    speechSynthesis.cancel();
    const session = new RecognitionCtor();
    session.lang = "en-US";
    session.continuous = false;
    session.interimResults = false;
    let heard = false;
    session.onresult = (event) => {
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript?.trim();
      if (transcript) {
        heard = true;
        void ask(transcript);
      }
    };
    session.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        statusEl.textContent = `Microphone: ${event.error}`;
      }
    };
    session.onend = () => {
      if (!heard && lightBar.dataset.state === "listening") setState("idle");
    };
    setState("listening");
    session.start();
  });
}

// --- Idle clock -----------------------------------------------------------------------------

function tick() {
  clockEl.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
tick();
setInterval(tick, 15_000);
