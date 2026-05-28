"use strict";

const { readJsonFile, parseJsonEnv, asObject, stripTrailingSlash, joinTargetUrl, normalizeModelKey, sanitizeModelName } = require("./utils.cjs");

/**
 * Load provider configuration for a given mode (CODEX or CLAUDE).
 * Reads from env vars + providers.json preset.
 */
function loadProviderConfig(mode, configPath) {
  const rawPreset = process.env[`${mode}_PROVIDER_PRESET`]
    || (mode === "CODEX" ? (process.env.PROVIDER_PRESET || "") : "")
    || process.env.CODEX_PROVIDER_PRESET
    || process.env.PROVIDER_PRESET
    || "";

  const preset = loadProviderPreset(rawPreset, configPath);

  const rawApiKey = process.env[`${mode}_TARGET_API_KEY`]
    || (mode === "CODEX" ? (process.env.TARGET_API_KEY || "") : "")
    || process.env.CODEX_TARGET_API_KEY
    || process.env.TARGET_API_KEY
    || "";

  const upstreamProtocol = mode === "CLAUDE"
    ? "anthropic"
    : (preset.codexUpstreamProtocol || "chat-completions");

  const chatPath = upstreamProtocol === "anthropic" ? "/v1/messages"
    : upstreamProtocol === "responses" ? "/v1/responses"
    : "/v1/chat/completions";

  const modeBaseUrl = mode === "CLAUDE" ? preset.claudeBaseUrl : preset.codexBaseUrl;
  const baseUrl = stripTrailingSlash(
    process.env[`${mode}_TARGET_BASE_URL`] || modeBaseUrl || preset.baseUrl || ""
  );

  const defaultModel = sanitizeModelName(preset.defaultModel || process.env.DEFAULT_MODEL || "");

  const reasoningMapping = {
    xhigh: "xhigh", high: "high", medium: "medium", low: "low", minimal: "low", none: "none", auto: "auto",
    ...parseJsonEnv("REASONING_MAPPING", {}),
  };

  const modelMap = resolveModelMap(
    { ...parseJsonEnv("MODEL_MAP", {}), ...asObject(preset.modelMap) },
    defaultModel
  );

  const claudeEnvMap = parseJsonEnv("CLAUDE_MODEL_MAP", {});
  const claudeModelMap = Object.keys(preset.claudeModelMap || {}).length > 0
    ? resolveModelMap({ ...claudeEnvMap, ...asObject(preset.claudeModelMap) }, defaultModel)
    : resolveModelMap({ ...claudeEnvMap, ...modelMap }, defaultModel);

  return {
    mode,
    presetId: rawPreset,
    upstreamProtocol,
    apiKey: rawApiKey || preset.apiKey || "",
    chatUrl: joinTargetUrl(baseUrl, chatPath),
    anthropicMessagesUrl: joinTargetUrl(baseUrl, "/v1/messages"),
    modelsUrl: joinTargetUrl(baseUrl, "/v1/models"),
    defaultModel,
    modelMap,
    claudeModelMap,
    reasoningMapping,
  };
}

function loadProviderPreset(preset, filePath) {
  if (!preset) return {};
  const providers = readJsonFile(filePath);
  const provider = providers[preset];
  if (!provider) throw new Error(`Unknown PROVIDER_PRESET "${preset}" in ${filePath}`);
  return asObject(provider);
}

function resolveModelMap(modelMap, defaultModel) {
  return Object.fromEntries(
    Object.entries(modelMap)
      .map(([from, to]) => [normalizeModelKey(from), to === "$DEFAULT_MODEL" ? defaultModel : sanitizeModelName(to)])
      .filter(([from, to]) => from && to)
  );
}

function mapModel(model, provider) {
  const requested = normalizeModelKey(model || provider.defaultModel);
  return provider.modelMap[requested] || provider.defaultModel || model;
}

function mapClaudeModel(model, provider) {
  const requested = normalizeModelKey(model || provider.defaultModel);
  return provider.claudeModelMap[requested] || provider.defaultModel || model;
}

function getProviderForPath(pathname, codex, claude) {
  if (pathname === "/v1/messages") return claude;
  return codex;
}

module.exports = {
  loadProviderConfig,
  mapModel,
  mapClaudeModel,
  getProviderForPath,
};
