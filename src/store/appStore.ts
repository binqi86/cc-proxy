import { create } from 'zustand';
import { api } from '@/lib/api';
import type {
  ProviderConfig,
  EnvConfig,
  ServiceStatus,
  LogEntry,
  NavItem,
} from '@/lib/config';

interface AppState {
  service: ServiceStatus;
  providers: Record<string, ProviderConfig>;
  env: EnvConfig;
  selectedProvider: string;
  logs: LogEntry[];
  activeNav: NavItem;
  loading: boolean;
  error: string | null;
  requestCount: number;

  setServiceStatus: (status: ServiceStatus) => void;
  setProviders: (providers: Record<string, ProviderConfig>) => void;
  setEnv: (env: EnvConfig) => void;
  setSelectedProvider: (id: string) => void;
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
  setActiveNav: (nav: NavItem) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setRequestCount: (count: number) => void;

  loadConfig: () => Promise<void>;
  saveProviders: () => Promise<void>;
  saveEnv: () => Promise<void>;
  startService: () => Promise<void>;
  stopService: () => Promise<void>;
  switchActiveProvider: (providerId: string) => Promise<void>;
}

const useAppStore = create<AppState>((set, get) => ({
  service: { running: false },
  providers: {},
  env: {},
  selectedProvider: 'deepseek',
  logs: [],
  activeNav: 'overview',
  loading: false,
  error: null,
  requestCount: 0,

  setServiceStatus: (status) => set({ service: status }),
  setProviders: (providers) => set({ providers }),
  setEnv: (env) => set({ env }),
  setSelectedProvider: (id) => set({ selectedProvider: id }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  clearLogs: () => set({ logs: [] }),
  setActiveNav: (nav) => set({ activeNav: nav }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setRequestCount: (count) => set({ requestCount: count }),

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
}));

export default useAppStore;
