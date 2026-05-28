"use strict";

const fs = require("node:fs");
const path = require("node:path");

// ── .env loader ──

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// ── JSON / env helpers ──

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${error.message}`);
  }
}

function parseJsonEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// ── String helpers ──

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function joinTargetUrl(baseUrl, targetPath) {
  if (/^https?:\/\//i.test(targetPath)) return targetPath;
  return `${stripTrailingSlash(baseUrl)}/${targetPath.replace(/^\/+/, "")}`;
}

/**
 * Normalize model name for map key lookup (strips ANSI, spaces, hyphens).
 * Do NOT use this on values that will be sent upstream — only for key matching.
 */
function normalizeModelKey(value) {
  if (value == null) return "";
  return String(value).replace(/\x1B\[[0-9;]*m/g, "").replace(/[\s\-]/g, "").trim();
}

/** Clean model name for display/storage (strips ANSI only, preserves hyphens). */
function sanitizeModelName(value) {
  if (value == null) return "";
  return String(value).replace(/\x1B\[[0-9;]*m/g, "").trim();
}

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function copyIfPresent(source, target, key) {
  if (source[key] != null) target[key] = source[key];
}

function stringifyContent(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// ── Logging ──

function ts() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function logInfo(msg) {
  console.log(`${ts()} INFO [SYSTEM] ${msg}`);
}

function normalizeLogSource(source) {
  const upper = String(source || "").toUpperCase();
  if (upper === "CODEX" || upper === "CLAUDE") return upper;
  return "SYSTEM";
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

// ── Debug logging ──

function createDebugLogger(debugDir) {
  return function debugLog(label, payload) {
    if (process.env.DEBUG_REASONING !== "1") return;
    try {
      if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      fs.writeFileSync(path.join(debugDir, `${ts}_${label}.json`), JSON.stringify(payload, null, 2), "utf8");
    } catch { /* never break the proxy */ }
  };
}

// ── HTTP helpers ──

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function readRequestBody(req, maxSize) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxSize) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJson(req, maxSize) {
  const body = await readRequestBody(req, maxSize);
  if (!body.trim()) return {};
  try { return JSON.parse(body); } catch {
    const error = new Error("Invalid JSON request body");
    error.statusCode = 400;
    throw error;
  }
}

async function readUpstreamJson(upstream) {
  const text = await upstream.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch {
    return { error: { message: text, type: "upstream_error" } };
  }
}

function copyStatusAndHeaders(upstream, res, headerNames) {
  for (const name of headerNames) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
}

async function pipeWebStream(stream, res) {
  try {
    for await (const chunk of stream) {
      if (!res.writable) break;
      res.write(Buffer.from(chunk));
    }
  } catch (error) {
    logInfo(`pipeWebStream error: ${error.message}`);
  } finally {
    if (!res.writableEnded) res.end();
  }
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

module.exports = {
  loadDotEnv,
  readJsonFile,
  parseJsonEnv,
  asObject,
  stripTrailingSlash,
  joinTargetUrl,
  normalizeModelKey,
  sanitizeModelName,
  makeId,
  copyIfPresent,
  stringifyContent,
  ts,
  logInfo,
  normalizeLogSource,
  logUpstreamRequest,
  logUpstreamResponse,
  createDebugLogger,
  sendJson,
  readRequestBody,
  readJson,
  readUpstreamJson,
  copyStatusAndHeaders,
  pipeWebStream,
  sendSse,
};
