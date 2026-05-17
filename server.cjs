"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

loadDotEnv(path.join(__dirname, ".env"));

const DEBUG_DIR = process.env.DEBUG_DIR || path.join(__dirname, "debug_logs");

function debugLog(label, payload) {
  if (process.env.DEBUG_REASONING !== "1") return;
  try {
    if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(DEBUG_DIR, `${ts}_${label}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  } catch (e) { /* never break the proxy */ }
}

const PROVIDER_CONFIG_PATH = process.env.PROVIDER_CONFIG_PATH || path.join(__dirname, "providers.json");
const PORT = Number(process.env.PORT || 8088);
const HOST = process.env.HOST || "127.0.0.1";
const PROXY_API_KEY = process.env.PROXY_API_KEY || "";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 600000);
const MAX_REQUEST_BODY_SIZE = Number(process.env.MAX_REQUEST_BODY_SIZE || 26214400); // 25MB default (CCX)

// ── Dual provider config ──
// Codex: /v1/responses, /v1/chat/completions (passthrough mode)
// Claude: /v1/messages (Anthropic protocol)
// Backward compat: if CODEX_PROVIDER_PRESET is not set, fall back to PROVIDER_PRESET
// If CLAUDE_PROVIDER_PRESET is not set either, both modes use the same preset.

function loadProviderConfig(mode) {
  const rawPreset = process.env[`${mode}_PROVIDER_PRESET`]
    || (mode === "CODEX" ? (process.env.PROVIDER_PRESET || "") : "")
    || process.env.CODEX_PROVIDER_PRESET
    || process.env.PROVIDER_PRESET
    || "";
  const preset = loadProviderPreset(rawPreset, PROVIDER_CONFIG_PATH);
  const rawApiKey = process.env[`${mode}_TARGET_API_KEY`]
    || (mode === "CODEX" ? (process.env.TARGET_API_KEY || "") : "")
    || process.env.CODEX_TARGET_API_KEY
    || process.env.TARGET_API_KEY
    || "";
  const modeBaseUrl = mode === "CLAUDE" ? preset.claudeBaseUrl : preset.codexBaseUrl;
  const modeChatPath = mode === "CLAUDE" ? preset.claudeChatPath : preset.codexChatPath;
  const modeModelsPath = mode === "CLAUDE" ? preset.claudeModelsPath : preset.codexModelsPath;
  // Backward compat: fall back to old generic fields if mode-specific ones are empty
  const fallbackBaseUrl = modeBaseUrl || preset.baseUrl || "";
  const fallbackChatPath = modeChatPath || preset.chatPath || "/v1/chat/completions";
  const fallbackModelsPath = modeModelsPath || preset.modelsPath || "/v1/models";
  const baseUrl = stripTrailingSlash(
    process.env[`${mode}_TARGET_BASE_URL`]
      || fallbackBaseUrl
      || ""
  );
  const chatPath = process.env[`${mode}_TARGET_CHAT_PATH`]
    || fallbackChatPath
    || "/v1/chat/completions";
  const modelsPath = process.env[`${mode}_TARGET_MODELS_PATH`]
    || fallbackModelsPath
    || "/v1/models";
  const defaultModel = sanitizeModelName(preset.defaultModel || process.env.DEFAULT_MODEL || "");
  const reasoningMapping = {
    ...{ xhigh: "xhigh", high: "high", medium: "medium", low: "low", minimal: "low", none: "none", auto: "auto" },
    ...parseJsonEnv("REASONING_MAPPING", {}),
    ...asObject(preset.reasoningMapping),
  };
  const normalizeChatRoles = preset.normalizeChatRoles != null
    ? preset.normalizeChatRoles
    : parseBooleanEnv("NORMALIZE_CHAT_ROLES", true);
  const modelMap = resolveModelMap(
    { ...parseJsonEnv("MODEL_MAP", {}), ...asObject(preset.modelMap) },
    defaultModel
  );
  const claudeEnvMap = parseJsonEnv("CLAUDE_MODEL_MAP", {});
  const claudeModelMap = Object.keys(preset.claudeModelMap || {}).length > 0
    ? resolveModelMap({...claudeEnvMap, ...asObject(preset.claudeModelMap)}, defaultModel)
    : resolveModelMap({...claudeEnvMap, ...modelMap}, defaultModel);

  return {
    mode,
    presetId: rawPreset,
    apiKey: rawApiKey || preset.apiKey || "",
    chatUrl: joinTargetUrl(baseUrl, chatPath),
    anthropicMessagesUrl: buildAnthropicMessagesUrl(baseUrl, chatPath),
    modelsUrl: joinTargetUrl(baseUrl, modelsPath),
    defaultModel,
    modelMap,
    claudeModelMap,
    reasoningMapping,
    normalizeChatRoles,
  };
}

const CODEX = loadProviderConfig("CODEX");
const CLAUDE = loadProviderConfig("CLAUDE");

function getProviderForPath(pathname) {
  if (pathname === "/v1/messages") return CLAUDE;
  return CODEX;
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: {
        message: error.message || "Internal proxy error",
        type: "proxy_error",
      },
    });
  }
});

server.listen(PORT, HOST, () => {
  logInfo(`proxy started on ${HOST}:${PORT}`);
});

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const provider = getProviderForPath(url.pathname);

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

  if (!isAuthorized(req)) {
    return sendJson(res, 401, {
      error: {
        message: "Unauthorized",
        type: "invalid_request_error",
      },
    });
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    const wantsAnthropic =
      url.searchParams.get("format") === "anthropic" ||
      req.headers["anthropic-version"] != null;
    return handleModels(res, wantsAnthropic, provider);
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    return handleChatPassthrough(req, res, provider);
  }

  if (req.method === "POST" && url.pathname === "/v1/responses") {
    return handleResponses(req, res, provider);
  }

  if (req.method === "POST" && url.pathname === "/v1/messages") {
    return handleAnthropicMessages(req, res, provider);
  }

  sendJson(res, 404, {
    error: {
      message: `Unsupported endpoint: ${req.method} ${url.pathname}`,
      type: "invalid_request_error",
    },
  });
}

async function handleModels(res, wantsAnthropic, provider) {
  if (!provider.apiKey) {
    return sendJson(res, 200, wantsAnthropic ? fallbackAnthropicModels() : fallbackModels(provider));
  }

  try {
    const upstream = await fetch(provider.modelsUrl, {
      headers: upstreamHeaders(provider),
      signal: AbortSignal.timeout(15000),
    });
    const body = await readUpstreamJson(upstream);
    if (!upstream.ok) return sendJson(res, upstream.status, body);
    if (wantsAnthropic) {
      return sendJson(res, 200, normalizeModelsToAnthropic(body));
    }
    return sendJson(res, 200, normalizeModels(body, provider));
  } catch {
    return sendJson(res, 200, wantsAnthropic ? fallbackAnthropicModels() : fallbackModels(provider));
  }
}

async function handleChatPassthrough(req, res, provider) {
  const body = await readJson(req);
  body.__originalModel = body.model;
  body.__endpoint = "/v1/chat/completions";
  body.model = mapModel(body.model, provider);
  patchAssistantReasoningForThinking(body);
  return proxyChatCompletion(body, res, provider);
}

async function handleResponses(req, res, provider) {
  const responsesRequest = await readJson(req);
  debugLog("rq_input", responsesRequest);

  // Warp/Codex stateless mode: pre-extract encrypted_content from reasoning items
  if (Array.isArray(responsesRequest.input)) {
    for (const item of responsesRequest.input) {
      if (item && item.type === "reasoning" && typeof item.encrypted_content === "string" && item.encrypted_content) {
        item.reasoning_content = item.reasoning_content || item.encrypted_content;
      }
    }
  }

  const chatRequest = responsesToChatRequest(responsesRequest, provider);
  chatRequest.__endpoint = "/v1/responses";
  patchAssistantReasoningForThinking(chatRequest);
  debugLog("rq_chat", chatRequest);

  if (chatRequest.stream) {
    return proxyResponsesStream(responsesRequest, chatRequest, res, provider);
  }

  const upstream = await fetchChatCompletion(chatRequest, provider);
  const upstreamBody = await readUpstreamJson(upstream);
  if (!upstream.ok) return sendJson(res, upstream.status, upstreamBody);

  const responseBody = convertChatResponseToResponses(upstreamBody, responsesRequest, chatRequest.model);
  return sendJson(res, 200, responseBody);
}

async function proxyChatCompletion(body, res, provider) {
  const upstream = await fetchChatCompletion(body, provider);
  copyStatusAndHeaders(upstream, res, ["content-type"]);
  res.statusCode = upstream.status;
  if (upstream.body) {
    await pipeWebStream(upstream.body, res);
  } else {
    res.end();
  }
}

// ===================================================================
// CCX-aligned: streaming Responses handler
// ===================================================================

async function proxyResponsesStream(originalRequest, chatRequest, res, provider) {
  const state = { initialized: false, started: false };
  const events = [];

  const upstream = await fetchChatCompletion(chatRequest, provider);
  if (!upstream.ok || !upstream.body) {
    const body = await readUpstreamJson(upstream);
    debugLog("rq_error", { status: upstream.status, body });
    return sendJson(res, upstream.status, body);
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  try {
    await consumeChatCompletionStream(upstream.body, (chunk) => {
      const results = convertChatStreamToResponses(chunk, state, originalRequest, chatRequest.model);
      for (const ev of results) {
        res.write(`event: ${ev.event}\n`);
        res.write(`data: ${ev.data}\n\n`);
      }
    });

    // Emit completed
    const completed = buildResponsesCompletedEvent(state, originalRequest, chatRequest.model);
    res.write(`event: response.completed\n`);
    res.write(`data: ${JSON.stringify(completed)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    sendSse(res, "response.failed", {
      type: "response.failed",
      response: {
        id: state.responseId || makeId("resp"),
        object: "response",
        created_at: state.createdAt || Math.floor(Date.now() / 1000),
        status: "failed",
        model: chatRequest.model,
        output: [],
        error: { message: error.message, type: "proxy_stream_error" },
      },
    });
    res.end();
  }
}

async function fetchChatCompletion(body, provider) {
  if (!provider.apiKey) {
    const error = new Error("TARGET_API_KEY is required");
    error.statusCode = 500;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startTime = Date.now();
  try {
    // CCX: only send known fields (no blind passthrough)
    const { __originalModel, __endpoint, ...cleanBody } = body;
    logUpstreamRequest(body, cleanBody, provider);
    const response = await fetch(provider.chatUrl, {
      method: "POST",
      headers: upstreamHeaders(provider),
      body: JSON.stringify(cleanBody),
      signal: controller.signal,
    });
    logUpstreamResponse(response.status, Date.now() - startTime, null, provider);
    return response;
  } catch (error) {
    logUpstreamResponse(0, Date.now() - startTime, error, provider);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ===================================================================
// CCX-aligned: ConvertOpenAIChatToResponses (streaming)
// ===================================================================

function convertChatStreamToResponses(chunk, state, originalRequest, modelName) {
  const out = [];

  if (!state.initialized) {
    state.initialized = true;
    state.responseId = chunk.id || ("resp_" + Date.now() + "_" + Math.random().toString(36).slice(2));
    state.createdAt = Math.floor(Date.now() / 1000);
    state.outputIndex = 0;
    state.inText = false;
    state.inFunc = false;
    state.textBuf = "";
    state.reasoningBuf = "";
    state.reasoningActive = false;
    state.funcCalls = new Map(); // index → { id, name, args }
    state.usage = null;
  }

  const send = (event, payload) => out.push({ event, data: JSON.stringify(payload) });

  if (!state.started) {
    state.started = true;
    send("response.created", {
      type: "response.created", response: {
        id: state.responseId, object: "response", created_at: state.createdAt,
        status: "in_progress", model: modelName, output: [],
      }
    });
    send("response.in_progress", {
      type: "response.in_progress", response: {
        id: state.responseId, object: "response", created_at: state.createdAt, status: "in_progress",
      }
    });
  }

  const choices = chunk.choices || [];
  for (const choice of choices) {
    const delta = choice.delta || {};
    const finishReason = choice.finish_reason;

    // Reasoning content (CCX: o1 reasoning)
    if (delta.reasoning_content) {
      if (!state.reasoningActive) {
        state.reasoningActive = true;
        state.reasoningItemId = `rs_${state.responseId}_0`;
        send("response.output_item.added", { type: "response.output_item.added", output_index: 0,
          item: { id: state.reasoningItemId, type: "reasoning", status: "in_progress", content: [], summary: [] } });
        send("response.reasoning_summary_part.added", { type: "response.reasoning_summary_part.added",
          item_id: state.reasoningItemId, output_index: 0, summary_index: 0,
          part: { type: "summary_text", text: "" } });
      }
      state.reasoningBuf += delta.reasoning_content;
      send("response.reasoning_summary_text.delta", { type: "response.reasoning_summary_text.delta",
        item_id: state.reasoningItemId, output_index: 0, summary_index: 0,
        delta: delta.reasoning_content });
    }

    // Text content
    if (delta.content) {
      if (state.reasoningActive) closeReasoningBlock(state, send);
      if (!state.inText) {
        state.inText = true;
        const oi = state.reasoningActive ? 1 : 0;
        state.msgId = `msg_${state.responseId}_${oi}`;
        send("response.output_item.added", { type: "response.output_item.added", output_index: oi,
          item: { id: state.msgId, type: "message", status: "in_progress", role: "assistant", content: [],
            reasoning_content: state.reasoningBuf || undefined } });
        send("response.content_part.added", { type: "response.content_part.added", item_id: state.msgId,
          output_index: oi, content_index: 0,
          part: { type: "output_text", text: "", annotations: [] } });
      }
      state.textBuf += delta.content;
      const oi = state.reasoningActive ? 1 : 0;
      send("response.output_text.delta", { type: "response.output_text.delta", item_id: state.msgId,
        output_index: oi, content_index: 0, delta: delta.content });
    }

    // Tool calls
    if (Array.isArray(delta.tool_calls)) {
      if (state.reasoningActive) closeReasoningBlock(state, send);
      if (state.inText) closeTextBlock(state, send);
      for (const tc of delta.tool_calls) {
        const idx = tc.index != null ? tc.index : state.funcCalls.size;
        let fc = state.funcCalls.get(idx);
        if (!fc) { fc = { id: "", name: "", args: "" }; state.funcCalls.set(idx, fc); }
        if (tc.id) { fc.id = tc.id; state.inFunc = true;
          const oi = (state.reasoningActive ? 1 : 0) + (state.msgId ? 1 : 0) + idx;
          send("response.output_item.added", { type: "response.output_item.added", output_index: oi,
            item: { id: `fc_${tc.id}`, type: "function_call", status: "in_progress",
              call_id: tc.id, name: "", arguments: "" } });
        }
        if (tc.function) {
          if (tc.function.name) fc.name = tc.function.name;
          if (tc.function.arguments) { fc.args += tc.function.arguments;
            const oi = (state.reasoningActive ? 1 : 0) + (state.msgId ? 1 : 0) + idx;
            send("response.function_call_arguments.delta", { type: "response.function_call_arguments.delta",
              item_id: `fc_${fc.id}`, output_index: oi, delta: tc.function.arguments });
          }
        }
      }
    }

    if (finishReason) {
      if (state.reasoningActive) closeReasoningBlock(state, send);
      if (state.inText) closeTextBlock(state, send);
      if (state.inFunc) closeFuncBlocks(state, send);
    }
  }

  // Usage (CCX: multi-format support)
  if (chunk.usage) { state.usage = normalizeUsageCCX(chunk.usage); }

  return out;
}

function closeReasoningBlock(state, send) {
  if (!state.reasoningActive) return;
  const full = state.reasoningBuf;
  send("response.reasoning_summary_text.done", { type: "response.reasoning_summary_text.done",
    item_id: state.reasoningItemId, output_index: 0, summary_index: 0, text: full });
  send("response.reasoning_summary_part.done", { type: "response.reasoning_summary_part.done",
    item_id: state.reasoningItemId, output_index: 0, summary_index: 0,
    part: { type: "summary_text", text: full } });
  send("response.output_item.done", { type: "response.output_item.done", output_index: 0,
    item: { id: state.reasoningItemId, type: "reasoning", status: "completed",
      content: [{ type: "reasoning_text", text: full }],
      summary: [{ type: "summary_text", text: full }],
      encrypted_content: full } });
  state.reasoningActive = false;
}

function closeTextBlock(state, send) {
  if (!state.inText) return;
  const oi = state.reasoningActive ? 1 : 0;
  const text = state.textBuf;
  send("response.output_text.done", { type: "response.output_text.done", item_id: state.msgId,
    output_index: oi, content_index: 0, text });
  send("response.content_part.done", { type: "response.content_part.done", item_id: state.msgId,
    output_index: oi, content_index: 0, part: { type: "output_text", text, annotations: [] } });
  send("response.output_item.done", { type: "response.output_item.done", output_index: oi,
    item: { id: state.msgId, type: "message", status: "completed", role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
      reasoning_content: state.reasoningBuf || undefined } });
  state.inText = false;
}

function closeFuncBlocks(state, send) {
  if (!state.inFunc || state.funcCalls.size === 0) return;
  const sorted = [...state.funcCalls.entries()].sort((a, b) => a[0] - b[0]);
  for (const [idx, fc] of sorted) {
    const oi = (state.reasoningActive ? 1 : 0) + (state.msgId ? 1 : 0) + idx;
    send("response.function_call_arguments.done", { type: "response.function_call_arguments.done",
      item_id: `fc_${fc.id}`, output_index: oi, arguments: fc.args || "{}" });
    send("response.output_item.done", { type: "response.output_item.done", output_index: oi,
      item: { id: `fc_${fc.id}`, type: "function_call", status: "completed",
        call_id: fc.id, name: fc.name, arguments: fc.args || "{}" } });
  }
  state.inFunc = false;
}

function buildResponsesCompletedEvent(state, originalRequest, modelName) {
  const output = [];
  if (state.reasoningBuf) {
    output.push({ id: state.reasoningItemId, type: "reasoning", status: "completed",
      content: [{ type: "reasoning_text", text: state.reasoningBuf }],
      summary: [{ type: "summary_text", text: state.reasoningBuf }],
      encrypted_content: state.reasoningBuf });
  }
  if (state.msgId) {
    output.push({ id: state.msgId, type: "message", status: "completed", role: "assistant",
      content: [{ type: "output_text", text: state.textBuf, annotations: [] }],
      reasoning_content: state.reasoningBuf || undefined });
  }
  for (const [, fc] of [...state.funcCalls.entries()].sort((a, b) => a[0] - b[0])) {
    output.push({ id: `fc_${fc.id}`, type: "function_call", status: "completed",
      call_id: fc.id, name: fc.name, arguments: fc.args || "{}" });
  }

  const usage = state.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  return {
    type: "response.completed",
    response: {
      id: state.responseId, object: "response", created_at: state.createdAt,
      status: "completed", model: modelName, output,
      instructions: originalRequest.instructions || null,
      max_output_tokens: originalRequest.max_output_tokens || null,
      temperature: originalRequest.temperature ?? null,
      top_p: originalRequest.top_p ?? null,
      tools: originalRequest.tools || [],
      tool_choice: originalRequest.tool_choice || "auto",
      parallel_tool_calls: originalRequest.parallel_tool_calls ?? true,
      previous_response_id: originalRequest.previous_response_id || null,
      metadata: originalRequest.metadata || {},
      usage,
    }
  };
}

// CCX: normalize usage (supports OpenAI + Claude + Gemini formats)
function normalizeUsageCCX(usage) {
  if (!usage) return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let input = 0, output = 0, total = 0;
  // Claude format (priority)
  if (usage.input_tokens != null) input = Number(usage.input_tokens);
  else if (usage.prompt_tokens != null) input = Number(usage.prompt_tokens);
  if (usage.output_tokens != null) output = Number(usage.output_tokens);
  else if (usage.completion_tokens != null) output = Number(usage.completion_tokens);
  else if (usage.candidatesTokenCount != null) output = Number(usage.candidatesTokenCount);
  total = usage.total_tokens != null ? Number(usage.total_tokens) : (input + output);
  // Gemini: subtract cached from prompt
  if (usage.promptTokenCount != null) {
    input = Number(usage.promptTokenCount) - Number(usage.cachedContentTokenCount || 0);
    if (input < 0) input = 0;
    output = Number(usage.candidatesTokenCount || 0);
    total = input + output;
  }
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}

// CCX: ConvertOpenAIChatToResponsesNonStream (non-streaming)
function convertChatResponseToResponses(chatBody, originalRequest, modelName) {
  const choice = (chatBody.choices || [{}])[0];
  const message = choice.message || {};
  const output = [];
  let outputIndex = 0;

  // Reasoning
  if (message.reasoning_content) {
    output.push({ id: `rs_resp_0`, type: "reasoning", status: "completed",
      content: [{ type: "reasoning_text", text: message.reasoning_content }],
      summary: [{ type: "summary_text", text: message.reasoning_content }],
      encrypted_content: message.reasoning_content });
    outputIndex = 1;
  }

  // Text message
  if (message.content) {
    output.push({ id: `msg_resp_${outputIndex}`, type: "message", status: "completed", role: "assistant",
      content: [{ type: "output_text", text: message.content, annotations: [] }],
      reasoning_content: message.reasoning_content || undefined });
  }

  // Tool calls
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      const f = tc.function || {};
      output.push({ id: `fc_${tc.id || makeId("call")}`, type: "function_call", status: "completed",
        call_id: tc.id, name: f.name || "", arguments: f.arguments || "{}" });
    }
  }

  const usage = normalizeUsageCCX(chatBody.usage);
  return {
    id: chatBody.id || makeId("resp"),
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: modelName,
    output,
    instructions: originalRequest.instructions || null,
    max_output_tokens: originalRequest.max_output_tokens || null,
    temperature: originalRequest.temperature ?? null,
    top_p: originalRequest.top_p ?? null,
    tools: originalRequest.tools || [],
    tool_choice: originalRequest.tool_choice || "auto",
    parallel_tool_calls: originalRequest.parallel_tool_calls ?? true,
    previous_response_id: originalRequest.previous_response_id || null,
    metadata: originalRequest.metadata || {},
    usage,
  };
}

// ===================================================================
// CCX-aligned: ConvertResponsesToOpenAIChatRequest
// ===================================================================

function responsesToChatRequest(request, provider) {
  const chat = {
    model: mapModel(request.model, provider),
    __originalModel: request.model,
    messages: [],
    stream: Boolean(request.stream),
  };

  // stream_options: pass through original, or default for usage
  if (request.stream_options) {
    chat.stream_options = request.stream_options;
  } else if (chat.stream) {
    chat.stream_options = { include_usage: true };
  }

  // CCX: max_output_tokens → max_tokens
  if (request.max_output_tokens != null) {
    chat.max_tokens = request.max_output_tokens;
  }

  // CCX: parameter passthrough (OpenAIChatConverter.ToProviderRequest)
  copyIfPresent(request, chat, "temperature");
  copyIfPresent(request, chat, "top_p");
  copyIfPresent(request, chat, "frequency_penalty");
  copyIfPresent(request, chat, "presence_penalty");
  copyIfPresent(request, chat, "stop");
  copyIfPresent(request, chat, "seed");
  copyIfPresent(request, chat, "user");

  // CCX: parallel_tool_calls
  if (request.parallel_tool_calls != null) {
    chat.parallel_tool_calls = Boolean(request.parallel_tool_calls);
  }

  // CCX: instructions → system message
  if (request.instructions) {
    chat.messages.push({ role: "system", content: stringifyContent(request.instructions) });
  }

  // CCX: input array → messages (with function_call merging)
  if (request.input != null) {
    if (typeof request.input === "string") {
      chat.messages.push({ role: "user", content: request.input });
    } else if (Array.isArray(request.input)) {
      const pendingToolCalls = [];
      let pendingReasoningContent = "";
      let lastAssistantMessage = null;
      const appendReasoning = (target, reasoning) => {
        if (!target || !reasoning) return;
        target.reasoning_content = target.reasoning_content
          ? `${target.reasoning_content}\n${reasoning}`
          : reasoning;
      };
      const takePendingReasoning = () => pendingReasoningContent.trim();
      const flushToolCalls = () => {
        if (pendingToolCalls.length === 0) return;
        const msg = { role: "assistant", tool_calls: pendingToolCalls.splice(0) };
        const reasoning = takePendingReasoning();
        if (reasoning) {
          appendReasoning(msg, reasoning);
        }
        chat.messages.push(msg);
        lastAssistantMessage = msg;
      };
      for (const item of request.input) {
        if (!item || typeof item !== "object") continue;
        const type = item.type || (item.role ? "message" : "");
        switch (type) {
          case "message": {
            flushToolCalls();
            const role = normalizeRole(item.role || "user", provider.normalizeChatRoles);
            const content = extractContentText(item.content);
            const msg = { role, content };
            const explicitReasoning = extractExplicitReasoningText(item);
            const reasoning = role === "assistant"
              ? (explicitReasoning || takePendingReasoning())
              : "";
            if (role === "assistant" && reasoning) {
              appendReasoning(msg, reasoning);
            }
            chat.messages.push(msg);
            lastAssistantMessage = role === "assistant" ? msg : null;
            if (role !== "assistant") {
              pendingReasoningContent = "";
            }
            break;
          }
          case "reasoning": {
            const reasoning = extractReasoningText(item);
            if (reasoning) {
              pendingReasoningContent = reasoning;
            }
            break;
          }
          case "function_call": {
            pendingToolCalls.push({
              id: item.call_id || item.id || makeId("call"),
              type: "function",
              function: { name: item.name || "", arguments: item.arguments || "" }
            });
            break;
          }
          case "function_call_output": {
            flushToolCalls();
            chat.messages.push({
              role: "tool",
              tool_call_id: item.call_id || "",
              content: typeof item.output === "string" ? item.output : JSON.stringify(item.output || "")
            });
            break;
          }
        }
      }
      flushToolCalls();
    }
  }

  // CCX: normalizeOpenAIToolCallMessageOrder
  chat.messages = normalizeMessageOrder(chat.messages);

  // CCX: responsesToolsToOpenAI
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    chat.tools = request.tools
      .map(t => {
        const name = t.type === "function" && t.function ? t.function.name : t.name;
        if (!name) return null;
        if (t.type === "function" && t.function) return t;
        return { type: "function", function: { name, description: t.description || "", parameters: t.parameters || t.input_schema || { type: "object" } } };
      })
      .filter(Boolean);
    if (chat.tools.length > 0) {
      if (request.tool_choice != null) chat.tool_choice = request.tool_choice;
    }
  }

  // CCX: reasoning.effort → reasoning_effort
  if (request.reasoning && request.reasoning.effort) {
    chat.reasoning_effort = provider.reasoningMapping[request.reasoning.effort] || "auto";
  }

  return chat;
}

// CCX: normalizeOpenAIToolCallMessageOrder
function normalizeMessageOrder(messages) {
  const result = [...messages];
  for (let i = 0; i < result.length; i++) {
    const ids = getToolCallIds(result[i]);
    if (!ids || ids.size === 0) continue;

    const toolMsgs = [];
    const deferred = [];
    let end = i;
    for (let j = i + 1; j < result.length; j++) {
      const toolId = getToolMessageId(result[j]);
      if (toolId && ids.has(toolId)) {
        toolMsgs.push(result[j]);
        ids.delete(toolId);
      } else {
        deferred.push(result[j]);
      }
      end = j;
    }
    if (ids.size > 0 || deferred.length === 0) continue;

    result.splice(i + 1, end - i, ...toolMsgs, ...deferred);
    i += toolMsgs.length;
  }
  return result;
}

function getToolCallIds(msg) {
  if (msg.role !== "assistant" || !Array.isArray(msg.tool_calls)) return null;
  return new Set(msg.tool_calls.map(tc => tc.id).filter(Boolean));
}

function getToolMessageId(msg) {
  return msg.role === "tool" ? msg.tool_call_id || "" : "";
}

// CCX: extract text from nested content blocks
function extractContentText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .filter(c => c && typeof c === "object" && (c.type === "input_text" || c.type === "output_text" || c.type === "text" || !c.type))
    .map(c => c.text || "")
    .filter(Boolean)
    .join("\n");
}

function extractReasoningText(item) {
  if (!item || typeof item !== "object") return "";
  const explicit = extractExplicitReasoningText(item);
  if (explicit) return explicit;
  // Warp stateless mode: encrypted_content contains the reasoning plain text
  if (typeof item.encrypted_content === "string" && item.encrypted_content) return item.encrypted_content;
  if (typeof item.text === "string") return item.text;
  if (Array.isArray(item.summary)) {
    return item.summary
      .map(part => {
        if (!part || typeof part !== "object") return "";
        return typeof part.text === "string" ? part.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return extractContentText(item.content);
}

function extractExplicitReasoningText(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.reasoning_content === "string") return item.reasoning_content;
  if (item.reasoning && typeof item.reasoning === "object") {
    if (typeof item.reasoning.content === "string") return item.reasoning.content;
    if (typeof item.reasoning.text === "string") return item.reasoning.text;
  }
  if (Array.isArray(item.content)) {
    const text = item.content
      .map(part => {
        if (!part || typeof part !== "object") return "";
        const t = String(part.type || "").toLowerCase();
        if (!t.includes("reasoning")) return "";
        if (typeof part.reasoning_content === "string") return part.reasoning_content;
        if (typeof part.text === "string") return part.text;
        if (part.reasoning && typeof part.reasoning === "object") {
          if (typeof part.reasoning.content === "string") return part.reasoning.content;
          if (typeof part.reasoning.text === "string") return part.reasoning.text;
        }
        if (Array.isArray(part.summary)) {
          return part.summary
            .map(s => (s && typeof s === "object" && typeof s.text === "string") ? s.text : "")
            .filter(Boolean)
            .join("\n");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  return "";
}

function patchAssistantReasoningForThinking(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return;
  if (!needsReasoningContentPatch(body)) return;

  let patchedCount = 0;
  body.messages = body.messages.map((message) => {
    if (!message || typeof message !== "object" || message.role !== "assistant") {
      return message;
    }
    if (typeof message.reasoning_content === "string") {
      return message;
    }

    const inferredReasoning = inferAssistantReasoningText(message);
    patchedCount += 1;
    return {
      ...message,
      reasoning_content: inferredReasoning || "",
    };
  });

  if (patchedCount > 0) {
    logInfo(`patched reasoning_content for ${patchedCount} assistant messages`);
  }
}

function needsReasoningContentPatch(body) {
  if (!body || typeof body !== "object") return false;
  if (body.reasoning || body.reasoning_effort || body.thinking) return true;
  if (!Array.isArray(body.messages)) return false;
  return body.messages.some((message) => hasAssistantReasoningSignals(message));
}

function inferAssistantReasoningText(message) {
  const explicit = extractExplicitReasoningText(message);
  if (explicit) return explicit;

  if (Array.isArray(message.reasoning_details)) {
    const detailText = message.reasoning_details
      .map((detail) => {
        if (!detail || typeof detail !== "object") return "";
        if (typeof detail.text === "string") return detail.text;
        if (typeof detail.reasoning_content === "string") return detail.reasoning_content;
        if (typeof detail.content === "string") return detail.content;
        if (detail.reasoning && typeof detail.reasoning === "object") {
          if (typeof detail.reasoning.content === "string") return detail.reasoning.content;
          if (typeof detail.reasoning.text === "string") return detail.reasoning.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    if (detailText) return detailText;
  }

  return "";
}

function hasAssistantReasoningSignals(message) {
  if (!message || typeof message !== "object" || message.role !== "assistant") return false;
  if (typeof message.reasoning_content === "string") return true;
  if (Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0) return true;
  return Boolean(inferAssistantReasoningText(message));
}

async function consumeChatCompletionStream(body, onChunk) {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const rawChunk of body) {
    buffer += decoder.decode(rawChunk, { stream: true });
    let separatorIndex;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      for (const data of parseSseData(frame)) {
        if (data === "[DONE]") return;
        if (!data) continue;
        onChunk(JSON.parse(data));
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    for (const data of parseSseData(tail)) {
      if (data !== "[DONE]") onChunk(JSON.parse(data));
    }
  }
}

function parseSseData(frame) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data ? [data] : [];
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function normalizeRole(role, normalize) {
  if (!normalize) return role;
  if (role === "developer") return "system";
  if (role === "assistant" || role === "system" || role === "tool") return role;
  return "user";
}

function mapModel(model, provider) {
  const requested = sanitizeModelName(model || provider.defaultModel);
  return provider.modelMap[requested] || provider.defaultModel || requested;
}

function fallbackModels(provider) {
  const model = provider.defaultModel || Object.values(provider.modelMap)[0] || Object.keys(provider.modelMap)[0] || "default-model";
  return {
    object: "list",
    data: [
      {
        id: model,
        object: "model",
        created: 0,
        owned_by: "codex-cn-proxy",
      },
    ],
  };
}

function normalizeModels(body, provider) {
  if (body && Array.isArray(body.data)) return body;
  return fallbackModels(provider);
}

function upstreamHeaders(provider) {
  return {
    authorization: `Bearer ${provider.apiKey}`,
    "content-type": "application/json",
  };
}

function upstreamAnthropicHeaders(provider, req) {
  const incomingVersion = req && req.headers ? req.headers["anthropic-version"] : null;
  const incomingBeta = req && req.headers ? req.headers["anthropic-beta"] : null;
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${provider.apiKey}`,
    "x-api-key": provider.apiKey,
    "anthropic-version": typeof incomingVersion === "string" && incomingVersion ? incomingVersion : "2023-06-01",
  };
  if (typeof incomingBeta === "string" && incomingBeta) {
    headers["anthropic-beta"] = incomingBeta;
  }
  return headers;
}

function isAuthorized(req) {
  if (!PROXY_API_KEY) return true;
  const authorization = req.headers.authorization || "";
  return authorization === `Bearer ${PROXY_API_KEY}`;
}

async function readJson(req) {
  const body = await readRequestBody(req);
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Invalid JSON request body");
    error.statusCode = 400;
    throw error;
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_REQUEST_BODY_SIZE) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readUpstreamJson(upstream) {
  const text = await upstream.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: {
        message: text,
        type: "upstream_error",
      },
    };
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body, null, 2));
}

function copyStatusAndHeaders(upstream, res, headerNames) {
  for (const name of headerNames) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
}

async function pipeWebStream(stream, res) {
  for await (const chunk of stream) {
    res.write(Buffer.from(chunk));
  }
  res.end();
}

function copyIfPresent(source, target, key) {
  if (source[key] != null) target[key] = source[key];
}

function stringifyContent(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(`Ignoring invalid JSON in ${name}`);
    return fallback;
  }
}

function parseBooleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return fallback !== undefined ? fallback : false;
  return raw === "1" || raw === "true" || raw === "yes";
}

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function loadProviderPreset(preset, filePath) {
  if (!preset) return {};
  const providers = readJsonFile(filePath);
  const provider = providers[preset];
  if (!provider) {
    throw new Error(`Unknown PROVIDER_PRESET "${preset}" in ${filePath}`);
  }
  return asObject(provider);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read provider config ${filePath}: ${error.message}`);
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveModelMap(modelMap, defaultModel) {
  return Object.fromEntries(
    Object.entries(modelMap)
      .map(([from, to]) => [sanitizeModelName(from), to === "$DEFAULT_MODEL" ? defaultModel : sanitizeModelName(to)])
      .filter(([from, to]) => from && to)
  );
}

function ts() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function logInfo(msg) {
  console.log(`${ts()} INFO [SYSTEM] ${msg}`);
}

function logUpstreamRequest(originalBody, body, provider) {
  const source = normalizeLogSource(provider && provider.mode);
  const endpoint = originalBody.__endpoint || "/v1/chat/completions";
  const sourceModel = originalBody.__originalModel;
  const targetModel = body.model;
  const streamLabel = body.stream ? " stream" : "";

  console.log(`${ts()} INFO [${source}] 请求: POST ${endpoint}`);
  if (sourceModel && sourceModel !== targetModel) {
    console.log(`${ts()} INFO [${source}] 模型映射: ${sourceModel} → ${targetModel}`);
  }
  console.log(`${ts()} INFO [${source}] 转发请求 → ${targetModel}${streamLabel}`);
}

function logUpstreamResponse(status, latencyMs, error, provider) {
  const source = normalizeLogSource(provider && provider.mode);
  if (error) {
    console.log(`${ts()} INFO [${source}] ✗ upstream error | ${error.message} | ${latencyMs}ms`);
  } else {
    console.log(`${ts()} INFO [${source}] 响应: ${status} | ${latencyMs}ms`);
  }
}

function normalizeLogSource(source) {
  const upper = String(source || "").toUpperCase();
  if (upper === "CODEX" || upper === "CLAUDE") return upper;
  return "SYSTEM";
}

function requireConfig(name, value) {
  if (value) return value;
  throw new Error(`Missing required config: ${name}`);
}

function joinTargetUrl(baseUrl, targetPath) {
  if (/^https?:\/\//i.test(targetPath)) return targetPath;
  return `${stripTrailingSlash(baseUrl)}/${targetPath.replace(/^\/+/, "")}`;
}

function buildAnthropicMessagesUrl(baseUrl, chatPath) {
  if (/^https?:\/\//i.test(chatPath)) {
    if (/\/v1\/messages$/i.test(chatPath)) return chatPath;
    if (/\/v1\/chat\/completions$/i.test(chatPath)) return chatPath.replace(/\/v1\/chat\/completions$/i, "/v1/messages");
    if (/\/chat\/completions$/i.test(chatPath)) return chatPath.replace(/\/chat\/completions$/i, "/v1/messages");
  }

  const normalizedPath = String(chatPath || "").replace(/^\/+/, "/");
  if (/\/v1\/messages$/i.test(normalizedPath)) {
    return joinTargetUrl(baseUrl, normalizedPath);
  }
  if (/\/v1\/chat\/completions$/i.test(normalizedPath)) {
    return joinTargetUrl(baseUrl, normalizedPath.replace(/\/v1\/chat\/completions$/i, "/v1/messages"));
  }
  if (/\/chat\/completions$/i.test(normalizedPath)) {
    return joinTargetUrl(baseUrl, normalizedPath.replace(/\/chat\/completions$/i, "/v1/messages"));
  }
  return joinTargetUrl(baseUrl, "/v1/messages");
}

function isAnthropicNativeProvider(provider) {
  const chatUrl = String(provider && provider.chatUrl || "").toLowerCase();
  return /\/v1\/messages$/.test(chatUrl) || /\/messages$/.test(chatUrl);
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] != null) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// ============================================================
//  Claude / Anthropic Messages API support
// ============================================================

function resolveClaudeModelMap(claudeMap, defaultModel) {
  if (Object.keys(claudeMap).length > 0) return claudeMap;
  const fallback = {};
  for (const [key, value] of Object.entries(MODEL_MAP)) {
    fallback[key] = value;
  }
  return fallback;
}

function mapClaudeModel(model, provider) {
  const requested = sanitizeModelName(model || provider.defaultModel);
  return provider.claudeModelMap[requested] || provider.defaultModel || requested;
}

function sanitizeModelName(value) {
  if (value == null) return "";
  const normalized = String(value)
    .replace(/\x1B\[[0-9;]*m/g, "")
    .replace(/[ -]/g, "")
    .trim();
  return normalized;
}

// ---- content helpers ----

function anthropicContentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && typeof block.text === "string") return block.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolResultContent(block) {
  const content = block.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = anthropicContentToText(content);
    return text || JSON.stringify(content);
  }
  if (content == null) return "";
  if (typeof content === "object") return JSON.stringify(content);
  return String(content);
}

// ---- Anthropic -> OpenAI Chat conversion ----

function anthropicToolsToOpenai(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") return null;
      if (tool.type === "function" && tool.function) return tool;
      const name = tool.name;
      if (!name) return null;
      return {
        type: "function",
        function: {
          name: name,
          description: tool.description || "",
          parameters: tool.input_schema || tool.parameters || { type: "object" },
        },
      };
    })
    .filter(Boolean);
}

function anthropicToolChoiceToOpenai(toolChoice) {
  if (!toolChoice || typeof toolChoice !== "object") return toolChoice;
  const ct = toolChoice.type;
  if (ct === "auto") return "auto";
  if (ct === "any") return "required";
  if (ct === "none") return "none";
  if (ct === "tool" && toolChoice.name) {
    return { type: "function", function: { name: toolChoice.name } };
  }
  return toolChoice;
}

function anthropicMessageToOpenai(message) {
  const role = message.role || "user";
  const content = message.content;

  if (!Array.isArray(content)) {
    const normalizedRole =
      role === "assistant" || role === "system" || role === "tool" ? role : "user";
    return [{ role: normalizedRole, content: anthropicContentToText(content) }];
  }

  const textBlocks = [];
  const toolCalls = [];
  const toolMessages = [];

  for (const block of content) {
    if (!block || typeof block !== "object") {
      textBlocks.push(String(block));
      continue;
    }
    const blockType = block.type;
    if (blockType === "tool_result") {
      toolMessages.push({
        role: "tool",
        tool_call_id: block.tool_use_id || block.id || "",
        content: toolResultContent(block),
      });
    } else if (blockType === "tool_use") {
      toolCalls.push({
        id: block.id || makeId("call"),
        type: "function",
        function: {
          name: block.name || "tool",
          arguments: JSON.stringify(block.input || {}),
        },
      });
    } else if (typeof block.text === "string") {
      textBlocks.push(block.text);
    }
  }

  const messages = [];

  if (role === "assistant" && toolCalls.length > 0) {
    messages.push({
      role: "assistant",
      content: textBlocks.join("\n") || null,
      tool_calls: toolCalls,
    });
  } else if (role === "user" && toolMessages.length > 0) {
    messages.push(...toolMessages);
    const text = textBlocks.join("\n");
    if (text) messages.push({ role: "user", content: text });
  } else {
    const validRole = ["system", "user", "assistant", "tool"].includes(role) ? role : "user";
    messages.push({ role: validRole, content: textBlocks.join("\n") });
  }

  return messages;
}

function anthropicToOpenaiChatBody(body, stream) {
  const messages = (body.messages || []).map((m) => ({ ...m }));

  let systemContent = body.system;
  if (!systemContent && messages.length > 0 && messages[0].role === "system") {
    systemContent = messages.shift().content;
  }

  const openaiMessages = [];
  const systemText = anthropicContentToText(systemContent);
  if (systemText) {
    openaiMessages.push({ role: "system", content: systemText });
  }

  for (const msg of messages) {
    openaiMessages.push(...anthropicMessageToOpenai(msg));
  }

  const openaiBody = {
    model: body.model || "",
    messages: openaiMessages,
    max_tokens: body.max_tokens || 4096,
    stream: stream,
  };

  if (body.temperature != null) openaiBody.temperature = body.temperature;
  if (body.top_p != null) openaiBody.top_p = body.top_p;
  if (body.stop_sequences && body.stop_sequences.length > 0) {
    openaiBody.stop = body.stop_sequences;
  }

  const tools = anthropicToolsToOpenai(body.tools);
  if (tools.length > 0) {
    openaiBody.tools = tools;
    if (body.tool_choice != null) {
      openaiBody.tool_choice = anthropicToolChoiceToOpenai(body.tool_choice);
    }
  }

  return openaiBody;
}

// ---- OpenAI Chat -> Anthropic conversion ----

function toolCallToAnthropicBlock(toolCall) {
  const func = toolCall.function || {};
  let parsedArgs;
  try {
    parsedArgs = typeof func.arguments === "string" ? JSON.parse(func.arguments) : func.arguments;
  } catch {
    parsedArgs = { arguments: func.arguments };
  }
  return {
    type: "tool_use",
    id: toolCall.id || makeId("toolu"),
    name: func.name || "tool",
    input: parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)
      ? parsedArgs
      : { value: parsedArgs },
  };
}

function openaiFinishReasonToAnthropic(reason, hasToolCalls) {
  if (hasToolCalls) return "tool_use";
  const mapping = {
    stop: "end_turn",
    length: "max_tokens",
    tool_calls: "tool_use",
    function_call: "tool_use",
  };
  return mapping[reason] || "end_turn";
}

function openaiChatToAnthropic(openaiResp, model) {
  const choice = (openaiResp.choices || [{}])[0];
  const message = choice.message || {};
  const contentBlocks = [];

  if (message.content) {
    contentBlocks.push({ type: "text", text: message.content });
  }
  for (const toolCall of message.tool_calls || []) {
    if (toolCall && typeof toolCall === "object") {
      contentBlocks.push(toolCallToAnthropicBlock(toolCall));
    }
  }
  if (contentBlocks.length === 0) {
    contentBlocks.push({ type: "text", text: "" });
  }

  const usage = openaiResp.usage || {};
  return {
    id: openaiResp.id || makeId("msg"),
    type: "message",
    role: "assistant",
    model: model,
    content: contentBlocks,
    stop_reason: openaiFinishReasonToAnthropic(choice.finish_reason, Boolean(message.tool_calls)),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
    },
  };
}

// ---- Anthropic streaming ----

function openaiChatChunkToAnthropicEvent(chunk, model, state) {
  const choices = chunk.choices || [];
  if (choices.length === 0) return { type: "message_stop" };

  const delta = choices[0].delta || {};
  const finishReason = choices[0].finish_reason;

  if (delta.tool_calls) {
    return {
      type: "error",
      error: {
        type: "unsupported_streaming_tool_call",
        message: "Streaming tool calls are not supported in protocol conversion mode.",
      },
    };
  }

  const content = delta.content || "";
  if (!content) {
    if (finishReason) return { type: "message_stop" };
    if (delta.role) {
      return {
        type: "message_start",
        message: {
          id: state.messageId,
          type: "message",
          role: "assistant",
          model: model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      };
    }
    return { type: "ping" };
  }

  return {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: content },
  };
}

function writeAnthropicSse(res, event) {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

// ---- /v1/messages handler ----

async function handleAnthropicMessages(req, res, provider) {
  const body = await readJson(req);
  const originalModel = body.model;

  console.log(`${ts()} INFO [${normalizeLogSource(provider && provider.mode)}] 请求: POST /v1/messages`);

  body.__originalModel = body.model;
  body.__endpoint = "/v1/messages";
  body.model = mapClaudeModel(body.model, provider);

  if (originalModel && originalModel !== body.model) {
    console.log(`${ts()} INFO [${normalizeLogSource(provider && provider.mode)}] 模型映射: ${originalModel} → ${body.model}`);
  }
  const useNativeAnthropic = isAnthropicNativeProvider(provider);
  console.log(`${ts()} INFO [${normalizeLogSource(provider && provider.mode)}] 转发请求 → ${useNativeAnthropic ? provider.anthropicMessagesUrl : provider.chatUrl}`);
  const chatRequest = anthropicToOpenaiChatBody(body, Boolean(body.stream));

  if (body.stream && useNativeAnthropic) {
    return proxyAnthropicNativeStreaming(body, req, res, provider);
  }
  if (body.stream) {
    return proxyAnthropicStreaming(body, chatRequest, res, provider);
  }

  const upstream = useNativeAnthropic
    ? await fetchAnthropicMessages(body, req, provider)
    : await fetchChatCompletion({ ...chatRequest, stream: false }, provider);
  const upstreamBody = await readUpstreamJson(upstream);
  if (!upstream.ok) return sendJson(res, upstream.status, upstreamBody);
  if (useNativeAnthropic) return sendJson(res, upstream.status, upstreamBody);
  const anthropicResponse = openaiChatToAnthropic(upstreamBody, chatRequest.model);
  return sendJson(res, 200, anthropicResponse);
}

async function fetchAnthropicMessages(body, req, provider) {
  if (!provider.apiKey) {
    const error = new Error("CLAUDE_TARGET_API_KEY is required");
    error.statusCode = 500;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startTime = Date.now();
  try {
    const { __originalModel, __endpoint, ...cleanBody } = body;
    logUpstreamRequest(body, cleanBody, provider);
    const response = await fetch(provider.anthropicMessagesUrl, {
      method: "POST",
      headers: upstreamAnthropicHeaders(provider, req),
      body: JSON.stringify(cleanBody),
      signal: controller.signal,
    });
    logUpstreamResponse(response.status, Date.now() - startTime, null, provider);
    return response;
  } catch (error) {
    logUpstreamResponse(0, Date.now() - startTime, error, provider);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function proxyAnthropicNativeStreaming(body, req, res, provider) {
  const upstream = await fetchAnthropicMessages(body, req, provider);
  if (!upstream.ok || !upstream.body) {
    const errorBody = await readUpstreamJson(upstream);
    return sendJson(res, upstream.status, errorBody);
  }

  res.writeHead(200, {
    "content-type": upstream.headers.get("content-type") || "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  await pipeWebStream(upstream.body, res);
}

async function proxyAnthropicStreaming(originalRequest, chatRequest, res, provider) {
  const state = {
    messageId: makeId("msg"),
    messageStarted: false,
    contentBlockStarted: false,
    textBuffer: "",
    finalUsage: null,
  };

  const upstream = await fetchChatCompletion(chatRequest, provider);
  if (!upstream.ok || !upstream.body) {
    const body = await readUpstreamJson(upstream);
    debugLog("rq_error", { status: upstream.status, body });
    return sendJson(res, upstream.status, body);
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  try {
    await consumeChatCompletionStream(upstream.body, (chunk) => {
      if (!state.messageStarted) {
        state.messageStarted = true;
        writeAnthropicSse(res, {
          type: "message_start",
          message: {
            id: state.messageId,
            type: "message",
            role: "assistant",
            model: chatRequest.model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });
      }

      const event = openaiChatChunkToAnthropicEvent(chunk, chatRequest.model, state);

      if (event.type === "message_start") {
        if (!state.messageStarted) {
          state.messageStarted = true;
          state.messageId = event.message.id;
          writeAnthropicSse(res, event);
        }
        return;
      }

      if (event.type === "content_block_delta") {
        if (!state.contentBlockStarted) {
          state.contentBlockStarted = true;
          writeAnthropicSse(res, {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          });
        }
        state.textBuffer += event.delta.text;
        writeAnthropicSse(res, event);
        return;
      }

      if (event.type === "ping") return;

      if (chunk.usage) {
        state.finalUsage = chunk.usage;
      }
    });

    if (state.contentBlockStarted) {
      writeAnthropicSse(res, { type: "content_block_stop", index: 0 });
    }

    const outputTokens = state.finalUsage
      ? (state.finalUsage.completion_tokens || state.finalUsage.output_tokens || 0)
      : 0;
    writeAnthropicSse(res, {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: outputTokens },
    });

    writeAnthropicSse(res, { type: "message_stop" });
    res.end();
  } catch (error) {
    writeAnthropicSse(res, {
      type: "error",
      error: { type: "proxy_stream_error", message: error.message },
    });
    res.end();
  }
}

// ---- Anthropic model list format ----

function fallbackAnthropicModels() {
  const models = Object.keys(CLAUDE.claudeModelMap).length > 0
    ? Object.keys(CLAUDE.claudeModelMap)
    : [CLAUDE.defaultModel || "claude-sonnet-4-6"];
  const data = models.map((id) => ({
    type: "model",
    id: id,
    display_name: id,
    created_at: "2024-01-01T00:00:00Z",
  }));
  return {
    data,
    has_more: false,
    first_id: data.length > 0 ? data[0].id : null,
    last_id: data.length > 0 ? data[data.length - 1].id : null,
  };
}

function normalizeModelsToAnthropic(body) {
  let models;
  if (body && Array.isArray(body.data)) {
    models = body.data.map((m) => ({
      type: "model",
      id: m.id || "",
      display_name: m.id || "",
      created_at: m.created_at ? new Date(m.created_at * 1000).toISOString() : "2024-01-01T00:00:00Z",
    }));
  } else {
    models = fallbackAnthropicModels().data;
  }
  return {
    data: models,
    has_more: false,
    first_id: models.length > 0 ? models[0].id : null,
    last_id: models.length > 0 ? models[models.length - 1].id : null,
  };
}
