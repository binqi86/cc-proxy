import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import useAppStore from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Play, Square, Cpu, Settings, BarChart3, Terminal } from '@/components/icons';
import type { ServiceStatus } from '@/lib/config';
import { getStoredTheme, toggleTheme } from '@/lib/theme';
import ProviderTab from '@/components/ProviderTab';
import EnvConfig from '@/components/EnvConfig';
import StatusMonitor from '@/components/StatusMonitor';
import TestTool from '@/components/TestTool';

const SunIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
  </svg>
);

const MoonIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

function App() {
  const { service, activeTab, loading, error, loadConfig, startService, stopService, setActiveTab } = useAppStore();
  const [theme, setTheme] = useState(getStoredTheme());

  useEffect(() => {
    loadConfig();
    const u1 = listen<ServiceStatus>('service-status-changed', (e) => useAppStore.getState().setServiceStatus(e.payload));
    const u2 = listen('tray-toggle-service', () => useAppStore.getState().startService());
    // Also listen for direct DOM event from Rust eval
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) useAppStore.getState().setServiceStatus(detail);
    };
    document.addEventListener('sync-service-status', onSync);
    return () => {
      u1.then(fn => fn?.());
      u2.then(fn => fn?.());
      document.removeEventListener('sync-service-status', onSync);
    };
  }, []);

  const handleThemeToggle = () => setTheme(toggleTheme());

  const tabs = [
    { id: 'providers' as const, label: 'Providers', icon: Cpu },
    { id: 'env' as const, label: '环境配置', icon: Settings },
    { id: 'status' as const, label: '状态监控', icon: BarChart3 },
    { id: 'test' as const, label: '测试工具', icon: Terminal },
  ];

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header data-tauri-drag-region className="flex items-center justify-between pl-20 pr-5 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <span className={`inline-block w-2 h-2 rounded-full ring-2 flex-shrink-0 ${service.running ? 'bg-primary ring-primary/30' : 'bg-muted-foreground/40 ring-muted-foreground/10'}`} />
          <h1 className="text-[15px] font-semibold tracking-tight select-none">Codex CN Proxy</h1>
          <span className="text-[11px] text-muted-foreground/70 bg-muted px-2 py-0.5 rounded-full font-medium">
            {service.running ? `Port ${service.port || '—'}` : 'Stopped'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-destructive mr-2 max-w-[260px] truncate">{error}</span>}

          {/* Theme toggle */}
          <button
            onClick={handleThemeToggle}
            className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>

          <Button size="sm" variant={service.running ? 'destructive' : 'default'} onClick={() => service.running ? stopService() : startService()} disabled={loading}>
            {service.running ? <><Square className="w-3.5 h-3.5" /> Stop</> : <><Play className="w-3.5 h-3.5 fill-current" /> Start</>}
          </Button>
        </div>
      </header>

      {/* Tab bar */}
      <div className="px-5 pt-4 pb-0">
        <Tabs defaultValue="providers" value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-4 bg-muted rounded-lg p-0.5">
            {tabs.map(({ id, label, icon: Icon }) => (
              <TabsTrigger key={id} value={id} className="flex items-center gap-1.5 py-2 text-[13px]">
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="mt-4" style={{ height: 'calc(100vh - 120px)' }}>
            <TabsContent value="providers" className="h-full"><ProviderTab /></TabsContent>
            <TabsContent value="env" className="h-full"><EnvConfig /></TabsContent>
            <TabsContent value="status" className="h-full"><StatusMonitor /></TabsContent>
            <TabsContent value="test" className="h-full"><TestTool /></TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

export default App;
