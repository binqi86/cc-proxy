"use strict";

const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const { loadDotEnv, sendJson, logInfo, createDebugLogger } = require("./utils.cjs");
const { loadProviderConfig, getProviderForPath } = require("./provider.cjs");
const { handleModels, handleChatPassthrough, handleResponses, handleAnthropicMessages } = require("./handlers.cjs");

// ── Load environment ──
loadDotEnv(path.join(__dirname, "..", ".env"));

const CONFIG_DIR = process.env.CONFIG_DIR || path.join(__dirname, "..");
const DEBUG_DIR = process.env.DEBUG_DIR || path.join(CONFIG_DIR, "debug_logs");
const PROVIDER_CONFIG_PATH = process.env.PROVIDER_CONFIG_PATH || path.join(CONFIG_DIR, "providers.json");

const PORT = Number(process.env.PORT || 8088);
const HOST = process.env.HOST || "127.0.0.1";
const PROXY_API_KEY = process.env.PROXY_API_KEY || "";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 600000);
const MAX_REQUEST_BODY_SIZE = Number(process.env.MAX_REQUEST_BODY_SIZE || 26214400);

const debugLog = createDebugLogger(DEBUG_DIR);

// ── Load providers ──
const CODEX = loadProviderConfig("CODEX", PROVIDER_CONFIG_PATH);
const CLAUDE = loadProviderConfig("CLAUDE", PROVIDER_CONFIG_PATH);

// ── Auth ──
function isAuthorized(req) {
  if (!PROXY_API_KEY) return true;
  return (req.headers.authorization || "") === `Bearer ${PROXY_API_KEY}`;
}

// ── Router ──
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const provider = getProviderForPath(url.pathname, CODEX, CLAUDE);

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      codex_preset: CODEX.presetId || null,
      claude_preset: CLAUDE.presetId || null,
      codex_target: CODEX.chatUrl,
      claude_target: CLAUDE.chatUrl,
      default_model: CODEX.defaultModel || null,
    });
  }

  // Auth
  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: { message: "Unauthorized", type: "invalid_request_error" } });
  }

  // Models
  if (req.method === "GET" && url.pathname === "/v1/models") {
    const wantsAnthropic = url.searchParams.get("format") === "anthropic" || req.headers["anthropic-version"] != null;
    return handleModels(res, wantsAnthropic, provider);
  }

  // Chat Completions passthrough
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    return handleChatPassthrough(req, res, provider, REQUEST_TIMEOUT_MS, MAX_REQUEST_BODY_SIZE);
  }

  // Responses API (protocol conversion or passthrough)
  if (req.method === "POST" && url.pathname === "/v1/responses") {
    return handleResponses(req, res, provider, REQUEST_TIMEOUT_MS, MAX_REQUEST_BODY_SIZE, debugLog);
  }

  // Anthropic Messages passthrough
  if (req.method === "POST" && url.pathname === "/v1/messages") {
    return handleAnthropicMessages(req, res, provider, REQUEST_TIMEOUT_MS, MAX_REQUEST_BODY_SIZE);
  }

  sendJson(res, 404, { error: { message: `Unsupported: ${req.method} ${url.pathname}`, type: "invalid_request_error" } });
}

// ── Server ──
const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: { message: error.message || "Internal proxy error", type: "proxy_error" } });
  }
});

server.listen(PORT, HOST, () => {
  logInfo(`proxy started on ${HOST}:${PORT}`);
});
