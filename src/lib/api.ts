import { invoke } from '@tauri-apps/api/core';
import type {
  ProviderConfig,
  EnvConfig,
  ServiceStatus,
  AppStats,
  TestConfig,
  TestResult,
  ClaudeConfigStatus,
  LocalizationStatus,
  ClaudeModelEntry,
} from './config';

export const api = {
  service: {
    start: () => invoke<ServiceStatus>('start_service'),
    stop: (pid: number) => invoke<{ success: boolean }>('stop_service', { pid }),
    getStatus: () => invoke<ServiceStatus>('get_service_status'),
    getStats: () => invoke<AppStats>('get_stats'),
    pollLogs: () => invoke<string[]>('poll_proxy_logs'),
  },

  providers: {
    read: () => invoke<Record<string, ProviderConfig>>('read_providers'),
    write: (providers: Record<string, ProviderConfig>) =>
      invoke<{ success: boolean }>('write_providers', { providers }),
  },

  env: {
    read: () => invoke<Record<string, string>>('read_env'),
    write: (env: Record<string, string>) => invoke<{ success: boolean }>('write_env', { env }),
  },

  test: {
    connection: (config: TestConfig) => invoke<TestResult>('test_connection', { config }),
  },

  window: {
    showMain: () => invoke<void>('show_main_window'),
    quit: () => invoke<void>('quit_app'),
    resetCount: () => invoke<number>('reset_request_count'),
  },

  claude: {
    getConfigStatus: () => invoke<ClaudeConfigStatus>('get_claude_config_status'),
    apply3pConfig: (port: number, apiKey: string, models: ClaudeModelEntry[]) =>
      invoke<string>('apply_claude_3p_config', { port, apiKey, models }),
    remove3pConfig: () => invoke<void>('remove_claude_3p_config'),
    restartDesktop: () => invoke<string>('restart_claude_desktop'),
  },

  localization: {
    getStatus: () => invoke<LocalizationStatus>('get_localization_status'),
    apply: (zhCnJson: string, desktopJson: string, statsigJson: string) =>
      invoke<string>('apply_chinese_localization', { zhCnJson, desktopJson, statsigJson }),
    restore: () => invoke<string>('restore_chinese_localization'),
  },

  provider: {
    balance: (id: string, baseUrl: string, apiKey: string) =>
      invoke<{ supported: boolean; balance: string | null; message: string }>('query_provider_balance', { providerId: id, baseUrl, apiKey }),
  },
};
