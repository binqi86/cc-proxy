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
  LocalizationStatus,
  ClaudeModelEntry,
} from '@/lib/config';

interface AppState {
  service: ServiceStatus;
  providers: Record<string, ProviderConfig>;
  env: EnvConfig;
  selectedProvider: string;
  logs: LogEntry[];
  activeNav: NavItem;
  activeMode: ActiveMode;
  loading: boolean;
  error: string | null;
  requestCount: number;
  claudeConfigStatus: ClaudeConfigStatus | null;
  localizationStatus: LocalizationStatus | null;

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
  setLocalizationStatus: (status: LocalizationStatus) => void;

  loadConfig: () => Promise<void>;
  saveProviders: () => Promise<void>;
  saveEnv: () => Promise<void>;
  startService: () => Promise<void>;
  stopService: () => Promise<void>;
  switchActiveProvider: (providerId: string) => Promise<void>;

  loadClaudeStatus: () => Promise<void>;
  applyClaude3pConfig: () => Promise<void>;
  removeClaude3pConfig: () => Promise<void>;
  applyLocalization: () => Promise<void>;
  restoreLocalization: () => Promise<void>;
}

function getClaudeModels(providers: Record<string, ProviderConfig>, env: EnvConfig): ClaudeModelEntry[] {
  const presetId = env.PROVIDER_PRESET || '';
  const provider = providers[presetId];
  const claudeMap = provider?.claudeModelMap || {};
  const entries: ClaudeModelEntry[] = [];

  const slotNames: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-6',
    'haiku': 'claude-haiku-4-6',
    'opus': 'claude-opus-4-6',
    'default': 'claude-default',
  };

  for (const [slot, displayName] of Object.entries(slotNames)) {
    const mappedModel = claudeMap[slot];
    if (mappedModel) {
      entries.push({
        name: `claude-${mappedModel.replace(/[^a-zA-Z0-9-]/g, '-')}`,
        display_name: displayName,
        supports_1m: mappedModel.endsWith('[1m]'),
      });
    }
  }

  if (entries.length === 0) {
    const defaultModel = provider?.defaultModel || 'claude-sonnet-4-6';
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
  selectedProvider: 'deepseek',
  logs: [],
  activeNav: 'dashboard',
  activeMode: 'codex',
  loading: false,
  error: null,
  requestCount: 0,
  claudeConfigStatus: null,
  localizationStatus: null,

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
  setLocalizationStatus: (status) => set({ localizationStatus: status }),

  loadConfig: async () => {
    try {
      set({ loading: true, error: null });
      const [providers, env, service] = await Promise.all([
        api.providers.read(),
        api.env.read(),
        api.service.getStatus(),
      ]);
      const presetId = env.PROVIDER_PRESET || Object.keys(providers)[0] || '';
      set({
        providers,
        env,
        service,
        selectedProvider: presetId,
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

  switchActiveProvider: async (providerId: string) => {
    try {
      set({ loading: true, error: null });
      const { providers, env, service } = get();
      const provider = providers[providerId];
      if (!provider) {
        set({ error: `供应商 "${providerId}" 不存在`, loading: false });
        return;
      }

      const newEnv: Record<string, string> = {
        ...(env as Record<string, string>),
        PROVIDER_PRESET: providerId,
        TARGET_API_KEY: provider.apiKey || (env as Record<string, string>).TARGET_API_KEY || '',
      };
      delete newEnv.DEFAULT_MODEL;
      delete newEnv.MODEL_MAP;

      set({ env: newEnv, selectedProvider: providerId });
      await api.env.write(newEnv);

      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'info',
        message: `切换至供应商: ${provider.name || providerId}`,
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
      const [configStatus, locStatus] = await Promise.all([
        api.claude.getConfigStatus(),
        api.localization.getStatus(),
      ]);
      set({ claudeConfigStatus: configStatus, localizationStatus: locStatus });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  applyClaude3pConfig: async () => {
    try {
      set({ loading: true, error: null });
      const { env, providers } = get();
      const port = parseInt(env.PORT || '8088', 10);
      const apiKey = env.PROXY_API_KEY || 'proxy';
      const models = getClaudeModels(providers, env);

      await api.claude.apply3pConfig(port, apiKey, models);
      const status = await api.claude.getConfigStatus();
      set({ claudeConfigStatus: status, loading: false });
      get().addLog({
        id: `log-${Date.now()}`,
        timestamp: new Date(),
        level: 'success',
        message: 'Claude Desktop 3P 配置已应用',
      });
    } catch (e) {
      set({ error: String(e), loading: false });
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
