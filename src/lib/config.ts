export interface ProviderConfig {
  id: string;
  name: string;
  apiKey?: string;        // shared fallback
  codexApiKey?: string;    // override for Codex
  claudeApiKey?: string;   // override for Claude
  codexBaseUrl?: string;
  codexChatPath?: string;
  codexModelsPath?: string;
  claudeBaseUrl?: string;
  claudeChatPath?: string;
  claudeModelsPath?: string;
  defaultModel: string;
  modelMap: Record<string, string>;
  claudeModelMap?: Record<string, string>;
  claudeModel1mMap?: Record<string, boolean>;
  reasoningMapping?: Record<string, string>;
  normalizeChatRoles?: boolean;
  codexContextWindow?: boolean;
}

export interface EnvConfig {
  HOST?: string;
  PORT?: string;
  PROXY_API_KEY?: string;
  PROVIDER_PRESET?: string;
  TARGET_API_KEY?: string;
  CODEX_PROVIDER_PRESET?: string;
  CODEX_TARGET_API_KEY?: string;
  CLAUDE_PROVIDER_PRESET?: string;
  CLAUDE_TARGET_API_KEY?: string;
  CODEX_TARGET_BASE_URL?: string;
  CODEX_TARGET_CHAT_PATH?: string;
  CODEX_TARGET_MODELS_PATH?: string;
  CLAUDE_TARGET_BASE_URL?: string;
  CLAUDE_TARGET_CHAT_PATH?: string;
  CLAUDE_TARGET_MODELS_PATH?: string;
  TARGET_BASE_URL?: string;
  TARGET_CHAT_PATH?: string;
  TARGET_MODELS_PATH?: string;
  DEFAULT_MODEL?: string;
  REQUEST_TIMEOUT_MS?: string;
  MODEL_MAP?: string;
  CLAUDE_MODEL_MAP?: string;
  REASONING_MAPPING?: string;
  MAX_REQUEST_BODY_SIZE?: string;
  NORMALIZE_CHAT_ROLES?: string;
}

export interface ServiceStatus {
  running: boolean;
  pid?: number;
  port?: number;
  uptime?: number;
}

export interface AppStats {
  running: boolean;
  pid?: number;
  port?: number;
  request_count: number;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  source?: 'codex' | 'claude' | 'system';
  latency?: number;
  data?: unknown;
}

export interface TestConfig {
  model: string;
  stream: boolean;
  message: string;
}

export interface TestResult {
  success: boolean;
  status?: number;
  latency?: number;
  response?: string;
  tokens?: { input: number; output: number; total: number };
  error?: string;
}

export type ActiveMode = 'codex' | 'claude';

export type NavItem = 'dashboard' | 'providers' | 'proxy' | 'tools' | 'settings';

export interface ClaudeConfigStatus {
  applied: boolean;
  config_file_exists: boolean;
  deployment_mode: string;
  gateway_url: string;
  model_count: number;
  claude_app_exists: boolean;
  claude_version: string | null;
}

export interface CodexConfigStatus {
  applied: boolean;
  config_file_exists: boolean;
  auth_file_exists: boolean;
  gateway_url: string;
  cc_switch_config_exists: boolean;
}

export interface LocalizationStatus {
  is_patched: boolean;
  has_backup: boolean;
  claude_version: string | null;
  is_claude_running: boolean;
  error: string | null;
}

export interface ClaudeModelEntry {
  name: string;
  supports_1m?: boolean;
  display_name?: string;
}

export interface ClaudeModelSlot {
  key: string;
  label: string;
  claudeId: string;
  icon: string;
  required?: boolean;
}

export const CLAUDE_MODEL_SLOTS: ClaudeModelSlot[] = [
  { key: 'default', label: 'Default', claudeId: '', icon: 'bi-circle-fill', required: true },
  { key: 'claude-opus-4-7', label: 'Opus 4.7', claudeId: 'claude-opus-4-7', icon: 'bi-box' },
  { key: 'claude-opus-4-6', label: 'Opus 4.6', claudeId: 'claude-opus-4-6', icon: 'bi-box' },
  { key: 'claude-3-opus', label: 'Opus 3', claudeId: 'claude-3-opus', icon: 'bi-box' },
  { key: 'claude-sonnet-4-6', label: 'Sonnet 4.6', claudeId: 'claude-sonnet-4-6', icon: 'bi-stars' },
  { key: 'claude-sonnet-4-5', label: 'Sonnet 4.5', claudeId: 'claude-sonnet-4-5', icon: 'bi-stars' },
  { key: 'claude-haiku-4-5', label: 'Haiku 4.5', claudeId: 'claude-haiku-4-5', icon: 'bi-leaf' },
];

export const CLAUDE_DEFAULT_SLOTS = ['default', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'];

export interface CodexModelSlot {
  key: string;
  label: string;
  icon: string;
  required?: boolean;
}

export const CODEX_MODEL_SLOTS: CodexModelSlot[] = [
  { key: 'gpt-5.5', label: 'GPT-5.5', icon: 'bi-rocket-takeoff' },
  { key: 'gpt-5.4', label: 'GPT-5.4', icon: 'bi-stars' },
  { key: 'gpt-5', label: 'GPT-5', icon: 'bi-stars' },
  { key: 'gpt-5-codex', label: 'GPT-5 Codex', icon: 'bi-terminal' },
  { key: 'gpt-5-mini', label: 'GPT-5 Mini', icon: 'bi-lightning' },
  { key: 'gpt-5-nano', label: 'GPT-5 Nano', icon: 'bi-circle' },
  { key: 'o4-mini', label: 'O4 Mini', icon: 'bi-circle' },
  { key: 'gpt-5.1', label: 'GPT-5.1', icon: 'bi-star' },
  { key: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', icon: 'bi-terminal-fill' },
  { key: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', icon: 'bi-rocket' },
];

export const CODEX_DEFAULT_SLOTS = ['gpt-5.5', 'gpt-5.4', 'gpt-5', 'gpt-5-codex', 'gpt-5-mini', 'gpt-5.1-codex'];
