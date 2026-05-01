export interface ProviderConfig {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl: string;
  chatPath: string;
  modelsPath: string;
  defaultModel: string;
  modelMap: Record<string, string>;
  modelOptions?: Record<string, { systemMessageMode?: string; omitParams?: string[] }>;
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
  LOG_UPSTREAM_REQUEST?: string;
  MODEL_MAP?: string;
}

export interface ServiceStatus {
  running: boolean;
  pid?: number;
  port?: number;
  uptime?: number;
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

export type TabName = 'providers' | 'env' | 'status' | 'test';
