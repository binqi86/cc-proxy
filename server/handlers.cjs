"use strict";

const {
  sendJson, readJson, readUpstreamJson, copyStatusAndHeaders, pipeWebStream,
  logInfo, logUpstreamRequest, logUpstreamResponse, sendSse, makeId, normalizeLogSource, ts,
} = require("./utils.cjs");
const { mapModel, mapClaudeModel } = require("./provider.cjs");
const {
  responsesToChatRequest, chatResponseToResponses, convertChatStreamChunk,
  buildCompletedEvent, closeReasoningBlock, closeTextBlock, closeFuncBlocks,
  patchAssistantReasoning, consumeSseStream,
} = require("./converter.cjs");

// ── Shared fetch helper ──

function upstreamHeaders(provider) {
  return { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" };
}

function upstreamAnthropicHeaders(provider, req) {
  const ver = req?.headers?.["anthropic-version"];
  const beta = req?.headers?.["anthropic-beta"];
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${provider.apiKey}`,
    "x-api-key": provider.apiKey,
    "anthropic-version": (typeof ver === "string" && ver) ? ver : "2023-06-01",
  };
  if (typeof beta === "string" && beta) headers["anthropic-beta"] = beta;
  return headers;
}

async function fetchChatCompletion(body, provider, timeoutMs) {
  if (!provider.apiKey) { const e = new Error("TARGET_API_KEY is required"); e.statusCode = 500; throw e; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();
  try {
    const { __originalModel, __endpoint, ...cleanBody } = body;
    logUpstreamRequest(body, cleanBody, provider);
    const response = await fetch(provider.chatUrl, {
      method: "POST", headers: upstreamHeaders(provider),
      body: JSON.stringify(cleanBody), signal: controller.signal,
    });
    logUpstreamResponse(response.status, Date.now() - startTime, null, provider);
    return response;
  } catch (error) {
    logUpstreamResponse(0, Date.now() - startTime, error, provider);
    throw error;
  } finally { clearTimeout(timer); }
}

// ===================================================================
// GET /v1/models
// ===================================================================

async function handleModels(res, wantsAnthropic, provider) {
  if (!provider.apiKey) {
    return sendJson(res, 200, wantsAnthropic ? fallbackAnthropicModels(provider) : fallbackModels(provider));
  }
  try {
    const upstream = await fetch(provider.modelsUrl, { headers: upstreamHeaders(provider), signal: AbortSignal.timeout(15000) });
    const body = await readUpstreamJson(upstream);
    if (!upstream.ok) return sendJson(res, upstream.status, body);
    return sendJson(res, 200, wantsAnthropic ? normalizeModelsToAnthropic(body) : normalizeModels(body, provider));
  } catch {
    return sendJson(res, 200, wantsAnthropic ? fallbackAnthropicModels(provider) : fallbackModels(provider));
  }
}

// ===================================================================
// POST /v1/chat/completions — passthrough
// ===================================================================

async function handleChatPassthrough(req, res, provider, timeoutMs, maxBodySize) {
  const body = await readJson(req, maxBodySize);
  body.__originalModel = body.model;
  body.__endpoint = "/v1/chat/completions";
  body.model = mapModel(body.model, provider);
  patchAssistantReasoning(body);

  const upstream = await fetchChatCompletion(body, provider, timeoutMs);
  copyStatusAndHeaders(upstream, res, ["content-type"]);
  res.statusCode = upstream.status;
  if (upstream.body) await pipeWebStream(upstream.body, res);
  else res.end();
}

// ===================================================================
// POST /v1/responses — protocol conversion
// ===================================================================

async function handleResponses(req, res, provider, timeoutMs, maxBodySize, debugLog) {
  // If upstream natively supports Responses API, passthrough
  if (provider.upstreamProtocol === "responses") {
    return proxyResponsesPassthrough(req, res, provider, timeoutMs, maxBodySize);
  }

  const responsesRequest = await readJson(req, maxBodySize);
  debugLog("rq_input", responsesRequest);

  // Pre-extract reasoning content from reasoning items
  if (Array.isArray(responsesRequest.input)) {
    for (const item of responsesRequest.input) {
      if (item?.type === "reasoning" && (!item.reasoning_content || typeof item.reasoning_content !== "string")) {
        if (typeof item.encrypted_content === "string" && item.encrypted_content) {
          item.reasoning_content = item.encrypted_content;
        } else if (Array.isArray(item.content)) {
          const text = item.content.map(p => p?.text || "").filter(Boolean).join("\n");
          if (text) item.reasoning_content = text;
        } else if (Array.isArray(item.summary)) {
          const text = item.summary.map(p => p?.text || "").filter(Boolean).join("\n");
          if (text) item.reasoning_content = text;
        }
      }
    }
  }

  const chatRequest = responsesToChatRequest(responsesRequest, provider, mapModel);
  chatRequest.__endpoint = "/v1/responses";
  patchAssistantReasoning(chatRequest);
  debugLog("rq_chat", chatRequest);

  if (chatRequest.stream) {
    return proxyResponsesStream(responsesRequest, chatRequest, res, provider, timeoutMs, debugLog);
  }

  const upstream = await fetchChatCompletion(chatRequest, provider, timeoutMs);
  const upstreamBody = await readUpstreamJson(upstream);
  if (!upstream.ok) {
    debugLog("rq_error", { status: upstream.status, body: upstreamBody });
    return sendJson(res, upstream.status, upstreamBody);
  }
  return sendJson(res, 200, chatResponseToResponses(upstreamBody, responsesRequest, chatRequest.model));
}

// ── Responses passthrough (upstream supports /v1/responses natively) ──

async function proxyResponsesPassthrough(req, res, provider, timeoutMs, maxBodySize) {
  if (!provider.apiKey) { const e = new Error("TARGET_API_KEY is required"); e.statusCode = 500; throw e; }
  const body = await readJson(req, maxBodySize);
  body.model = mapModel(body.model, provider);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();
  try {
    logInfo(`[${provider.mode}] 请求: POST /v1/responses (passthrough)`);
    logInfo(`[${provider.mode}] 转发请求 → ${body.model}${body.stream ? ' stream' : ''}`);
    const upstream = await fetch(provider.chatUrl, {
      method: "POST", headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal,
    });
    logUpstreamResponse(upstream.status, Date.now() - startTime, null, provider);
    if (!upstream.ok || !upstream.body) {
      const errorBody = await readUpstreamJson(upstream);
      return sendJson(res, upstream.status, errorBody);
    }
    copyStatusAndHeaders(upstream, res, ["content-type"]);
    res.statusCode = upstream.status;
    await pipeWebStream(upstream.body, res);
  } catch (error) {
    logUpstreamResponse(0, Date.now() - startTime, error, provider);
    if (res.headersSent && !res.writableEnded) { res.end(); return; }
    throw error;
  } finally { clearTimeout(timer); }
}

// ── Responses streaming (convert chat stream → responses SSE) ──

async function proxyResponsesStream(originalRequest, chatRequest, res, provider, timeoutMs, debugLog) {
  const state = { initialized: false, started: false };
  const upstream = await fetchChatCompletion(chatRequest, provider, timeoutMs);

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
    await consumeSseStream(upstream.body, (chunk) => {
      if (!res.writable) return;
      const events = convertChatStreamChunk(chunk, state, originalRequest, chatRequest.model);
      for (const ev of events) {
        res.write(`event: ${ev.event}\n`);
        res.write(`data: ${ev.data}\n\n`);
      }
    });

    if (res.writable) {
      const completed = buildCompletedEvent(state, originalRequest, chatRequest.model);
      res.write(`event: response.completed\n`);
      res.write(`data: ${JSON.stringify(completed)}\n\n`);
      res.write("data: [DONE]\n\n");
    }
    res.end();
  } catch (error) {
    logInfo(`proxyResponsesStream error: ${error.message}`);
    if (res.writable) {
      if (state.textBuf || state.reasoningBuf || state.funcCalls?.size > 0) {
        try {
          const send = (event, payload) => { res.write(`event: ${event}\n`); res.write(`data: ${JSON.stringify(payload)}\n\n`); };
          if (state.reasoningActive) closeReasoningBlock(state, send);
          if (state.inText) closeTextBlock(state, send);
          if (state.inFunc) closeFuncBlocks(state, send);
          const completed = buildCompletedEvent(state, originalRequest, chatRequest.model);
          res.write(`event: response.completed\n`);
          res.write(`data: ${JSON.stringify(completed)}\n\n`);
          res.write("data: [DONE]\n\n");
        } catch { /* best effort */ }
      } else {
        sendSse(res, "response.failed", {
          type: "response.failed",
          response: { id: state.responseId || makeId("resp"), object: "response",
            created_at: state.createdAt || Math.floor(Date.now() / 1000),
            status: "failed", model: chatRequest.model, output: [],
            error: { message: error.message, type: "proxy_stream_error" } },
        });
      }
    }
    if (!res.writableEnded) res.end();
  }
}

// ===================================================================
// POST /v1/messages — Anthropic passthrough
// ===================================================================

async function handleAnthropicMessages(req, res, provider, timeoutMs, maxBodySize) {
  const body = await readJson(req, maxBodySize);
  const originalModel = body.model;
  const source = normalizeLogSource(provider.mode);

  console.log(`${ts()} INFO [${source}] 请求: POST /v1/messages`);
  body.model = mapClaudeModel(body.model, provider);
  if (originalModel && originalModel !== body.model) {
    console.log(`${ts()} INFO [${source}] 模型映射: ${originalModel} → ${body.model}`);
  }
  console.log(`${ts()} INFO [${source}] 转发请求 → ${provider.anthropicMessagesUrl}`);

  if (body.stream) {
    return proxyAnthropicStreaming(body, req, res, provider, timeoutMs);
  }
  const upstream = await fetchAnthropicMessages(body, req, provider, timeoutMs);
  const upstreamBody = await readUpstreamJson(upstream);
  return sendJson(res, upstream.status, upstreamBody);
}

async function fetchAnthropicMessages(body, req, provider, timeoutMs) {
  if (!provider.apiKey) { const e = new Error("CLAUDE_TARGET_API_KEY is required"); e.statusCode = 500; throw e; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();
  try {
    const { __originalModel, __endpoint, ...cleanBody } = body;
    logUpstreamRequest(body, cleanBody, provider);
    const response = await fetch(provider.anthropicMessagesUrl, {
      method: "POST", headers: upstreamAnthropicHeaders(provider, req),
      body: JSON.stringify(cleanBody), signal: controller.signal,
    });
    logUpstreamResponse(response.status, Date.now() - startTime, null, provider);
    return response;
  } catch (error) {
    logUpstreamResponse(0, Date.now() - startTime, error, provider);
    throw error;
  } finally { clearTimeout(timer); }
}

async function proxyAnthropicStreaming(body, req, res, provider, timeoutMs) {
  const upstream = await fetchAnthropicMessages(body, req, provider, timeoutMs);
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

// ===================================================================
// Model list helpers
// ===================================================================

function fallbackModels(provider) {
  const model = provider.defaultModel || Object.values(provider.modelMap)[0] || "default-model";
  return { object: "list", data: [{ id: model, object: "model", created: 0, owned_by: "cc-proxy" }] };
}

function normalizeModels(body, provider) {
  if (body && Array.isArray(body.data)) return body;
  return fallbackModels(provider);
}

function fallbackAnthropicModels(provider) {
  const models = Object.keys(provider.claudeModelMap).length > 0
    ? Object.keys(provider.claudeModelMap)
    : [provider.defaultModel || "claude-sonnet-4-6"];
  const data = models.map(id => ({ type: "model", id, display_name: id, created_at: "2024-01-01T00:00:00Z" }));
  return { data, has_more: false, first_id: data[0]?.id || null, last_id: data[data.length - 1]?.id || null };
}

function normalizeModelsToAnthropic(body) {
  if (!body || !Array.isArray(body.data)) return fallbackAnthropicModels({ claudeModelMap: {}, defaultModel: "claude-sonnet-4-6" });
  const models = body.data.map(m => ({
    type: "model", id: m.id || "", display_name: m.id || "",
    created_at: m.created_at ? new Date(m.created_at * 1000).toISOString() : "2024-01-01T00:00:00Z",
  }));
  return { data: models, has_more: false, first_id: models[0]?.id || null, last_id: models[models.length - 1]?.id || null };
}

module.exports = {
  handleModels,
  handleChatPassthrough,
  handleResponses,
  handleAnthropicMessages,
};
