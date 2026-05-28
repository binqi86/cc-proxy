"use strict";

const { makeId, copyIfPresent, stringifyContent } = require("./utils.cjs");

// ===================================================================
// Responses API → Chat Completions request conversion
// ===================================================================

function responsesToChatRequest(request, provider, mapModelFn) {
  const chat = {
    model: mapModelFn(request.model, provider),
    __originalModel: request.model,
    messages: [],
    stream: Boolean(request.stream),
  };

  if (request.stream_options) {
    chat.stream_options = request.stream_options;
  } else if (chat.stream) {
    chat.stream_options = { include_usage: true };
  }

  if (request.max_output_tokens != null) chat.max_tokens = request.max_output_tokens;

  copyIfPresent(request, chat, "temperature");
  copyIfPresent(request, chat, "top_p");
  copyIfPresent(request, chat, "frequency_penalty");
  copyIfPresent(request, chat, "presence_penalty");
  copyIfPresent(request, chat, "stop");
  copyIfPresent(request, chat, "seed");
  copyIfPresent(request, chat, "user");

  if (request.parallel_tool_calls != null) chat.parallel_tool_calls = Boolean(request.parallel_tool_calls);
  if (request.instructions) chat.messages.push({ role: "system", content: stringifyContent(request.instructions) });

  if (request.input != null) {
    if (typeof request.input === "string") {
      chat.messages.push({ role: "user", content: request.input });
    } else if (Array.isArray(request.input)) {
      convertInputItems(request.input, chat.messages);
    }
  }

  chat.messages = normalizeMessageOrder(chat.messages);

  if (Array.isArray(request.tools) && request.tools.length > 0) {
    chat.tools = request.tools
      .map(t => {
        const name = t.type === "function" && t.function ? t.function.name : t.name;
        if (!name) return null;
        if (t.type === "function" && t.function) return t;
        return { type: "function", function: { name, description: t.description || "", parameters: t.parameters || t.input_schema || { type: "object" } } };
      })
      .filter(Boolean);
    if (chat.tools.length > 0 && request.tool_choice != null) chat.tool_choice = request.tool_choice;
  }

  if (request.reasoning && request.reasoning.effort) {
    chat.reasoning_effort = provider.reasoningMapping[request.reasoning.effort] || "auto";
  }

  if (!chat.reasoning_effort && Array.isArray(request.input)) {
    if (request.input.some(item => item && item.type === "reasoning")) {
      chat.reasoning_effort = "high";
    }
  }

  return chat;
}

function convertInputItems(input, messages) {
  const pendingToolCalls = [];
  let pendingReasoningContent = "";
  let lastAssistantMessage = null;

  const flushToolCalls = () => {
    if (pendingToolCalls.length === 0) return;
    const msg = { role: "assistant", tool_calls: pendingToolCalls.splice(0) };
    if (pendingReasoningContent.trim()) msg.reasoning_content = pendingReasoningContent.trim();
    messages.push(msg);
    lastAssistantMessage = msg;
  };

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const type = item.type || (item.role ? "message" : "");

    switch (type) {
      case "message": {
        flushToolCalls();
        const role = normalizeRole(item.role || "user");
        const content = extractContentText(item.content);
        const msg = { role, content };
        const reasoning = role === "assistant"
          ? (extractExplicitReasoningText(item) || pendingReasoningContent.trim())
          : "";
        if (role === "assistant" && reasoning) msg.reasoning_content = reasoning;
        messages.push(msg);
        lastAssistantMessage = role === "assistant" ? msg : null;
        if (role !== "assistant") pendingReasoningContent = "";
        break;
      }
      case "reasoning": {
        const reasoning = extractReasoningText(item);
        if (reasoning) {
          if (lastAssistantMessage && pendingToolCalls.length === 0) {
            lastAssistantMessage.reasoning_content = lastAssistantMessage.reasoning_content
              ? `${lastAssistantMessage.reasoning_content}\n${reasoning}` : reasoning;
          } else {
            pendingReasoningContent = pendingReasoningContent ? `${pendingReasoningContent}\n${reasoning}` : reasoning;
          }
        }
        break;
      }
      case "function_call": {
        pendingToolCalls.push({
          id: item.call_id || item.id || makeId("call"),
          type: "function",
          function: { name: item.name || "", arguments: item.arguments || "" },
        });
        break;
      }
      case "function_call_output": {
        flushToolCalls();
        messages.push({
          role: "tool",
          tool_call_id: item.call_id || "",
          content: typeof item.output === "string" ? item.output : JSON.stringify(item.output || ""),
        });
        break;
      }
    }
  }
  flushToolCalls();
}

// ===================================================================
// Chat Completions response → Responses API (non-streaming)
// ===================================================================

function chatResponseToResponses(chatBody, originalRequest, modelName) {
  const choice = (chatBody.choices || [{}])[0];
  const message = choice.message || {};
  const output = [];
  let outputIndex = 0;

  if (message.reasoning_content) {
    output.push({
      id: `rs_resp_0`, type: "reasoning", status: "completed",
      content: [{ type: "reasoning_text", text: message.reasoning_content }],
      summary: [{ type: "summary_text", text: message.reasoning_content }],
      encrypted_content: message.reasoning_content,
    });
    outputIndex = 1;
  }

  if (message.content) {
    const msgItem = {
      id: `msg_resp_${outputIndex}`, type: "message", status: "completed", role: "assistant",
      content: [{ type: "output_text", text: message.content, annotations: [] }],
    };
    if (message.reasoning_content) msgItem.reasoning_content = message.reasoning_content;
    output.push(msgItem);
  }

  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      const f = tc.function || {};
      output.push({
        id: `fc_${tc.id || makeId("call")}`, type: "function_call", status: "completed",
        call_id: tc.id, name: f.name || "", arguments: safeJsonArgs(f.arguments),
      });
    }
  }

  const usage = normalizeUsage(chatBody.usage);
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
// Chat Completions stream → Responses API SSE events
// ===================================================================

function convertChatStreamChunk(chunk, state, originalRequest, modelName) {
  const out = [];
  const send = (event, payload) => out.push({ event, data: JSON.stringify(payload) });

  if (!state.initialized) {
    state.initialized = true;
    state.responseId = chunk.id || makeId("resp");
    state.createdAt = Math.floor(Date.now() / 1000);
    state.inText = false;
    state.inFunc = false;
    state.textBuf = "";
    state.reasoningBuf = "";
    state.reasoningActive = false;
    state.funcCalls = new Map();
    state.usage = null;
  }

  if (!state.started) {
    state.started = true;
    send("response.created", {
      type: "response.created",
      response: { id: state.responseId, object: "response", created_at: state.createdAt, status: "in_progress", model: modelName, output: [] },
    });
    send("response.in_progress", {
      type: "response.in_progress",
      response: { id: state.responseId, object: "response", created_at: state.createdAt, status: "in_progress" },
    });
  }

  for (const choice of (chunk.choices || [])) {
    const delta = choice.delta || {};
    const finishReason = choice.finish_reason;

    // Reasoning
    if (delta.reasoning_content) {
      if (!state.reasoningActive) {
        state.reasoningActive = true;
        state.reasoningItemId = `rs_${state.responseId}_0`;
        send("response.output_item.added", { type: "response.output_item.added", output_index: 0,
          item: { id: state.reasoningItemId, type: "reasoning", status: "in_progress", content: [], summary: [] } });
        send("response.reasoning_summary_part.added", { type: "response.reasoning_summary_part.added",
          item_id: state.reasoningItemId, output_index: 0, summary_index: 0, part: { type: "summary_text", text: "" } });
      }
      state.reasoningBuf += delta.reasoning_content;
      send("response.reasoning_summary_text.delta", { type: "response.reasoning_summary_text.delta",
        item_id: state.reasoningItemId, output_index: 0, summary_index: 0, delta: delta.reasoning_content });
    }

    // Text
    if (delta.content) {
      if (state.reasoningActive) closeReasoningBlock(state, send);
      if (!state.inText) {
        state.inText = true;
        const oi = state.reasoningActive ? 1 : 0;
        state.msgId = `msg_${state.responseId}_${oi}`;
        send("response.output_item.added", { type: "response.output_item.added", output_index: oi,
          item: { id: state.msgId, type: "message", status: "in_progress", role: "assistant", content: [] } });
        send("response.content_part.added", { type: "response.content_part.added", item_id: state.msgId,
          output_index: oi, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
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
        if (tc.id) {
          fc.id = tc.id;
          state.inFunc = true;
          const oi = (state.reasoningActive ? 1 : 0) + (state.msgId ? 1 : 0) + idx;
          send("response.output_item.added", { type: "response.output_item.added", output_index: oi,
            item: { id: `fc_${tc.id}`, type: "function_call", status: "in_progress", call_id: tc.id, name: "", arguments: "" } });
        }
        if (tc.function) {
          if (tc.function.name) fc.name = tc.function.name;
          if (tc.function.arguments) {
            fc.args += tc.function.arguments;
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

  if (chunk.usage) state.usage = normalizeUsage(chunk.usage);
  return out;
}

function buildCompletedEvent(state, originalRequest, modelName) {
  const output = [];
  if (state.reasoningBuf) {
    output.push({ id: state.reasoningItemId, type: "reasoning", status: "completed",
      content: [{ type: "reasoning_text", text: state.reasoningBuf }],
      summary: [{ type: "summary_text", text: state.reasoningBuf }],
      encrypted_content: state.reasoningBuf });
  }
  if (state.msgId) {
    const msgItem = { id: state.msgId, type: "message", status: "completed", role: "assistant",
      content: [{ type: "output_text", text: state.textBuf || "", annotations: [] }] };
    if (state.reasoningBuf) msgItem.reasoning_content = state.reasoningBuf;
    output.push(msgItem);
  }
  for (const [, fc] of [...state.funcCalls.entries()].sort((a, b) => a[0] - b[0])) {
    const args = safeJsonArgs(fc.args);
    output.push({ id: `fc_${fc.id}`, type: "function_call", status: "completed",
      call_id: fc.id, name: fc.name, arguments: args });
  }
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
      usage: state.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    },
  };
}

// ── Stream block closers ──

function closeReasoningBlock(state, send) {
  if (!state.reasoningActive) return;
  const text = state.reasoningBuf;
  send("response.reasoning_summary_text.done", { type: "response.reasoning_summary_text.done",
    item_id: state.reasoningItemId, output_index: 0, summary_index: 0, text });
  send("response.reasoning_summary_part.done", { type: "response.reasoning_summary_part.done",
    item_id: state.reasoningItemId, output_index: 0, summary_index: 0, part: { type: "summary_text", text } });
  send("response.output_item.done", { type: "response.output_item.done", output_index: 0,
    item: { id: state.reasoningItemId, type: "reasoning", status: "completed",
      content: [{ type: "reasoning_text", text }], summary: [{ type: "summary_text", text }], encrypted_content: text } });
  state.reasoningActive = false;
}

function closeTextBlock(state, send) {
  if (!state.inText) return;
  const oi = state.reasoningActive ? 1 : 0;
  const text = state.textBuf || "";
  send("response.output_text.done", { type: "response.output_text.done", item_id: state.msgId, output_index: oi, content_index: 0, text });
  send("response.content_part.done", { type: "response.content_part.done", item_id: state.msgId, output_index: oi, content_index: 0, part: { type: "output_text", text, annotations: [] } });
  const doneItem = { id: state.msgId, type: "message", status: "completed", role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }] };
  if (state.reasoningBuf) doneItem.reasoning_content = state.reasoningBuf;
  send("response.output_item.done", { type: "response.output_item.done", output_index: oi, item: doneItem });
  state.inText = false;
}

function closeFuncBlocks(state, send) {
  if (!state.inFunc || state.funcCalls.size === 0) return;
  for (const [idx, fc] of [...state.funcCalls.entries()].sort((a, b) => a[0] - b[0])) {
    const oi = (state.reasoningActive ? 1 : 0) + (state.msgId ? 1 : 0) + idx;
    const args = safeJsonArgs(fc.args);
    send("response.function_call_arguments.done", { type: "response.function_call_arguments.done",
      item_id: `fc_${fc.id}`, output_index: oi, arguments: args });
    send("response.output_item.done", { type: "response.output_item.done", output_index: oi,
      item: { id: `fc_${fc.id}`, type: "function_call", status: "completed",
        call_id: fc.id, name: fc.name, arguments: args } });
  }
  state.inFunc = false;
}

/** Ensure function call arguments are valid JSON; fall back to "{}" if not. */
function safeJsonArgs(args) {
  if (!args) return "{}";
  try { JSON.parse(args); return args; } catch {
    // Attempt basic repair: close unclosed braces/brackets
    let repaired = args;
    const opens = (repaired.match(/\{/g) || []).length;
    const closes = (repaired.match(/\}/g) || []).length;
    if (opens > closes) repaired += "}".repeat(opens - closes);
    try { JSON.parse(repaired); return repaired; } catch { return "{}"; }
  }
}

// ===================================================================
// Helpers
// ===================================================================

function normalizeUsage(usage) {
  if (!usage) return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let input = 0, output = 0, total = 0;
  if (usage.input_tokens != null) input = Number(usage.input_tokens);
  else if (usage.prompt_tokens != null) input = Number(usage.prompt_tokens);
  if (usage.output_tokens != null) output = Number(usage.output_tokens);
  else if (usage.completion_tokens != null) output = Number(usage.completion_tokens);
  else if (usage.candidatesTokenCount != null) output = Number(usage.candidatesTokenCount);
  total = usage.total_tokens != null ? Number(usage.total_tokens) : (input + output);
  if (usage.promptTokenCount != null) {
    input = Number(usage.promptTokenCount) - Number(usage.cachedContentTokenCount || 0);
    if (input < 0) input = 0;
    output = Number(usage.candidatesTokenCount || 0);
    total = input + output;
  }
  return { input_tokens: input, output_tokens: output, total_tokens: total };
}

function normalizeRole(role) {
  if (role === "developer") return "system";
  if (role === "assistant" || role === "system" || role === "tool") return role;
  return "user";
}

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
      if (toolId && ids.has(toolId)) { toolMsgs.push(result[j]); ids.delete(toolId); }
      else { deferred.push(result[j]); }
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

function extractContentText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .filter(c => c && typeof c === "object" && (c.type === "input_text" || c.type === "output_text" || c.type === "text" || !c.type))
    .map(c => c.text || "").filter(Boolean).join("\n");
}

function extractReasoningText(item) {
  if (!item || typeof item !== "object") return "";
  const explicit = extractExplicitReasoningText(item);
  if (explicit) return explicit;
  if (typeof item.encrypted_content === "string" && item.encrypted_content) return item.encrypted_content;
  if (typeof item.text === "string") return item.text;
  if (Array.isArray(item.summary)) {
    return item.summary.map(p => (p && typeof p.text === "string") ? p.text : "").filter(Boolean).join("\n");
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
    const text = item.content.map(part => {
      if (!part || typeof part !== "object") return "";
      if (!String(part.type || "").toLowerCase().includes("reasoning")) return "";
      if (typeof part.reasoning_content === "string") return part.reasoning_content;
      if (typeof part.text === "string") return part.text;
      if (part.reasoning && typeof part.reasoning === "object") {
        return typeof part.reasoning.content === "string" ? part.reasoning.content : (part.reasoning.text || "");
      }
      if (Array.isArray(part.summary)) return part.summary.map(s => s?.text || "").filter(Boolean).join("\n");
      return "";
    }).filter(Boolean).join("\n");
    if (text) return text;
  }
  return "";
}

// ── Reasoning content patching for thinking-mode models ──

function patchAssistantReasoning(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return;
  if (!needsReasoningPatch(body)) return;

  let count = 0;
  body.messages = body.messages.map(msg => {
    if (!msg || msg.role !== "assistant") return msg;
    if (typeof msg.reasoning_content === "string") return msg;
    count++;
    return { ...msg, reasoning_content: inferReasoningText(msg) || "" };
  });
  if (count > 0) {
    const { logInfo } = require("./utils.cjs");
    logInfo(`patched reasoning_content for ${count} assistant messages`);
  }
}

function needsReasoningPatch(body) {
  if (body.reasoning || body.reasoning_effort || body.thinking) return true;
  return body.messages.some(msg => hasReasoningSignals(msg));
}

function hasReasoningSignals(msg) {
  if (!msg || msg.role !== "assistant") return false;
  if (typeof msg.reasoning_content === "string") return true;
  if (Array.isArray(msg.reasoning_details) && msg.reasoning_details.length > 0) return true;
  return Boolean(inferReasoningText(msg));
}

function inferReasoningText(msg) {
  const explicit = extractExplicitReasoningText(msg);
  if (explicit) return explicit;
  if (Array.isArray(msg.reasoning_details)) {
    const text = msg.reasoning_details.map(d => {
      if (!d || typeof d !== "object") return "";
      return d.text || d.reasoning_content || d.content || (d.reasoning?.content) || (d.reasoning?.text) || "";
    }).filter(Boolean).join("\n").trim();
    if (text) return text;
  }
  return "";
}

// ── SSE stream consumer ──

async function consumeSseStream(body, onChunk) {
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for await (const rawChunk of body) {
      buffer += decoder.decode(rawChunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const data of parseSseData(frame)) {
          if (data === "[DONE]") return;
          if (!data) continue;
          try { onChunk(JSON.parse(data)); } catch { /* skip malformed */ }
        }
      }
    }
  } catch (err) {
    const tail = buffer.trim();
    if (tail) {
      for (const data of parseSseData(tail)) {
        if (data === "[DONE]") return;
        try { onChunk(JSON.parse(data)); } catch { /* skip */ }
      }
    }
    throw err;
  }
  const tail = buffer.trim();
  if (tail) {
    for (const data of parseSseData(tail)) {
      if (data !== "[DONE]") { try { onChunk(JSON.parse(data)); } catch { /* skip */ } }
    }
  }
}

function parseSseData(frame) {
  const data = frame.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
  return data ? [data] : [];
}

module.exports = {
  responsesToChatRequest,
  chatResponseToResponses,
  convertChatStreamChunk,
  buildCompletedEvent,
  closeReasoningBlock,
  closeTextBlock,
  closeFuncBlocks,
  patchAssistantReasoning,
  consumeSseStream,
  normalizeUsage,
};
