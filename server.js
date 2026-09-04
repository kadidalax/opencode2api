import express from "express";
import { ProxyAgent } from "undici";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3456;
const UPSTREAM = "https://opencode.ai/zen/v1";
const GO_UPSTREAM = "https://opencode.ai/zen/go/v1";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "muse-spark-1.3-contributor-free";
let availableModels = new Set();
const HTTP_PROXY = process.env.HTTP_PROXY || "";
const dispatcher = HTTP_PROXY ? new ProxyAgent(HTTP_PROXY) : undefined;
async function upstreamFetch(url, options = {}) {
  return fetch(url, { ...options, dispatcher });
}

app.use(express.json({ limit: "50mb" }));

const API_KEY = process.env.API_KEY || "";
if (!API_KEY) {
  console.warn("WARNING: API_KEY is not set. Anyone can use this proxy. Set API_KEY for production.");
}
const HOST = process.env.HOST || "0.0.0.0";

app.use((req, res, next) => {
  if (!API_KEY) return next();
  const key = req.headers["authorization"]?.replace("Bearer ", "") || req.headers["x-api-key"];
  const a = Buffer.from(String(key));
const b = Buffer.from(API_KEY);
if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  return res.status(401).json({ error: { type: "authentication_error", message: "Invalid or missing API key. Set Authorization: Bearer <key> or x-api-key header." } });
});



const FREE_PREFERENCE = "muse-spark-1.3-contributor-free";
function resolveModel(requested) {
  if (requested && requested !== "auto" && availableModels.has(requested)) return requested;
  if (availableModels.has(DEFAULT_MODEL)) return DEFAULT_MODEL;
  if (availableModels.has(FREE_PREFERENCE)) return FREE_PREFERENCE;
  for (const id of availableModels) {
    if (id.includes("free")) return id;
  }
  if (availableModels.size > 0) return [...availableModels][0];
  return null;
}

// Model discovery: check which models are free (no auth required)
async function discoverFreeModels() {
  const next = new Set();
  const endpoints = [UPSTREAM, GO_UPSTREAM];
  for (const base of endpoints) {
    try {
      const resp = await upstreamFetch(`${base}/models`, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const m of data.data || []) next.add(m.id);
    } catch (err) {
      console.error(`Model discovery failed for ${base}:`, err.message);
    }
  }
  if (next.size > 0) {
    availableModels = next;
    console.log(`Discovered ${next.size} models`);
  } else if (availableModels.size === 0) {
    console.warn("No models discovered, will retry");
  }
}
setInterval(discoverFreeModels, 5 * 60 * 1000).unref();
discoverFreeModels();

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", upstream: UPSTREAM });
});

// Model list from cache
app.get("/v1/models", async (_req, res) => {
  if (availableModels.size === 0) await discoverFreeModels();
  const data = [...availableModels].map(id => ({ id, object: "model", owned_by: "opencode" }));
  res.json({ object: "list", data });
});

// OpenAI Responses passthrough (Codex uses this)
app.post("/v1/responses", async (req, res) => {
  try {
    const model = resolveModel(req.body?.model);
    if (!model) return res.status(503).json({ error: { message: "No available models" } });
    const stream = req.body.stream === true;
    const resp = await upstreamFetch(`${UPSTREAM}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...req.body, model }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).send(text);
    }

    if (!stream) {
      const data = await resp.json();
      return res.json(data);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    };
    pump().catch(() => res.end());
  } catch (err) {
    res.status(500).json({ error: { message: String(err) } });
  }
});

app.post("/v1/messages", async (req, res) => {
  try {
    const messages = req.body.messages || [];
    const system = typeof req.body.system === "string"
      ? [{ role: "system", content: req.body.system }]
      : Array.isArray(req.body.system)
        ? req.body.system.map(s => ({ role: "system", content: s.text || "" }))
        : [];

    const input = [...system, ...messages].map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter(c => c.type === "text").map(c => c.text).join("\n")
          : "",
    })).filter(m => m.role === "user" || m.role === "assistant" || m.role === "system");
    const model = resolveModel(req.body?.model);
    if (!model) return res.status(503).json({ type: "error", error: { type: "overloaded_error", message: "No available models discovered yet" } });
    const useResponses = DEFAULT_MODEL.includes("muse") || availableModels.size === 0;
const endpoint = useResponses ? `${UPSTREAM}/responses` : `${UPSTREAM}/chat/completions`;
const openaiBody = useResponses ? {
  model: model ?? resolveModel(req.body?.model),
  input,
  stream: req.body.stream === true,
} : {
  model: model ?? resolveModel(req.body?.model),
  messages: [...system, ...messages].map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter(c => c.type === "text").map(c => c.text).join("\n") : "",
  })).filter(m => m.role === "user" || m.role === "assistant"),
};

    const resp = await upstreamFetch(`${UPSTREAM}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(openaiBody),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).send(text);
    }

    if (!req.body.stream) {
      const data = await resp.json();
      const outputText = (data.output || [])
        .filter(o => o.type === "message")
        .flatMap(o => (o.content || []).filter(c => c.type === "output_text").map(c => c.text))
        .join("");
      return res.json({
        id: data.id,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: outputText }],
        model: data.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: data.usage?.input_tokens || 0,
          output_tokens: data.usage?.output_tokens || 0,
        },
      });
    }

    // Streaming: parse upstream SSE, re-emit as Anthropic SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let msgId = "msg_" + Date.now();
    let first = true;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "response.output_text.delta") {
              if (first) {
                send("message_start", {
                  type: "message_start",
                  message: { id: msgId, type: "message", role: "assistant", content: [], model: model ?? resolveModel(req.body?.model), usage: { input_tokens: 0, output_tokens: 0 } },
                });
                send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
                first = false;
              }
              send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: evt.delta || "" } });
            }
            if (evt.type === "response.completed") {
              send("content_block_stop", { type: "content_block_stop", index: 0 });
              send("message_delta", {
                type: "message_delta",
                delta: { stop_reason: "end_turn", stop_sequence: null },
                usage: { output_tokens: evt.response?.usage?.output_tokens || 0 },
              });
              send("message_stop", { type: "message_stop" });
            }
          } catch {}
        }
      }
      res.end();
    };
    pump().catch(() => res.end());
  } catch (err) {
    res.status(500).json({ type: "error", error: { type: "api_error", message: String(err) } });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Muse proxy running on http://${HOST}:${PORT}`);
  console.log(`Upstream: ${UPSTREAM}`);
});
