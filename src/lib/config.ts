export interface ProviderConfig {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl: string;
  chatPath: string;
  modelsPath: string;
  defaultModel: string;
  modelMap: Record<string, string>;
  claudeModelMap?: Record<string, string>;
  reasoningMapping?: Record<string, string>;
  normalizeChatRoles?: boolean;
}

export interface EnvConfig {
  HOST?: string;
  PORT?: string;
  PROXY_API_KEY?: string;
  PROVIDER_PRESET?: string;
  TARGET_API_KEY?: string;
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
