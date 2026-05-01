import { create } from 'zustand';
import { api } from '@/lib/api';
import type {
  ProviderConfig,
  EnvConfig,
  ServiceStatus,
  LogEntry,
  TabName,
} from '@/lib/config';

interface AppState {
  service: ServiceStatus;
  providers: Record<string, ProviderConfig>;
  env: EnvConfig;
  selectedProvider: string;
  logs: LogEntry[];
  activeTab: TabName;
  loading: boolean;
  error: string | null;

  setServiceStatus: (status: ServiceStatus) => void;
  setProviders: (providers: Record<string, ProviderConfig>) => void;
  setEnv: (env: EnvConfig) => void;
  setSelectedProvider: (id: string) => void;
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
  setActiveTab: (tab: TabName) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  loadConfig: () => Promise<void>;
  saveProviders: () => Promise<void>;
  saveEnv: () => Promise<void>;
  startService: () => Promise<void>;
  stopService: () => Promise<void>;
}

const useAppStore = create<AppState>((set, get) => ({
  service: { running: false },
  providers: {},
  env: {},
  selectedProvider: 'deepseek',
  logs: [],
  activeTab: 'providers',
  loading: false,
  error: null,

  setServiceStatus: (status) => set({ service: status }),
  setProviders: (providers) => set({ providers }),
  setEnv: (env) => set({ env }),
  setSelectedProvider: (id) => set({ selectedProvider: id }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  clearLogs: () => set({ logs: [] }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

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
}));

export default useAppStore;
