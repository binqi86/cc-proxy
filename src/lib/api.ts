import { invoke } from '@tauri-apps/api/core';
import type {
  ProviderConfig,
  EnvConfig,
  ServiceStatus,
  AppStats,
  TestConfig,
  TestResult,
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
};
