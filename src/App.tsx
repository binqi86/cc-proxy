import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getStoredTheme, toggleTheme } from '@/lib/theme';
import {
  LayoutDashboard,
  Settings,
  ScrollText,
  FlaskConical,
  Server,
} from '@/components/icons';
import type { ServiceStatus } from '@/lib/config';
import Overview from '@/components/Overview';
import ProviderTab from '@/components/ProviderTab';
import EnvConfig from '@/components/EnvConfig';
import StatusMonitor from '@/components/StatusMonitor';
import TestTool from '@/components/TestTool';

const SunIconComp = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
  </svg>
);

const MoonIconComp = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

const navItems: { id: import('@/lib/config').NavItem; label: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>> }[] = [
  { id: 'overview', label: '服务概览', icon: LayoutDashboard },
  { id: 'providers', label: '供应商管理', icon: Server },
  { id: 'env', label: '环境配置', icon: Settings },
  { id: 'status', label: '运行日志', icon: ScrollText },
  { id: 'test', label: '接口测试', icon: FlaskConical },
];

function App() {
  const { service, activeNav, error, loadConfig, startService, stopService, setActiveNav } = useAppStore();
  const [theme, setTheme] = useState(getStoredTheme());

  useEffect(() => {
    loadConfig();
    const u1 = listen<ServiceStatus>('service-status-changed', (e) => useAppStore.getState().setServiceStatus(e.payload));
    // Poll for theme changes from popup
    const themeInterval = setInterval(() => setTheme(getStoredTheme()), 1000);
    // Poll for proxy log lines
    const pollInterval = setInterval(async () => {
      try {
        const lines = await api.service.pollLogs();
        if (lines.length === 0) return;
        const store = useAppStore.getState();
        for (const line of lines) {
          if (line.startsWith('[PROXY_LOG]')) {
            try {
              const data = JSON.parse(line.slice(11));
              const event = data.event;
              let message: string;
              if (event === 'startup') {
                message = `代理启动于 ${data.host}:${data.port}, 供应商=${data.preset || '无'}, 目标=${data.target}`;
              } else if (event === 'upstream_request') {
                message = `→ ${data.model}${data.stream ? ' (流式)' : ''} [${data.messages || 0} 条消息, ${data.tools || 0} 个工具]`;
              } else if (event === 'upstream_response') {
                message = `← ${data.status} ${data.latency}ms${data.error ? ' 错误: ' + data.error : ''}`;
              } else {
                message = JSON.stringify(data);
              }
              store.addLog({
                id: `plog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                timestamp: new Date(data.ts || Date.now()),
                level: data.level === 'success' ? 'success' : data.level === 'warning' ? 'warning' : data.level === 'error' ? 'error' : 'info',
                message,
                latency: data.latency,
                data,
              });
            } catch { /* ignore */ }
          } else if (line.trim()) {
            store.addLog({
              id: `plog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              timestamp: new Date(),
              level: 'info',
              message: line,
            });
          }
        }
      } catch { /* poll failed */ }
    }, 500);

    const onSync = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) useAppStore.getState().setServiceStatus(detail);
    };
    document.addEventListener('sync-service-status', onSync);

    return () => {
      clearInterval(pollInterval);
      clearInterval(themeInterval);
      u1.then(fn => fn?.());
      document.removeEventListener('sync-service-status', onSync);
    };
  }, []);

  const handleThemeToggle = () => setTheme(toggleTheme());

  const renderContent = () => {
    switch (activeNav) {
      case 'overview': return <Overview />;
      case 'providers': return <ProviderTab />;
      case 'env': return <EnvConfig />;
      case 'status': return <StatusMonitor />;
      case 'test': return <TestTool />;
    }
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-[220px] flex-shrink-0 flex flex-col border-r border-border bg-card">
        {/* Logo area */}
        <div data-tauri-drag-region className="px-5 py-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${service.running ? 'bg-primary/20' : 'bg-muted'}`}>
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${service.running ? 'bg-primary shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-muted-foreground/40'}`}>
                {service.running && <span className="absolute inline-flex w-2.5 h-2.5 rounded-full bg-primary animate-ping opacity-75" />}
              </span>
            </div>
            <div className="min-w-0">
              <h1 className="text-[14px] font-semibold leading-tight tracking-tight">Codex CN Proxy</h1>
              <p className="text-[11px] text-muted-foreground leading-tight">
                {service.running ? `端口 ${service.port || '—'}` : '已停止'}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 space-y-0.5">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveNav(id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all duration-150',
                activeNav === id
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50',
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {/* Bottom: Theme + Error */}
        <div className="px-3 py-3 border-t border-border space-y-2 shrink-0">
          {error && (
            <p className="text-[11px] text-destructive px-3 truncate" title={error}>
              {error}
            </p>
          )}
          <button
            onClick={handleThemeToggle}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-all duration-150"
          >
            {theme === 'light' ? <MoonIconComp /> : <SunIconComp />}
            <span>{theme === 'light' ? '深色模式' : '浅色模式'}</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Top bar */}
        <header data-tauri-drag-region className="h-11 flex items-center justify-between px-6 border-b border-border shrink-0">
          <h2 className="text-[13px] font-medium text-muted-foreground">
            {navItems.find((n) => n.id === activeNav)?.label}
          </h2>
          {activeNav === 'overview' && (
            <button
              onClick={() => service.running ? stopService() : startService()}
              className={cn(
                'px-4 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150',
                service.running
                  ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                  : 'bg-primary text-primary-foreground hover:opacity-90',
              )}
            >
              {service.running ? '停止服务' : '启动服务'}
            </button>
          )}
        </header>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

export default App;
