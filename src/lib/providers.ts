/**
 * Provider-related constants, presets, and utility functions.
 * Shared across Dashboard, ProvidersPage, and TrayPopup.
 */
import type { ProviderConfig } from './config';

export const PROVIDER_ORDER = ['deepseek', 'dashscope', 'zhipu', 'moonshot', 'minimax', 'volcengine-coding'];

export const PRESETS: Record<string, { name: string; codexBaseUrl: string; claudeBaseUrl?: string; codexUpstreamProtocol?: string; defaultModel: string; modelMap: Record<string, string> }> = {
  deepseek: { name: 'DeepSeek', codexBaseUrl: 'https://api.deepseek.com', claudeBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', modelMap: { 'gpt-5.5': 'deepseek-chat', 'gpt-5.4': 'deepseek-chat', 'gpt-5': 'deepseek-chat', 'gpt-5-codex': 'deepseek-chat', 'gpt-5-mini': 'deepseek-chat', 'gpt-5-nano': 'deepseek-chat', 'o4-mini': 'deepseek-chat', 'gpt-5.1': 'deepseek-chat', 'gpt-5.1-codex': 'deepseek-chat', 'gpt-5.1-codex-max': 'deepseek-chat' } },
  dashscope: { name: '阿里云百炼', codexBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', defaultModel: 'qwen-plus', modelMap: { 'gpt-5': 'qwen-plus', 'gpt-5-codex': 'qwen-max', 'gpt-5-mini': 'qwen-turbo', 'o4-mini': 'qwen-plus' } },
  zhipu: { name: '智谱 GLM', codexBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-plus', modelMap: { 'gpt-5': 'glm-4-plus', 'gpt-5-codex': 'glm-4-plus', 'gpt-5-mini': 'glm-4-flash', 'o4-mini': 'glm-4-flash' } },
  moonshot: { name: 'Moonshot', codexBaseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', modelMap: { 'gpt-5': 'moonshot-v1-8k', 'gpt-5-codex': 'moonshot-v1-32k', 'gpt-5-mini': 'moonshot-v1-8k' } },
  minimax: { name: 'MiniMax', codexBaseUrl: 'https://api.minimax.chat/v1', defaultModel: 'abab6.5s-chat', modelMap: { 'gpt-5': 'abab6.5s-chat', 'gpt-5-codex': 'abab6.5s-chat', 'gpt-5-mini': 'abab6.5s-chat' } },
  'volcengine-coding': { name: '火山 Coding Plan', codexBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-1-6-251015', modelMap: { 'gpt-5': 'doubao-seed-1-6-251015', 'gpt-5-codex': 'doubao-seed-1-6-251015', 'gpt-5.1': 'doubao-seed-1-6-251015', 'gpt-5.1-codex': 'doubao-seed-1-6-251015', 'gpt-5.1-codex-max': 'doubao-seed-1-6-251015' } },
};

/** Sort providers by PROVIDER_ORDER, unknowns at end alphabetically */
export function sortProviders(providers: Record<string, ProviderConfig>): [string, ProviderConfig][] {
  return Object.entries(providers).sort((a, b) => {
    const ia = PROVIDER_ORDER.indexOf(a[0]);
    const ib = PROVIDER_ORDER.indexOf(b[0]);
    if (ia === -1 && ib === -1) return a[0].localeCompare(b[0]);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

// ── 1M suffix helpers ──

const MODEL_1M_SUFFIX = '[1m]';

export function strip1mSuffix(value: string): string {
  return value.replace(/\[1m\]$/, '').trim();
}

export function has1mSuffix(value: string): boolean {
  return value.trimEnd().endsWith(MODEL_1M_SUFFIX);
}

export function normalizeProvider1mConfig(provider: ProviderConfig): ProviderConfig {
  const codexBaseUrl = (provider.codexBaseUrl ?? '').trim();
  const claudeBaseUrl = (provider.claudeBaseUrl ?? '').trim();
  const claudeModelMap = { ...(provider.claudeModelMap || {}) };
  const claudeModel1mMap = { ...(provider.claudeModel1mMap || {}) };
  let changed = false;

  for (const [slot, target] of Object.entries(claudeModelMap)) {
    if (has1mSuffix(target)) {
      claudeModelMap[slot] = strip1mSuffix(target);
      claudeModel1mMap[slot] = true;
      changed = true;
    }
  }

  const defaultModel = has1mSuffix(provider.defaultModel) ? strip1mSuffix(provider.defaultModel) : provider.defaultModel;

  return {
    ...provider,
    codexBaseUrl,
    claudeBaseUrl,
    defaultModel,
    claudeModelMap: changed ? claudeModelMap : provider.claudeModelMap,
    claudeModel1mMap: Object.keys(claudeModel1mMap).length > 0 ? claudeModel1mMap : provider.claudeModel1mMap,
  };
}

// ── Claude model compat ──

export const CLAUDE_KEY_COMPAT: Record<string, string> = {
  'opus_4_7': 'claude-opus-4-7',
  'opus_4_6': 'claude-opus-4-6',
  'opus_3': 'claude-3-opus',
  'sonnet_4_6': 'claude-sonnet-4-6',
  'sonnet_4_5': 'claude-sonnet-4-5',
  'haiku_4_5': 'claude-haiku-4-5',
};

export function resolveClaudeSlot(slot: string): string {
  return CLAUDE_KEY_COMPAT[slot] || slot;
}

export function isClaudeSlotUsed(cm: Record<string, string> | undefined, slotKey: string): boolean {
  if (!cm) return false;
  if (slotKey in cm) return true;
  for (const [oldKey, newKey] of Object.entries(CLAUDE_KEY_COMPAT)) {
    if (newKey === slotKey && oldKey in cm) return true;
  }
  return false;
}

export const UPSTREAM_PROTOCOLS = [
  { id: 'chat-completions', label: 'Chat Completions', desc: '/v1/chat/completions' },
  { id: 'responses', label: 'Responses API', desc: '/v1/responses（直接透传）' },
];
