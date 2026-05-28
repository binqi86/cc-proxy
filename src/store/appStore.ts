import { create } from 'zustand';
import { api } from '@/lib/api';
import { strip1mSuffix, has1mSuffix, normalizeProvider1mConfig, CLAUDE_KEY_COMPAT } from '@/lib/providers';
import type {
  ProviderConfig, EnvConfig, ServiceStatus, LogEntry, NavItem, ActiveMode,
  ClaudeConfigStatus, CodexConfigStatus, LocalizationStatus, ClaudeModelEntry,
} from '@/lib/config';

// ── Claude model list builder ──

export function getClaudeModels(providers: Record<string, ProviderConfig>, claudeProviderId: string): ClaudeModelEntry[] {
  const provider = providers[claudeProviderId];
  const claudeMap = provider?.claudeModelMap || {};
  const oneMMap = provider?.claudeModel1mMap || {};
  const entries: ClaudeModelEntry[] = [];

  const normalizedMap: Record<string, string> = {};
  const normalizedOneMMap: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(claudeMap)) {
    normalizedMap[CLAUDE_KEY_COMPAT[key] || key] = value;
  }
  for (const [key, value] of Object.entries(oneMMap)) {
    normalizedOneMMap[CLAUDE_KEY_COMPAT[key] || key] = Boolean(value);
  }

  const standardIds = ['claude-opus-4-7', 'claude-opus-4-6', 'claude-3-opus', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
  for (const modelId of standardIds) {
    if (normalizedMap[modelId]) {
      entries.push({ name: modelId, display_name: modelId, supports_1m: Boolean(normalizedOneMMap[modelId]) || has1mSuffix(normalizedMap[modelId]) });
    }
  }
  for (const [key, value] of Object.entries(normalizedMap)) {
    if (key.startsWith('claude-') && !standardIds.includes(key)) {
      entries.push({ name: key, display_name: key, supports_1m: Boolean(normalizedOneMMap[key]) || has1mSuffix(value) });
    }
  }
  if (entries.length === 0) {
    entries.push({ name: strip1mSuffix(provider?.defaultModel || 'claude-sonnet-4-6'), display_name: 'Default', supports_1m: false });
  }
  return entries;
}

// ── Store interface ──

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
  editingProviderId: string | null;

  // Setters
  syncProviderIds: (codexId: string, claudeId: string) => void;
  setServiceStatus: (status: ServiceStatus) => void;
  setProviders: (providers: Record<string, ProviderConfig>) => void;
  setEnv: (env: EnvConfig) => void;
  setSelectedProvider: (id: string) => void;
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

  // Actions
  loadConfig: () => Promise<void>;
  saveProviders: () => Promise<void>;
  saveEnv: () => Promise<void>;
  startService: () => Promise<void>;
  stopService: () => Promise<void>;
  switchActiveProvider: (providerId: string, mode: ActiveMode) => Promise<void>;
  loadClaudeStatus: () => Promise<void>;
  loadCodexStatus: () => Promise<void>;
  loadLocalizationStatus: () => Promise<void>;
  applyClaude3pConfig: () => Promise<void>;
  removeClaude3pConfig: () => Promise<void>;
  applyCodexConfig: () => Promise<void>;
  removeCodexConfig: () => Promise<void>;
  applyLocalization: () => Promise<void>;
  restoreLocalization: () => Promise<void>;
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
  editingProviderId: null,

  syncProviderIds: (codexId, claudeId) => set({ codexProviderId: codexId, claudeProviderId: claudeId }),
  setServiceStatus: (status) => set({ service: status }),
  setProviders: (providers) => set({ providers }),
  setEnv: (env) => set({ env }),
  setSelectedProvider: (id) => set({ selectedProvider: id }),
  setEditingProviderId: (id) => set({ editingProviderId: id }),
  addLog: (log) => set((s) => ({ logs: [...s.logs, log] })),
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
      const [providers, env, service] = await Promise.all([api.providers.read(), api.env.read(), api.service.getStatus()]);

      // Normalize providers
      for (const p of Object.values(providers)) {
        Object.assign(p, normalizeProvider1mConfig(p));
        if (p.claudeModelMap) {
          const migrated: Record<string, string> = {};
          for (const [key, value] of Object.entries(p.claudeModelMap)) {
            migrated[CLAUDE_KEY_COMPAT[key] || key] = strip1mSuffix(value);
          }
          p.claudeModelMap = migrated;
        }
        if (p.claudeModel1mMap) {
          const migratedFlags: Record<string, boolean> = {};
          for (const [key, value] of Object.entries(p.claudeModel1mMap)) {
            migratedFlags[CLAUDE_KEY_COMPAT[key] || key] = Boolean(value);
          }
          p.claudeModel1mMap = migratedFlags;
        }
      }

      const envMap = env as Record<string, string>;
      const codexId = envMap.CODEX_PROVIDER_PRESET || envMap.PROVIDER_PRESET || Object.keys(providers)[0] || '';
      const claudeId = envMap.CLAUDE_PROVIDER_PRESET || envMap.PROVIDER_PRESET || '';
      set({ providers, env, service, codexProviderId: codexId, claudeProviderId: claudeId, selectedProvider: codexId, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  saveProviders: async () => {
    try { set({ loading: true }); await api.providers.write(get().providers); set({ loading: false }); }
    catch (e) { set({ error: String(e), loading: false }); }
  },

  saveEnv: async () => {
    try { set({ loading: true }); await api.env.write(get().env as Record<string, string>); set({ loading: false }); }
    catch (e) { set({ error: String(e), loading: false }); }
  },

  startService: async () => {
    try {
      set({ loading: true, error: null });
      const status = await api.service.start();
      set({ service: status, loading: false });
      get().addLog({ id: `log-${Date.now()}`, timestamp: new Date(), level: 'success', message: `服务已启动，端口: ${status.port}` });
    } catch (e) {
      set({ error: String(e), loading: false });
      get().addLog({ id: `log-${Date.now()}`, timestamp: new Date(), level: 'error', message: String(e) });
    }
  },

  stopService: async () => {
    try {
      set({ loading: true, error: null });
      const { service } = get();
      if (service.pid) await api.service.stop(service.pid);
      set({ service: { running: false }, loading: false });
      get().addLog({ id: `log-${Date.now()}`, timestamp: new Date(), level: 'info', message: '服务已停止' });
    } catch (e) { set({ error: String(e), loading: false }); }
  },

  switchActiveProvider: async (providerId, mode) => {
    try {
      set({ loading: true, error: null });
      const { providers, env, service } = get();
      const provider = providers[providerId];
      if (!provider) { set({ error: `供应商 "${providerId}" 不存在`, loading: false }); return; }

      const apiKey = mode === 'codex' ? (provider.codexApiKey || provider.apiKey || '') : (provider.claudeApiKey || provider.apiKey || '');
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

      get().addLog({ id: `log-${Date.now()}`, timestamp: new Date(), level: 'info', message: `${mode === 'codex' ? 'Codex' : 'Claude'} 切换至: ${provider.name || providerId}` });

      if (service.running && service.pid) {
        await api.service.stop(service.pid);
        const status = await api.service.start();
        set({ service: status });
        get().addLog({ id: `log-${Date.now()}`, timestamp: new Date(), level: 'success', message: `服务已重启，端口: ${status.port}` });
      }
      set({ loading: false });
    } catch (e) { set({ error: String(e), loading: false }); }
  },

  loadClaudeStatus: async () => {
    try {
      const [cs, cc, ls] = await Promise.all([
        api.claude.getConfigStatus(),
        api.codex.getConfigStatus().catch(() => null),
        api.localization.getStatus(),
      ]);
      set({ claudeConfigStatus: cs, codexConfigStatus: cc, localizationStatus: ls });
    } catch (e) { set({ error: String(e) }); }
  },

  loadCodexStatus: async () => {
    try { set({ codexConfigStatus: await api.codex.getConfigStatus() }); }
    catch (e) { set({ error: String(e) }); }
  },

  loadLocalizationStatus: async () => {
    try { set({ localizationStatus: await api.localization.getStatus() }); }
    catch (e) { set({ error: String(e) }); }
  },

  applyClaude3pConfig: async () => {
    try {
      set({ loading: true, error: null });
      const { env, providers, claudeProviderId } = get();
      const port = parseInt(env.PORT || '8088', 10);
      const apiKey = (env.PROXY_API_KEY || '').trim();
      if (!apiKey) throw new Error('请先在设置中配置代理 API Key');
      const models = getClaudeModels(providers, claudeProviderId);
      await api.claude.apply3pConfig(port, apiKey, models);
      set({ claudeConfigStatus: await api.claude.getConfigStatus(), loading: false, toast: { message: '配置已应用，请重启 Claude Desktop', type: 'success' } });
    } catch (e) { set({ error: String(e), loading: false, toast: { message: String(e), type: 'error' } }); }
  },

  removeClaude3pConfig: async () => {
    try {
      set({ loading: true });
      await api.claude.remove3pConfig();
      set({ claudeConfigStatus: await api.claude.getConfigStatus(), loading: false });
    } catch (e) { set({ error: String(e), loading: false }); }
  },

  applyCodexConfig: async () => {
    try {
      set({ loading: true, error: null });
      const { env, providers, codexProviderId } = get();
      const port = parseInt(env.PORT || '8088', 10);
      const apiKey = (env.PROXY_API_KEY || '').trim();
      if (!apiKey) throw new Error('请先在设置中配置代理 API Key');
      const provider = providers[codexProviderId];
      const defaultModel = strip1mSuffix(provider?.defaultModel || 'gpt-5-codex');
      const contextWindow = provider?.codexContextWindow !== false;
      await api.codex.applyConfig(port, apiKey, defaultModel, contextWindow);
      set({ codexConfigStatus: await api.codex.getConfigStatus(), loading: false, toast: { message: 'Codex 配置已应用', type: 'success' } });
    } catch (e) { set({ error: String(e), loading: false, toast: { message: String(e), type: 'error' } }); }
  },

  removeCodexConfig: async () => {
    try {
      set({ loading: true });
      await api.codex.removeConfig();
      set({ codexConfigStatus: await api.codex.getConfigStatus(), loading: false });
    } catch (e) { set({ error: String(e), loading: false }); }
  },

  applyLocalization: async () => {
    try {
      set({ loading: true, error: null });
      const msg = await api.localization.applyBundled();
      set({ localizationStatus: await api.localization.getStatus(), loading: false, toast: { message: msg, type: 'success' } });
    } catch (e) { set({ error: String(e), loading: false, toast: { message: String(e), type: 'error' } }); }
  },

  restoreLocalization: async () => {
    try {
      set({ loading: true });
      await api.localization.restore();
      set({ localizationStatus: await api.localization.getStatus(), loading: false });
    } catch (e) { set({ error: String(e), loading: false }); }
  },
}));

export default useAppStore;
