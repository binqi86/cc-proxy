import { create } from 'zustand';
import { api } from '@/lib/api';
import type {
  ProviderConfig,
  EnvConfig,
  ServiceStatus,
  LogEntry,
  NavItem,
  ActiveMode,
  ClaudeConfigStatus,
  CodexConfigStatus,
  LocalizationStatus,
  ClaudeModelEntry,
} from '@/lib/config';

const MODEL_1M_SUFFIX = '[1m]';
const DEFAULT_CODEX_CHAT_PATH = '/v1/chat/completions';
const DEFAULT_CLAUDE_CHAT_PATH = '/v1/chat/completions';
const DEFAULT_MODELS_PATH = '/v1/models';

function strip1mSuffix(value: string): string {
  return value.replace(/\[1m\]$/, '').trim();
}

function has1mSuffix(value: string): boolean {
  return value.trimEnd().endsWith(MODEL_1M_SUFFIX);
}

function normalizeProviderEndpoints(provider: ProviderConfig): ProviderConfig {
  const codexBaseUrl = (provider.codexBaseUrl ?? '').trim();
  const claudeBaseUrl = (provider.claudeBaseUrl ?? '').trim();
  const codexChatPath = (provider.codexChatPath ?? DEFAULT_CODEX_CHAT_PATH).trim();
  const claudeChatPath = (provider.claudeChatPath ?? DEFAULT_CLAUDE_CHAT_PATH).trim();
  const codexModelsPath = (provider.codexModelsPath ?? DEFAULT_MODELS_PATH).trim();
  const claudeModelsPath = (provider.claudeModelsPath ?? DEFAULT_MODELS_PATH).trim();

  return {
    ...provider,
    codexBaseUrl,
    codexChatPath,
    codexModelsPath,
    claudeBaseUrl,
    claudeChatPath,
    claudeModelsPath,
  };
}

function normalizeProvider1mConfig(provider: ProviderConfig): ProviderConfig {
  const next: ProviderConfig = normalizeProviderEndpoints(provider);
  const claudeModelMap = { ...(next.claudeModelMap || {}) };
  const claudeModel1mMap = { ...(next.claudeModel1mMap || {}) };
  let changed = false;

  for (const [key, value] of Object.entries(claudeModelMap)) {
    if (has1mSuffix(value)) {
      claudeModelMap[key] = strip1mSuffix(value);
      claudeModel1mMap[key] = true;
      changed = true;
    }
  }

  if (has1mSuffix(next.defaultModel)) {
    next.defaultModel = strip1mSuffix(next.defaultModel);
    changed = true;
  }

  if (changed) {
    next.claudeModelMap = claudeModelMap;
  }
  if (Object.keys(claudeModel1mMap).length > 0) {
    next.claudeModel1mMap = claudeModel1mMap;
  }

  return next;
}

interface AppState {
  service: ServiceStatus;
  providers: Record<string, ProviderConfig>;
  env: EnvConfig;
  codexProviderId: string;
  claudeProviderId: string;
  selectedProvider: string;
  logs: LogEntry[];
  activeNav: NavItem;
  activeMode: ActiveMode;
  loading: boolean;
  error: string | null;
  requestCount: number;
  claudeConfigStatus: ClaudeConfigStatus | null;
  codexConfigStatus: CodexConfigStatus | null;
  localizationStatus: LocalizationStatus | null;
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;

  syncProviderIds: (codexId: string, claudeId: string) => void;
  setServiceStatus: (status: ServiceStatus) => void;
  setProviders: (providers: Record<string, ProviderConfig>) => void;
  setEnv: (env: EnvConfig) => void;
  setSelectedProvider: (id: string) => void;
  editingProviderId: string | null;
  setEditingProviderId: (id: string | null) => void;
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
  setActiveNav: (nav: NavItem) => void;
  setActiveMode: (mode: ActiveMode) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setRequestCount: (count: number) => void;
  setClaudeConfigStatus: (status: ClaudeConfigStatus) => void;
  setCodexConfigStatus: (status: CodexConfigStatus | null) => void;
  setLocalizationStatus: (status: LocalizationStatus) => void;
  setToast: (toast: { message: string; type: 'success' | 'error' | 'info' } | null) => void;

  loadConfig: () => Promise<void>;
  saveProviders: () => Promise<void>;
  saveEnv: () => Promise<void>;
  startService: () => Promise<void>;
  stopService: () => Promise<void>;
  switchActiveProvider: (providerId: string, mode: ActiveMode) => Promise<void>;

  loadClaudeStatus: () => Promise<void>;
  loadCodexStatus: () => Promise<void>;
  applyClaude3pConfig: () => Promise<void>;
  removeClaude3pConfig: () => Promise<void>;
  applyCodexConfig: () => Promise<void>;
  removeCodexConfig: () => Promise<void>;
  applyLocalization: () => Promise<void>;
  restoreLocalization: () => Promise<void>;
}

function getProviderForMode(mode: ActiveMode, state: { providers: Record<string, ProviderConfig>; codexProviderId: string; claudeProviderId: string }): ProviderConfig | undefined {
  const id = mode === 'codex' ? state.codexProviderId : state.claudeProviderId;
  return state.providers[id];
}

function getClaudeModels(providers: Record<string, ProviderConfig>, claudeProviderId: string): ClaudeModelEntry[] {
  const provider = providers[claudeProviderId];
  const claudeMap = provider?.claudeModelMap || {};
  const oneMMap = provider?.claudeModel1mMap || {};
  const entries: ClaudeModelEntry[] = [];

  // Backward compat: old snake_case keys → new claude-* keys
  const compatMap: Record<string, string> = {
    'opus_4_7': 'claude-opus-4-7',
    'opus_4_6': 'claude-opus-4-6',
    'opus_3': 'claude-3-opus',
    'sonnet_4_6': 'claude-sonnet-4-6',
    'sonnet_4_5': 'claude-sonnet-4-5',
    'haiku_4_5': 'claude-haiku-4-5',
  };

  const normalizedMap: Record<string, string> = {};
  const normalizedOneMMap: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(claudeMap)) {
    const resolved = compatMap[key] || key;
    normalizedMap[resolved] = value;
  }
  for (const [key, value] of Object.entries(oneMMap)) {
    const resolved = compatMap[key] || key;
    normalizedOneMMap[resolved] = Boolean(value);
  }

  // Standard Claude model slots (claude-opus-4-7, claude-sonnet-4-6, etc.)
  const standardIds = ['claude-opus-4-7', 'claude-opus-4-6', 'claude-3-opus', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'];

  for (const modelId of standardIds) {
    const mappedModel = normalizedMap[modelId];
    if (mappedModel) {
      const supports1m = Boolean(normalizedOneMMap[modelId]) || has1mSuffix(mappedModel);
      entries.push({
        name: modelId,
        display_name: modelId,
        supports_1m: supports1m,
      });
    }
  }

  // Custom claude-* routes
  for (const [key, value] of Object.entries(normalizedMap)) {
    if (key.startsWith('claude-') && !standardIds.includes(key)) {
      const supports1m = Boolean(normalizedOneMMap[key]) || has1mSuffix(value);
      entries.push({
        name: key,
        display_name: key,
        supports_1m: supports1m,
      });
    }
  }

  if (entries.length === 0) {
    const defaultModel = strip1mSuffix(provider?.defaultModel || 'claude-sonnet-4-6');
    entries.push({
      name: defaultModel,
      display_name: 'Default',
      supports_1m: false,
    });
  }

  return entries;
}

const useAppStore = create<AppState>((set, get) => ({
  service: { running: false },
  providers: {},
  env: {},
  codexProviderId: '',
  claudeProviderId: '',
  selectedProvider: 'deepseek',
  logs: [],
  activeNav: 'dashboard',
  activeMode: 'codex',
  loading: false,
  error: null,
  requestCount: 0,
  claudeConfigStatus: null,
  codexConfigStatus: null,
  localizationStatus: null,
  toast: null,

  syncProviderIds: (codexId: string, claudeId: string) => set({ codexProviderId: codexId, claudeProviderId: claudeId }),

  setServiceStatus: (status) => set({ service: status }),
  setProviders: (providers) => set({ providers }),
  setEnv: (env) => set({ env }),
  setSelectedProvider: (id) => set({ selectedProvider: id }),
  editingProviderId: null as string | null,
  setEditingProviderId: (id: string | null) => set({ editingProviderId: id }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  clearLogs: () => set({ logs: [] }),
  setActiveNav: (nav) => set({ activeNav: nav }),
  setActiveMode: (mode) => set({ activeMode: mode }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setRequestCount: (count) => set({ requestCount: count }),
  setClaudeConfigStatus: (status) => set({ claudeConfigStatus: status }),
  setCodexConfigStatus: (status) => set({ codexConfigStatus: status }),
  setLocalizationStatus: (status) => set({ localizationStatus: status }),
  setToast: (toast) => set({ toast }),

  loadConfig: async () => {
    try {
      set({ loading: true, error: null });
      const [providers, env, service] = await Promise.all([
        api.providers.read(),
        api.env.read(),
        api.service.getStatus(),
      ]);
      // Migrate old snake_case claudeModelMap keys to new claude-* format
      const compatMap: Record<string, string> = {
        'opus_4_7': 'claude-opus-4-7', 'opus_4_6': 'claude-opus-4-6', 'opus_3': 'claude-3-opus',
        'sonnet_4_6': 'claude-sonnet-4-6', 'sonnet_4_5': 'claude-sonnet-4-5', 'haiku_4_5': 'claude-haiku-4-5',
      };
      for (const p of Object.values(providers)) {
        const normalizedProvider = normalizeProvider1mConfig(p);
        Object.assign(p, normalizedProvider);
        if (p.claudeModelMap) {
          const migrated: Record<string, string> = {};
          for (const [key, value] of Object.entries(p.claudeModelMap)) {
            migrated[compatMap[key] || key] = strip1mSuffix(value);
          }
          p.claudeModelMap = migrated;
        }
        if (p.claudeModel1mMap) {
          const migratedFlags: Record<string, boolean> = {};
          for (const [key, value] of Object.entries(p.claudeModel1mMap)) {
            migratedFlags[compatMap[key] || key] = Boolean(value);
          }
          p.claudeModel1mMap = migratedFlags;
        }
      }
      const envMap = env as Record<string, string>;
      const codexId = envMap.CODEX_PROVIDER_PRESET || envMap.PROVIDER_PRESET || Object.keys(providers)[0] || '';
      const claudeId = envMap.CLAUDE_PROVIDER_PRESET || envMap.PROVIDER_PRESET || '';
      set({
        providers,
        env,
        service,
        codexProviderId: codexId,
        claudeProviderId: claudeId,
        selectedProvider: codexId,
        loading: false,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  saveProviders: async () => {
    try {
      set({ loading: true, error: null });
      await api.providers.write(get().providers);
      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  saveEnv: async () => {
    try {
      set({ loading: true, error: null });
      await api.env.write(get().env as Record<string, string>);
      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  startService: async () => {
    try {
      set({ loading: true, error: null });
      const status = await api.service.start();
      set({ service: status, loading: false });
      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'success',
        message: `服务已启动，端口: ${status.port}`,
      });
    } catch (e) {
      set({ error: String(e), loading: false });
      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'error',
        message: String(e),
      });
    }
  },

  stopService: async () => {
    try {
      set({ loading: true, error: null });
      const { service } = get();
      if (service.pid) {
        await api.service.stop(service.pid);
      }
      set({ service: { running: false }, loading: false });
      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'info',
        message: '服务已停止',
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  switchActiveProvider: async (providerId: string, mode: ActiveMode) => {
    try {
      set({ loading: true, error: null });
      const { providers, env, service } = get();
      const provider = providers[providerId];
      if (!provider) {
        set({ error: `供应商 "${providerId}" 不存在`, loading: false });
        return;
      }

      const apiKey = mode === 'codex'
        ? (provider.codexApiKey || provider.apiKey || '')
        : (provider.claudeApiKey || provider.apiKey || '');

      const envMap = { ...(env as Record<string, string>) };
      if (mode === 'codex') {
        envMap.CODEX_PROVIDER_PRESET = providerId;
        envMap.CODEX_TARGET_API_KEY = apiKey;
        envMap.PROVIDER_PRESET = providerId;
        envMap.TARGET_API_KEY = apiKey;
        set({ codexProviderId: providerId, env: envMap, selectedProvider: providerId });
      } else {
        envMap.CLAUDE_PROVIDER_PRESET = providerId;
        envMap.CLAUDE_TARGET_API_KEY = apiKey;
        set({ claudeProviderId: providerId, env: envMap });
      }
      await api.env.write(envMap);

      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'info',
        message: `${mode === 'codex' ? 'Codex' : 'Claude'} 切换至供应商: ${provider.name || providerId}`,
      });

      if (service.running && service.pid) {
        await api.service.stop(service.pid);
        const status = await api.service.start();
        set({ service: status });
        get().addLog({
          id: `log-${Date.now()}`,
          timestamp: new Date(),
          level: 'success',
          message: `服务已重启，端口: ${status.port}`,
        });
      }

      set({ loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  // ── Claude actions ──

  loadClaudeStatus: async () => {
    try {
      const [configStatus, codexStatus, locStatus] = await Promise.all([
        api.claude.getConfigStatus(),
        api.codex.getConfigStatus().catch(() => null),
        api.localization.getStatus(),
      ]);
      set({ claudeConfigStatus: configStatus, codexConfigStatus: codexStatus, localizationStatus: locStatus });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadCodexStatus: async () => {
    try {
      const status = await api.codex.getConfigStatus();
      set({ codexConfigStatus: status });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  applyClaude3pConfig: async () => {
    try {
      set({ loading: true, error: null });
      const { env, providers, claudeProviderId } = get();
      const port = parseInt(env.PORT || '8088', 10);
      const apiKey = (env.PROXY_API_KEY || '').trim();
      if (!apiKey) {
        throw new Error('请先在设置中配置代理 API Key，再应用 Claude Desktop 配置');
      }
      const models = getClaudeModels(providers, claudeProviderId);

      await api.claude.apply3pConfig(port, apiKey, models);
      const status = await api.claude.getConfigStatus();
      set({ claudeConfigStatus: status, loading: false, toast: { message: '配置已应用，请重启 Claude Desktop 以生效', type: 'success' } });
      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'success',
        message: 'Claude Desktop 3P 配置已应用',
      });
    } catch (e) {
      set({ error: String(e), loading: false, toast: { message: String(e), type: 'error' } });
    }
  },

  removeClaude3pConfig: async () => {
    try {
      set({ loading: true, error: null });
      await api.claude.remove3pConfig();
      const status = await api.claude.getConfigStatus();
      set({ claudeConfigStatus: status, loading: false });
      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'info',
        message: 'Claude Desktop 3P 配置已移除',
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  applyCodexConfig: async () => {
    try {
      set({ loading: true, error: null });
      const { env, providers, codexProviderId } = get();
      const port = parseInt(env.PORT || '8088', 10);
      const apiKey = (env.PROXY_API_KEY || '').trim();
      if (!apiKey) {
        throw new Error('请先在设置中配置代理 API Key，再应用 Codex 配置');
      }
      const provider = providers[codexProviderId];
      const defaultModel = strip1mSuffix(provider?.defaultModel || 'gpt-5-codex');

      await api.codex.applyConfig(port, apiKey, defaultModel);
      const status = await api.codex.getConfigStatus();
      set({ codexConfigStatus: status, loading: false, toast: { message: 'Codex 配置已应用，请重启 Codex 以生效', type: 'success' } });
      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'success',
        message: `Codex 配置已应用 (网关: http://127.0.0.1:${port})`,
      });
    } catch (e) {
      set({ error: String(e), loading: false, toast: { message: String(e), type: 'error' } });
    }
  },

  removeCodexConfig: async () => {
    try {
      set({ loading: true, error: null });
      await api.codex.removeConfig();
      const status = await api.codex.getConfigStatus();
      set({ codexConfigStatus: status, loading: false });
      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'info',
        message: 'Codex 配置已移除',
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  applyLocalization: async () => {
    try {
      set({ loading: true, error: null });
      const zhCN = '{}'; // placeholder - actual translations loaded from bundle
      const desktop = '{}';
      const statsig = '{}';
      await api.localization.apply(zhCN, desktop, statsig);
      const status = await api.localization.getStatus();
      set({ localizationStatus: status, loading: false });
      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'success',
        message: 'Claude Desktop 汉化已应用',
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  restoreLocalization: async () => {
    try {
      set({ loading: true, error: null });
      await api.localization.restore();
      const status = await api.localization.getStatus();
      set({ localizationStatus: status, loading: false });
      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'info',
        message: 'Claude Desktop 汉化已恢复',
      });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },
}));

export default useAppStore;
export { getProviderForMode };