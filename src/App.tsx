import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getStoredTheme, toggleTheme, applyTheme } from '@/lib/theme';
import type { ServiceStatus, NavItem } from '@/lib/config';
import Dashboard from '@/components/Dashboard';
import ProvidersPage from '@/components/ProvidersPage';
import ProxyPage from '@/components/ProxyPage';
import ToolsPage from '@/components/ToolsPage';
import SettingsPage from '@/components/SettingsPage';

const SpeedIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2Z"/><path d="M2 12h2"/><path d="M16 8l-4 4"/></svg>);
const PlugIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8Z"/></svg>);
const BroadcastIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M15.54 9.46a5 5 0 0 0-7.07 0"/><line x1="12" x2="12" y1="14" y2="18"/><circle cx="12" cy="18" r="1"/></svg>);
const ToolsIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg>);
const GearIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M18.727 14.727a8.82 8.82 0 0 0 1.636-2.727 8.82 8.82 0 0 0-1.636-2.727M5.273 9.273A8.82 8.82 0 0 0 3.636 12c0 .95.273 1.86.727 2.727"/></svg>);
const MoonIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>);
const SunIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2"/></svg>);
const PlayIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 3"/></svg>);
const StopIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>);

const routeTabs: { id: NavItem; label: string; Icon: React.FC }[] = [
  { id: 'dashboard', label: '仪表盘', Icon: SpeedIcon },
  { id: 'providers', label: '供应商', Icon: PlugIcon },
  { id: 'proxy', label: '代理', Icon: BroadcastIcon },
  { id: 'tools', label: '工具', Icon: ToolsIcon },
  { id: 'settings', label: '设置', Icon: GearIcon },
];

export default function App() {
  const { service, activeNav, error, loadConfig, setActiveNav, setServiceStatus, startService, stopService } = useAppStore();
  const [theme, setTheme] = useState(getStoredTheme());
  const isDark = theme === 'dark';

  useEffect(() => {
    loadConfig();
    const u1 = listen<ServiceStatus>('service-status-changed', (e) => setServiceStatus(e.payload));
    const themeI = setInterval(() => { const t = getStoredTheme(); setTheme(t); applyTheme(t); }, 1000);

    const pollI = setInterval(async () => {
      try {
        const lines = await api.service.pollLogs();
        if (!lines.length) return;
        const store = useAppStore.getState();
        for (const line of lines) {
          if (line.startsWith('[PROXY_LOG]')) {
            const msg = line.slice(12); // after "[PROXY_LOG] "
            const level = msg.startsWith('✗') ? 'error'
              : msg.startsWith('← 4') || msg.startsWith('← 5') ? 'error'
              : msg.startsWith('← 2') ? 'success'
              : 'info';
            // Extract latency from response lines: "← 200 | 1493ms"
            let latency: number | undefined;
            const m = msg.match(/\|\s*(\d+)ms/);
            if (m) latency = parseInt(m[1], 10);
            store.addLog({
              id: `plog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,
              timestamp: new Date(),
              level,
              message: msg,
              latency,
            });
          }
        }
      } catch { /* */ }
    }, 500);

    const onSync = (e: Event) => { const d = (e as CustomEvent).detail; if (d) setServiceStatus(d); };
    document.addEventListener('sync-service-status', onSync);
    return () => { clearInterval(pollI); clearInterval(themeI); u1.then(fn => fn?.()); document.removeEventListener('sync-service-status', onSync); };
  }, []);

  const handleTheme = () => setTheme(toggleTheme());
  const handleService = () => service.running ? stopService() : startService();

  const renderPage = () => {
    switch (activeNav) { case 'dashboard': return <Dashboard />; case 'providers': return <ProvidersPage />; case 'proxy': return <ProxyPage />; case 'tools': return <ToolsPage />; case 'settings': return <SettingsPage />; }
  };

  return (
    <div className="flex flex-col h-screen" style={{ background: 'rgb(var(--background))', color: 'rgb(var(--foreground))' }}>
      {/* ── Header: single row — brand | tabs | actions ── */}
      <header className="flex-shrink-0 grid items-center px-8 min-h-[56px] border-b border-border/50" style={{ background: 'rgb(var(--card))', gridTemplateColumns: 'auto 1fr auto' }}>
        {/* Left: Brand */}
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            {service.running && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${service.running ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          </span>
          <span className="text-sm font-extrabold tracking-tight" style={{ color: 'rgb(var(--primary))' }}>cc-proxy</span>
          <span className="text-[11px] text-muted-foreground">{service.running ? `:${service.port}` : ''}</span>
        </div>

        {/* Center: Tabs + Right-side actions in same row */}
        <div className="flex items-center justify-between">
          <nav className="route-tabs justify-self-center mx-auto">
            {routeTabs.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setActiveNav(id)} className={cn('route-tab', activeNav === id && 'active')}><Icon /><span>{label}</span></button>
            ))}
          </nav>

          {/* Right: Service toggle + Theme */}
          <div className="flex items-center gap-2 ml-4">
            <button onClick={handleService} className={cn(
              'grid place-items-center w-8 h-8 rounded-xl border transition-all duration-150',
              service.running
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                : 'bg-muted text-muted-foreground border-border hover:text-foreground hover:border-primary/30'
            )} title={service.running ? '停止服务' : '启动服务'}>
              {service.running ? <StopIcon /> : <PlayIcon />}
            </button>
            <button onClick={handleTheme} className="grid place-items-center w-8 h-8 rounded-xl border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all duration-150" title={isDark ? '浅色模式' : '深色模式'}>
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 min-h-0 overflow-y-auto p-6">
        <div className="mx-auto page-enter" key={activeNav} style={{ maxWidth: activeNav === 'providers' ? '100%' : '100%' }}>
          {renderPage()}
        </div>
      </main>
    </div>
  );
}
