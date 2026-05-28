import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getStoredTheme, toggleTheme, applyTheme } from '@/lib/theme';
import { SpeedIcon, PlugIcon, BroadcastIcon, ToolsIcon, GearIcon, MoonIcon, SunIcon, PlayIcon, StopIcon } from '@/lib/icons';
import { StatusDot } from '@/components/shared';
import type { ServiceStatus, NavItem } from '@/lib/config';
import Dashboard from '@/components/Dashboard';
import ProvidersPage from '@/components/ProvidersPage';
import ProxyPage from '@/components/ProxyPage';
import ToolsPage from '@/components/ToolsPage';
import SettingsPage from '@/components/SettingsPage';

const routeTabs: { id: NavItem; label: string; Icon: React.FC }[] = [
  { id: 'dashboard', label: '仪表盘', Icon: SpeedIcon },
  { id: 'providers', label: '供应商', Icon: PlugIcon },
  { id: 'proxy', label: '代理', Icon: BroadcastIcon },
  { id: 'tools', label: '工具', Icon: ToolsIcon },
  { id: 'settings', label: '设置', Icon: GearIcon },
];

export default function App() {
  const { service, activeNav, loadConfig, setActiveNav, setServiceStatus, startService, stopService } = useAppStore();
  const [theme, setTheme] = useState(getStoredTheme());
  const isDark = theme === 'dark';

  useEffect(() => {
    loadConfig();

    const u1 = listen<ServiceStatus>('service-status-changed', (e) => setServiceStatus(e.payload));
    const themeI = setInterval(() => { const t = getStoredTheme(); setTheme(t); applyTheme(t); }, 1000);

    // Poll proxy logs
    const pollI = setInterval(async () => {
      try {
        const lines = await api.service.pollLogs();
        if (!lines.length) return;
        const store = useAppStore.getState();
        for (const line of lines) {
          if (isNoiseLine(line)) continue;
          store.addLog(parseLine(line));
        }
      } catch { /* */ }
    }, 500);

    // Poll env for provider changes from popup
    const pollEnvI = setInterval(async () => {
      try {
        const env = await api.env.read();
        const m = env as Record<string, string>;
        const store = useAppStore.getState();
        const cId = m.CODEX_PROVIDER_PRESET || m.PROVIDER_PRESET || '';
        const lId = m.CLAUDE_PROVIDER_PRESET || '';
        if (cId !== store.codexProviderId || lId !== store.claudeProviderId) {
          store.syncProviderIds(cId, lId);
        }
      } catch { /* */ }
    }, 2000);

    const onSync = (e: Event) => { const d = (e as CustomEvent).detail; if (d) setServiceStatus(d); };
    document.addEventListener('sync-service-status', onSync);

    return () => {
      clearInterval(pollI); clearInterval(themeI); clearInterval(pollEnvI);
      u1.then(fn => fn?.());
      document.removeEventListener('sync-service-status', onSync);
    };
  }, []);

  const handleTheme = () => setTheme(toggleTheme());
  const handleService = () => service.running ? stopService() : startService();

  const renderPage = () => {
    switch (activeNav) {
      case 'dashboard': return <Dashboard />;
      case 'providers': return <ProvidersPage />;
      case 'proxy': return <ProxyPage />;
      case 'tools': return <ToolsPage />;
      case 'settings': return <SettingsPage />;
    }
  };

  return (
    <div className="flex flex-col h-screen" style={{ background: 'rgb(var(--background))', color: 'rgb(var(--foreground))' }}>
      {/* Header */}
      <header className="flex-shrink-0 grid items-center px-8 min-h-[56px] border-b border-border/50" style={{ background: 'rgb(var(--card))', gridTemplateColumns: 'auto 1fr auto' }}>
        <div className="flex items-center gap-2.5">
          <StatusDot active={service.running} />
          <span className="text-sm font-extrabold tracking-tight" style={{ color: 'rgb(var(--primary))' }}>cc-proxy</span>
          <span className="text-[11px] text-muted-foreground">{service.running ? `:${service.port}` : ''}</span>
        </div>

        <div className="flex items-center justify-between">
          <nav className="route-tabs justify-self-center mx-auto">
            {routeTabs.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setActiveNav(id)} className={cn('route-tab', activeNav === id && 'active')}>
                <Icon /><span>{label}</span>
              </button>
            ))}
          </nav>

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

      {/* Main */}
      <main className="flex-1 min-h-0 overflow-y-auto p-6">
        <div className="mx-auto page-enter" key={activeNav} style={{ maxWidth: '100%' }}>
          {renderPage()}
        </div>
      </main>
    </div>
  );
}

// ── Log parsing helpers ──

function isNoiseLine(line: string): boolean {
  if (!line.trim()) return true;
  if (/^---\s*$/.test(line)) return true;
  if (/^(Wall time|Process exited|Original token count|Output):/i.test(line)) return true;
  if (/^\d+\.\d+\.\d+/.test(line.trim()) && line.trim().length < 20) return true;
  if (/^(\d{2}:\d{2}:\d{2}\s+)?\w+\s+\[\d+\s*(msgs|tools)/.test(line) && !/转发请求|请求:|响应:|模型映射:|proxy/i.test(line)) return true;
  if (/\|\s*(user|assistant|system):/.test(line) && !/转发请求|请求:|响应:|模型映射:|proxy/i.test(line)) return true;
  if (/<system-reminder>/.test(line)) return true;
  if (/config\.toml/.test(line)) return true;
  if (line.includes('"type":"text"') && line.includes('"text":"')) return true;
  return false;
}

function parseLine(line: string) {
  const id = `plog-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date();

  // Format: "HH:MM:SS LEVEL message"
  const m = line.match(/^(\d{2}:\d{2}:\d{2}) (\w+) (.+)/);
  if (m) {
    const msg = m[3];
    const rawLevel = m[2].toLowerCase();
    const level = rawLevel === 'error' ? 'error'
      : rawLevel === 'warn' ? 'warning'
      : rawLevel === 'success' ? 'success'
      : msg.startsWith('✗') ? 'error'
      : msg.startsWith('← 4') || msg.startsWith('← 5') ? 'error'
      : msg.startsWith('← 2') ? 'success'
      : 'info';

    const sourceMatch = msg.match(/^\[(CODEX|CLAUDE|SYSTEM)\]\s*/);
    const source = sourceMatch ? (sourceMatch[1].toLowerCase() as 'codex' | 'claude' | 'system') : undefined;
    let cleaned = msg.replace(/^\[(CODEX|CLAUDE|SYSTEM)\]\s*/, '');
    cleaned = sanitizeMessage(cleaned);
    if (cleaned.length > 300) cleaned = cleaned.slice(0, 300) + '...';

    let latency: number | undefined;
    const lm = cleaned.match(/\|\s*(\d+)ms/);
    if (lm) latency = parseInt(lm[1], 10);

    return { id, timestamp, level, source, message: cleaned, latency } as const;
  }

  // Fallback: old [PROXY_LOG] format
  if (line.startsWith('[PROXY_LOG]')) {
    const msg = line.slice(12);
    const level = msg.startsWith('✗') ? 'error' : msg.startsWith('← 4') || msg.startsWith('← 5') ? 'error' : msg.startsWith('← 2') ? 'success' : 'info';
    let latency: number | undefined;
    const lm = msg.match(/\|\s*(\d+)ms/);
    if (lm) latency = parseInt(lm[1], 10);
    return { id, timestamp, level, message: msg, latency } as const;
  }

  return { id, timestamp, level: 'info' as const, source: 'system' as const, message: line };
}

function sanitizeMessage(msg: string): string {
  const streamIdx = msg.indexOf(' stream');
  if (streamIdx !== -1 && msg.startsWith('转发请求 →')) {
    const end = streamIdx + ' stream'.length;
    if (msg.length > end + 1) return msg.slice(0, end);
  }
  const noiseIdx = msg.search(/\[\d+\s*(msgs|tools)/);
  if (noiseIdx > 0) return msg.slice(0, noiseIdx).trimEnd();
  return msg;
}
