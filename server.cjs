"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

loadDotEnv(path.join(__dirname, ".env"));

const PROVIDER_PRESET = process.env.PROVIDER_PRESET || "";
const PROVIDER_CONFIG_PATH = process.env.PROVIDER_CONFIG_PATH || path.join(__dirname, "providers.json");
const PRESET_DEFAULTS = loadProviderPreset(PROVIDER_PRESET, PROVIDER_CONFIG_PATH);
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const TARGET_BASE_URL = stripTrailingSlash(
  requireConfig("TARGET_BASE_URL", process.env.TARGET_BASE_URL || PRESET_DEFAULTS.baseUrl)
);
const TARGET_CHAT_PATH = process.env.TARGET_CHAT_PATH || PRESET_DEFAULTS.chatPath || "/v1/chat/completions";
const TARGET_MODELS_PATH = process.env.TARGET_MODELS_PATH || PRESET_DEFAULTS.modelsPath || "/v1/models";
const TARGET_API_KEY = process.env.TARGET_API_KEY || PRESET_DEFAULTS.apiKey || "";
const PROXY_API_KEY = process.env.PROXY_API_KEY || "";
const DEFAULT_MODEL = PRESET_DEFAULTS.defaultModel || process.env.DEFAULT_MODEL || "";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 600000);
const LOG_UPSTREAM_REQUEST = process.env.NODE_ENV === "development" || parseBooleanEnv("LOG_UPSTREAM_REQUEST");
const MODEL_MAP = resolveModelMap(
  { ...parseJsonEnv("MODEL_MAP", {}), ...asObject(PRESET_DEFAULTS.modelMap) },
  DEFAULT_MODEL
);
const TARGET_CHAT_URL = joinTargetUrl(TARGET_BASE_URL, TARGET_CHAT_PATH);
const TARGET_MODELS_URL = joinTargetUrl(TARGET_BASE_URL, TARGET_MODELS_PATH);

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
  console.log(`[PROXY_LOG]${JSON.stringify({ level: "info", event: "startup", ts: new Date().toISOString(), port: PORT, host: HOST, preset: PROVIDER_PRESET || null, target: TARGET_CHAT_URL, defaultModel: DEFAULT_MODEL || null, logUpstream: LOG_UPSTREAM_REQUEST })}`);
});

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      preset: PROVIDER_PRESET || null,
      target: TARGET_CHAT_URL,
      default_model: DEFAULT_MODEL || null,
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
    return handleModels(res);
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    return handleChatPassthrough(req, res);
  }

  if (req.method === "POST" && url.pathname === "/v1/responses") {
    return handleResponses(req, res);
  }

  sendJson(res, 404, {
    error: {
      message: `Unsupported endpoint: ${req.method} ${url.pathname}`,
      type: "invalid_request_error",
    },
  });
}

async function handleModels(res) {
  if (!TARGET_API_KEY) {
    return sendJson(res, 200, fallbackModels());
  }

  try {
    const upstream = await fetch(TARGET_MODELS_URL, {
      headers: upstreamHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    const body = await readUpstreamJson(upstream);
    if (!upstream.ok) return sendJson(res, upstream.status, body);
    return sendJson(res, 200, normalizeModels(body));
  } catch {
    return sendJson(res, 200, fallbackModels());
  }
}

async function handleChatPassthrough(req, res) {
  const body = await readJson(req);
  body.__originalModel = body.model;
  body.model = mapModel(body.model);
  return proxyChatCompletion(body, res);
}

async function handleResponses(req, res) {
  const responsesRequest = await readJson(req);
  const chatRequest = responsesToChatRequest(responsesRequest);

  if (chatRequest.stream) {
    return proxyStreamingResponse(responsesRequest, chatRequest, res);
  }

  const upstream = await fetchChatCompletion(chatRequest);
  const upstreamBody = await readUpstreamJson(upstream);
  if (!upstream.ok) return sendJson(res, upstream.status, upstreamBody);

  const responseBody = chatCompletionToResponse(upstreamBody, responsesRequest, chatRequest.model);
  return sendJson(res, 200, responseBody);
}

async function proxyChatCompletion(body, res) {
  const upstream = await fetchChatCompletion(body);
  copyStatusAndHeaders(upstream, res, ["content-type"]);
  res.statusCode = upstream.status;
  if (upstream.body) {
    await pipeWebStream(upstream.body, res);
  } else {
    res.end();
  }
}

async function proxyStreamingResponse(originalRequest, chatRequest, res) {
  if (getModelOption(chatRequest.model, "forceNonStreaming")) {
    return proxyNonStreamingAsStreamingResponse(originalRequest, chatRequest, res);
  }

  const responseId = makeId("resp");
  const messageItemId = makeId("msg");
  const createdAt = Math.floor(Date.now() / 1000);
  const output = [];
  const state = {
    text: "",
    messageStarted: false,
    contentStarted: false,
    toolCalls: new Map(),
    usage: null,
  };

  const upstream = await fetchChatCompletion(chatRequest);
  if (!upstream.ok || !upstream.body) {
    const body = await readUpstreamJson(upstream);
    return sendJson(res, upstream.status, body);
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  sendSse(res, "response.created", {
    type: "response.created",
    response: baseResponse(responseId, originalRequest, chatRequest.model, createdAt, "in_progress", []),
  });
  sendSse(res, "response.in_progress", {
    type: "response.in_progress",
    response: baseResponse(responseId, originalRequest, chatRequest.model, createdAt, "in_progress", []),
  });

  try {
    await consumeChatCompletionStream(upstream.body, (chunk) => {
      const choice = chunk.choices && chunk.choices[0];
      const delta = choice && choice.delta ? choice.delta : {};

      if (delta.content) {
        if (!state.messageStarted) {
          state.messageStarted = true;
          sendSse(res, "response.output_item.added", {
            type: "response.output_item.added",
            output_index: 0,
            item: {
              id: messageItemId,
              type: "message",
              status: "in_progress",
              role: "assistant",
              content: [],
            },
          });
        }

        if (!state.contentStarted) {
          state.contentStarted = true;
          sendSse(res, "response.content_part.added", {
            type: "response.content_part.added",
            item_id: messageItemId,
            output_index: 0,
            content_index: 0,
            part: {
              type: "output_text",
              text: "",
              annotations: [],
            },
          });
        }

        state.text += delta.content;
        sendSse(res, "response.output_text.delta", {
          type: "response.output_text.delta",
          item_id: messageItemId,
          output_index: 0,
          content_index: 0,
          delta: delta.content,
        });
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const toolDelta of delta.tool_calls) {
          emitToolCallDelta(res, state, toolDelta);
        }
      }

      if (chunk.usage) {
        state.usage = normalizeUsage(chunk.usage);
      }
    });

    if (state.contentStarted) {
      sendSse(res, "response.output_text.done", {
        type: "response.output_text.done",
        item_id: messageItemId,
        output_index: 0,
        content_index: 0,
        text: state.text,
      });
      sendSse(res, "response.content_part.done", {
        type: "response.content_part.done",
        item_id: messageItemId,
        output_index: 0,
        content_index: 0,
        part: {
          type: "output_text",
          text: state.text,
          annotations: [],
        },
      });
    }

    if (state.messageStarted) {
      const message = {
        id: messageItemId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: state.contentStarted
          ? [{ type: "output_text", text: state.text, annotations: [] }]
          : [],
      };
      output.push(message);
      sendSse(res, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: message,
      });
    }

    for (const toolCall of state.toolCalls.values()) {
      const item = {
        id: toolCall.itemId,
        type: "function_call",
        status: "completed",
        call_id: toolCall.callId,
        name: toolCall.name,
        arguments: toolCall.arguments,
      };
      output.push(item);
      sendSse(res, "response.function_call_arguments.done", {
        type: "response.function_call_arguments.done",
        item_id: toolCall.itemId,
        output_index: output.length - 1,
        arguments: toolCall.arguments,
      });
      sendSse(res, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: output.length - 1,
        item,
      });
    }

    const completed = baseResponse(
      responseId,
      originalRequest,
      chatRequest.model,
      createdAt,
      "completed",
      output,
      state.usage
    );
    sendSse(res, "response.completed", {
      type: "response.completed",
      response: completed,
    });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    sendSse(res, "response.failed", {
      type: "response.failed",
      response: {
        ...baseResponse(responseId, originalRequest, chatRequest.model, createdAt, "failed", output),
        error: {
          message: error.message,
          type: "proxy_stream_error",
        },
      },
    });
    res.end();
  }
}

async function proxyNonStreamingAsStreamingResponse(originalRequest, chatRequest, res) {
  const upstream = await fetchChatCompletion({ ...chatRequest, stream: false });
  const upstreamBody = await readUpstreamJson(upstream);
  if (!upstream.ok) return sendJson(res, upstream.status, upstreamBody);

  const responseBody = chatCompletionToResponse(upstreamBody, originalRequest, chatRequest.model);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  sendSse(res, "response.created", {
    type: "response.created",
    response: { ...responseBody, status: "in_progress", output: [] },
  });
  sendSse(res, "response.in_progress", {
    type: "response.in_progress",
    response: { ...responseBody, status: "in_progress", output: [] },
  });

  responseBody.output.forEach((item, outputIndex) => {
    emitOutputItemAsStream(res, item, outputIndex);
  });

  sendSse(res, "response.completed", {
    type: "response.completed",
    response: responseBody,
  });
  res.write("data: [DONE]\n\n");
  res.end();
}

function emitOutputItemAsStream(res, item, outputIndex) {
  const startedItem =
    item.type === "message" ? { ...item, status: "in_progress", content: [] } : { ...item, status: "in_progress" };
  sendSse(res, "response.output_item.added", {
    type: "response.output_item.added",
    output_index: outputIndex,
    item: startedItem,
  });

  if (item.type === "message" && Array.isArray(item.content)) {
    item.content.forEach((part, contentIndex) => {
      if (part.type !== "output_text") return;
      sendSse(res, "response.content_part.added", {
        type: "response.content_part.added",
        item_id: item.id,
        output_index: outputIndex,
        content_index: contentIndex,
        part: { type: "output_text", text: "", annotations: [] },
      });
      sendSse(res, "response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: item.id,
        output_index: outputIndex,
        content_index: contentIndex,
        delta: part.text || "",
      });
      sendSse(res, "response.output_text.done", {
        type: "response.output_text.done",
        item_id: item.id,
        output_index: outputIndex,
        content_index: contentIndex,
        text: part.text || "",
      });
      sendSse(res, "response.content_part.done", {
        type: "response.content_part.done",
        item_id: item.id,
        output_index: outputIndex,
        content_index: contentIndex,
        part,
      });
    });
  }

  sendSse(res, "response.output_item.done", {
    type: "response.output_item.done",
    output_index: outputIndex,
    item,
  });
}

function emitToolCallDelta(res, state, toolDelta) {
  const index = Number.isInteger(toolDelta.index) ? toolDelta.index : state.toolCalls.size;
  let toolCall = state.toolCalls.get(index);
  const fn = toolDelta.function || {};

  if (!toolCall) {
    toolCall = {
      itemId: makeId("fc"),
      callId: toolDelta.id || makeId("call"),
      name: fn.name || "",
      arguments: "",
    };
    state.toolCalls.set(index, toolCall);
    sendSse(res, "response.output_item.added", {
      type: "response.output_item.added",
      output_index: index,
      item: {
        id: toolCall.itemId,
        type: "function_call",
        status: "in_progress",
        call_id: toolCall.callId,
        name: toolCall.name,
        arguments: "",
      },
    });
  }

  if (toolDelta.id) toolCall.callId = toolDelta.id;
  if (fn.name) toolCall.name = fn.name;
  if (fn.arguments) {
    toolCall.arguments += fn.arguments;
    sendSse(res, "response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      item_id: toolCall.itemId,
      output_index: index,
      delta: fn.arguments,
    });
  }
}

async function fetchChatCompletion(body) {
  if (!TARGET_API_KEY) {
    const error = new Error("TARGET_API_KEY is required");
    error.statusCode = 500;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startTime = Date.now();
  try {
    const upstreamBody = prepareUpstreamBody(body);
    logUpstreamRequest(body, upstreamBody);
    const response = await fetch(TARGET_CHAT_URL, {
      method: "POST",
      headers: upstreamHeaders(),
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });
    logUpstreamResponse(response.status, Date.now() - startTime);
    return response;
  } catch (error) {
    logUpstreamResponse(0, Date.now() - startTime, error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function responsesToChatRequest(request) {
  const messages = [];
  if (request.instructions) {
    messages.push({
      role: "system",
      content: stringifyContent(request.instructions),
    });
  }

  for (const message of responsesInputToMessages(request.input)) {
    messages.push(message);
  }

  const chat = {
    model: mapModel(request.model),
    __originalModel: request.model,
    messages,
    stream: Boolean(request.stream),
  };

  copyIfPresent(request, chat, "temperature");
  copyIfPresent(request, chat, "top_p");
  copyIfPresent(request, chat, "presence_penalty");
  copyIfPresent(request, chat, "frequency_penalty");
  copyIfPresent(request, chat, "seed");
  copyIfPresent(request, chat, "stop");

  if (request.max_output_tokens != null) {
    chat.max_tokens = request.max_output_tokens;
  }

  const tools = normalizeTools(request.tools);
  if (tools.length > 0) {
    chat.tools = tools;
    chat.tool_choice = normalizeToolChoice(request.tool_choice);
    if (request.parallel_tool_calls != null) {
      chat.parallel_tool_calls = Boolean(request.parallel_tool_calls);
    }
  }

  if (request.stream_options) {
    chat.stream_options = request.stream_options;
  } else if (chat.stream) {
    chat.stream_options = { include_usage: true };
  }

  if (request.extra_body && typeof request.extra_body === "object") {
    Object.assign(chat, request.extra_body);
  }

  return chat;
}

function responsesInputToMessages(input) {
  if (input == null) return [];
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }
  if (!Array.isArray(input)) {
    return [{ role: "user", content: stringifyContent(input) }];
  }

  const messages = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;

    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id,
        content: stringifyContent(item.output || ""),
      });
      continue;
    }

    if (item.type === "function_call") {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: item.call_id || item.id || makeId("call"),
            type: "function",
            function: {
              name: item.name || "",
              arguments: stringifyContent(item.arguments || ""),
            },
          },
        ],
      });
      continue;
    }

    if (item.role || item.type === "message") {
      const role = normalizeRole(item.role || "user");
      messages.push({
        role,
        content: normalizeMessageContent(item.content),
      });
    }
  }
  return messages;
}

function normalizeMessageContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return stringifyContent(content);

  const chatParts = [];
  const textParts = [];

  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "input_text" || part.type === "output_text" || part.type === "text") {
      textParts.push(part.text || "");
      continue;
    }

    if (part.type === "input_image" && (part.image_url || part.image_url?.url)) {
      if (textParts.length > 0) {
        chatParts.push({ type: "text", text: textParts.join("\n") });
        textParts.length = 0;
      }
      chatParts.push({
        type: "image_url",
        image_url: typeof part.image_url === "string" ? { url: part.image_url } : part.image_url,
      });
    }
  }

  if (chatParts.length > 0) {
    if (textParts.length > 0) chatParts.push({ type: "text", text: textParts.join("\n") });
    return chatParts;
  }
  return textParts.join("\n");
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") return null;
      if (tool.type === "function" && tool.function) return tool;
      if (tool.type === "function" && tool.name) {
        return {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description || "",
            parameters: tool.parameters || {},
          },
        };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeToolChoice(choice) {
  if (choice == null) return "auto";
  if (typeof choice === "string") return choice === "required" ? "required" : choice;
  if (choice.type === "function" && choice.name) {
    return {
      type: "function",
      function: { name: choice.name },
    };
  }
  return choice;
}

function chatCompletionToResponse(chatBody, originalRequest, model) {
  const choice = chatBody.choices && chatBody.choices[0];
  const message = choice && choice.message ? choice.message : {};
  const output = [];

  if (message.content) {
    output.push({
      id: makeId("msg"),
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: typeof message.content === "string" ? message.content : stringifyContent(message.content),
          annotations: [],
        },
      ],
    });
  }

  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      output.push({
        id: makeId("fc"),
        type: "function_call",
        status: "completed",
        call_id: toolCall.id || makeId("call"),
        name: toolCall.function?.name || "",
        arguments: toolCall.function?.arguments || "",
      });
    }
  }

  return baseResponse(
    makeId("resp"),
    originalRequest,
    model,
    Math.floor(Date.now() / 1000),
    "completed",
    output,
    normalizeUsage(chatBody.usage)
  );
}

function baseResponse(id, originalRequest, model, createdAt, status, output, usage) {
  return {
    id,
    object: "response",
    created_at: createdAt,
    status,
    error: null,
    incomplete_details: null,
    instructions: originalRequest.instructions || null,
    max_output_tokens: originalRequest.max_output_tokens || null,
    model,
    output,
    output_text: collectOutputText(output),
    parallel_tool_calls: originalRequest.parallel_tool_calls ?? true,
    previous_response_id: originalRequest.previous_response_id || null,
    reasoning: originalRequest.reasoning || null,
    store: originalRequest.store ?? false,
    temperature: originalRequest.temperature ?? null,
    text: originalRequest.text || { format: { type: "text" } },
    tool_choice: originalRequest.tool_choice || "auto",
    tools: originalRequest.tools || [],
    top_p: originalRequest.top_p ?? null,
    truncation: originalRequest.truncation || "disabled",
    usage: usage || null,
    user: originalRequest.user || null,
    metadata: originalRequest.metadata || {},
  };
}

function collectOutputText(output) {
  return output
    .flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
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

function normalizeUsage(usage) {
  if (!usage) return null;
  return {
    input_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
    total_tokens: usage.total_tokens ?? 0,
  };
}

function normalizeRole(role) {
  if (role === "developer") return "system";
  if (role === "assistant" || role === "system" || role === "tool") return role;
  return "user";
}

function mapModel(model) {
  const requested = model || DEFAULT_MODEL;
  return MODEL_MAP[requested] || DEFAULT_MODEL || requested;
}

function fallbackModels() {
  const model = DEFAULT_MODEL || Object.values(MODEL_MAP)[0] || Object.keys(MODEL_MAP)[0] || "deepseek-chat";
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

function normalizeModels(body) {
  if (body && Array.isArray(body.data)) return body;
  return fallbackModels();
}

function upstreamHeaders() {
  return {
    authorization: `Bearer ${TARGET_API_KEY}`,
    "content-type": "application/json",
  };
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
      if (body.length > 25 * 1024 * 1024) {
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

function parseBooleanEnv(name) {
  const raw = process.env[name];
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
    Object.entries(modelMap).map(([from, to]) => [from, to === "$DEFAULT_MODEL" ? defaultModel : to])
  );
}

function omitUpstreamParams(body) {
  const omitParams = getModelOption(body.model, "omitParams");
  if (!Array.isArray(omitParams) || omitParams.length === 0) return body;
  const next = { ...body };
  for (const name of omitParams) {
    delete next[name];
  }
  return next;
}

function prepareUpstreamBody(body) {
  const { __originalModel, ...cleanBody } = body;
  return adaptUpstreamMessages(omitUpstreamParams(cleanBody));
}

function adaptUpstreamMessages(body) {
  const mode = getSystemMessageMode(body.model);
  if (!mode) return body;
  if (!Array.isArray(body.messages)) return body;

  if (mode === "as-user") {
    return {
      ...body,
      messages: body.messages.map((message) =>
        message.role === "system" ? { ...message, role: "user" } : message
      ),
    };
  }

  const systemText = body.messages
    .filter((message) => message.role === "system")
    .map((message) => messageContentToText(message.content))
    .filter(Boolean)
    .join("\n\n");
  if (!systemText) return body;

  const messages = body.messages.filter((message) => message.role !== "system");
  const firstUser = messages.find((message) => message.role === "user");
  if (firstUser) {
    firstUser.content = prependTextToContent(systemText, firstUser.content);
  } else {
    messages.unshift({ role: "user", content: systemText });
  }

  return { ...body, messages };
}

function getSystemMessageMode(model) {
  const mode = getModelOption(model, "systemMessageMode");
  return mode === "merge" || mode === "as-user" ? mode : "";
}

function messageContentToText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return stringifyContent(content);
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text" || part.type === "input_text" || part.type === "output_text") return part.text || "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function prependTextToContent(text, content) {
  if (typeof content === "string") return `${text}\n\n${content}`;
  if (Array.isArray(content)) return [{ type: "text", text }, ...content];
  return `${text}\n\n${messageContentToText(content)}`;
}

function proxyLog(level, event, data) {
  if (!LOG_UPSTREAM_REQUEST) return;
  console.log(`[PROXY_LOG]${JSON.stringify({ level, event, ts: new Date().toISOString(), ...data })}`);
}

function logUpstreamRequest(originalBody, body) {
  const sourceModel = originalBody.__originalModel;
  const targetModel = body.model;
  const modelLabel = sourceModel && sourceModel !== targetModel
    ? `${sourceModel} -> ${targetModel}`
    : targetModel;
  const msgCount = Array.isArray(body.messages) ? body.messages.length : 0;
  const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;

  // Always include essentials for frontend display + counting
  const data = {
    model: modelLabel,
    stream: Boolean(body.stream),
    messages: msgCount,
    tools: toolCount,
  };
  // Debug details only when toggle is on
  if (LOG_UPSTREAM_REQUEST) {
    data.params = Object.keys(body).filter(k => k !== "messages" && k !== "tools" && k !== "model" && k !== "stream");
  }

  console.log(`[PROXY_LOG]${JSON.stringify({ level: "info", event: "upstream_request", ts: new Date().toISOString(), ...data })}`);
}

function logUpstreamResponse(status, latencyMs, error) {
  if (!LOG_UPSTREAM_REQUEST) return;
  proxyLog(error ? "error" : "success", "upstream_response", {
    status,
    latency: latencyMs,
    error: error ? error.message : undefined,
  });
}

function getModelOption(model, optionName) {
  const modelOptions = asObject(PRESET_DEFAULTS.modelOptions);
  const options = asObject(modelOptions[model]);
  return options[optionName];
}

function requireConfig(name, value) {
  if (value) return value;
  throw new Error(`Missing required config: ${name}`);
}

function joinTargetUrl(baseUrl, targetPath) {
  if (/^https?:\/\//i.test(targetPath)) return targetPath;
  return `${stripTrailingSlash(baseUrl)}/${targetPath.replace(/^\/+/, "")}`;
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
