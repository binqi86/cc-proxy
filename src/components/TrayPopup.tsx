import { useEffect, useState, useCallback, useRef } from 'react';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getStoredTheme, toggleTheme, applyTheme } from '@/lib/theme';
import { ClaudeIcon, CodexIcon } from '@/components/BrandIcons';
import ProviderIcon from '@/components/ProviderIcon';
import type { ProviderConfig, AppStats } from '@/lib/config';

const PROVIDER_ORDER = ['deepseek', 'dashscope', 'zhipu', 'moonshot', 'minimax', 'volcengine-coding'];
const POPUP_MIN_HEIGHT = 120;
const POPUP_MAX_HEIGHT = 800;

const PlayIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 3"/></svg>);
const StopIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>);
const MoonIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>);
const SunIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2"/></svg>);

function sortedProviders(providers: Record<string, ProviderConfig>): [string, ProviderConfig][] {
  const entries = Object.entries(providers);
  entries.sort((a, b) => { const ia = PROVIDER_ORDER.indexOf(a[0]), ib = PROVIDER_ORDER.indexOf(b[0]); if (ia === -1 && ib === -1) return a[0].localeCompare(b[0]); if (ia === -1) return 1; if (ib === -1) return -1; return ia - ib; });
  return entries;
}

export default function TrayPopup() {
  const store = useAppStore;
  const [stats, setStats] = useState<AppStats>({ running: false, pid: undefined, port: undefined, request_count: 0 });
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  // Local provider IDs — synced from backend, the single source of truth
  const [codexId, setCodexId] = useState('');
  const [claudeId, setClaudeId] = useState('');
  const [theme, setTheme] = useState(getStoredTheme());
  const [loading, setLoading] = useState(false);
  const [bodyScrollable, setBodyScrollable] = useState(false);
  const [ready, setReady] = useState(false);
  const switching = useRef(false);

  const isDark = theme === 'dark';
  const providerList = sortedProviders(providers);
  const configuredProviders = providerList.filter(([, p]) => p.apiKey && p.apiKey.trim().length > 0);
  const cardRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  const resizePopup = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const card = cardRef.current;
        const header = headerRef.current;
        const body = bodyRef.current;
        const footer = footerRef.current;
        if (!card || !header || !body || !footer) return;
        if (!ready) return;

        const measuredParts = header.offsetHeight + body.clientHeight + footer.offsetHeight;
        const chromeHeight = card.offsetHeight - measuredParts;
        const contentHeight = header.offsetHeight + body.scrollHeight + footer.offsetHeight + Math.max(chromeHeight, 0);

        if (contentHeight > 0) {
          const natural = Math.ceil(contentHeight);
          const target = Math.min(Math.max(natural, POPUP_MIN_HEIGHT), POPUP_MAX_HEIGHT);
          const shouldScroll = natural > POPUP_MAX_HEIGHT;
          setBodyScrollable(prev => (prev === shouldScroll ? prev : shouldScroll));
          api.window.resizePopup(target).catch(() => {});
        }
      });
    });
  }, [ready]);

  useEffect(() => { resizePopup(); }, [resizePopup, configuredProviders.length, codexId, claudeId, providers, ready]);
  useEffect(() => {
    const handleVisibleResize = () => resizePopup();
    window.addEventListener('focus', handleVisibleResize);
    window.addEventListener('resize', handleVisibleResize);
    document.addEventListener('visibilitychange', handleVisibleResize);
    const timer = window.setTimeout(handleVisibleResize, 120);
    return () => {
      window.removeEventListener('focus', handleVisibleResize);
      window.removeEventListener('resize', handleVisibleResize);
      document.removeEventListener('visibilitychange', handleVisibleResize);
      window.clearTimeout(timer);
    };
  }, [resizePopup]);
  useEffect(() => {
    if (!cardRef.current || !bodyRef.current) return;
    const observer = new ResizeObserver(() => resizePopup());
    observer.observe(cardRef.current);
    observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, [configuredProviders.length, codexId, claudeId, providers]);

  // ── Read current state from backend ──
  const readEnvAndSync = useCallback(async () => {
    try {
      const env = await api.env.read();
      const m = env as Record<string, string>;
      setCodexId(m.CODEX_PROVIDER_PRESET || m.PROVIDER_PRESET || '');
      setClaudeId(m.CLAUDE_PROVIDER_PRESET || '');
    } catch { /* */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [s, p] = await Promise.all([api.service.getStats(), api.providers.read()]);
        setStats(s); setProviders(p);
      } catch { /* */ }
      await readEnvAndSync();
      setReady(true);
    })();
  }, [readEnvAndSync]);

  useEffect(() => {
    const i = setInterval(async () => { try { setStats(await api.service.getStats()); } catch { /* */ } }, 3000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const s = (e: Event) => { const d = (e as CustomEvent).detail; if (d) setStats(p => ({ ...p, running: d.running, pid: d.pid, port: d.port })); };
    document.addEventListener('sync-service-status', s); return () => document.removeEventListener('sync-service-status', s);
  }, []);
  useEffect(() => {
    const s = (e: Event) => { const d = (e as CustomEvent).detail; if (d) setProviders(d); };
    document.addEventListener('providers-changed', s); return () => document.removeEventListener('providers-changed', s);
  }, []);
  useEffect(() => {
    const s = () => {
      if (switching.current) return; // skip self-triggered events
      readEnvAndSync();
    };
    document.addEventListener('env-changed', s);
    return () => document.removeEventListener('env-changed', s);
  }, [readEnvAndSync]);

  useEffect(() => {
    const check = () => { const t = getStoredTheme(); setTheme(p => p !== t ? t : p); applyTheme(t); };
    const i = setInterval(check, 1000); window.addEventListener('focus', check);
    return () => { clearInterval(i); window.removeEventListener('focus', check); };
  }, []);

  const handleToggleService = async () => {
    if (loading) return; setLoading(true);
    try {
      if (stats.running && stats.pid) { await api.service.stop(stats.pid); setStats(p => ({ ...p, running: false, pid: undefined })); }
      else { const s = await api.service.start(); setStats(p => ({ ...p, running: true, pid: s.pid, port: s.port })); }
    } catch { /* */ } setLoading(false);
  };

  const handleSwitch = async (id: string, mode: 'codex' | 'claude') => {
    const currentId = mode === 'codex' ? codexId : claudeId;
    if (id === currentId || loading) return;
    const provider = providers[id];
    if (!provider) return;
    setLoading(true);
    switching.current = true;

    try {
      const apiKey = mode === 'codex'
        ? (provider.codexApiKey || provider.apiKey || '')
        : (provider.claudeApiKey || provider.apiKey || '');

      const env = await api.env.read();
      const m = env as Record<string, string>;
      m[`${mode.toUpperCase()}_PROVIDER_PRESET`] = id;
      m[`${mode.toUpperCase()}_TARGET_API_KEY`] = apiKey;
      if (mode === 'codex') {
        m.PROVIDER_PRESET = id;
        m.TARGET_API_KEY = apiKey;
      }

      await api.env.write(m);

      if (mode === 'codex') setCodexId(id);
      else setClaudeId(id);

      if (stats.running && stats.pid) {
        try { await api.service.stop(stats.pid); } catch { /* */ }
        try { const s = await api.service.start(); setStats(p => ({ ...p, running: true, pid: s.pid, port: s.port })); } catch { setStats(p => ({ ...p, running: false })); }
      }
    } catch { /* */ }
    setLoading(false);
    switching.current = false;
  };

  const handleTheme = () => setTheme(toggleTheme());
  const handleOpen = async () => { await api.window.showMain(); };
  const handleQuit = async () => { await api.window.quit(); };

  return (
    <div className="h-full w-full flex flex-col select-none">
      <div
        ref={cardRef}
        className="flex min-h-0 flex-col rounded-2xl overflow-hidden"
        style={{
          background: `rgb(var(--card))`,
          border: `1px solid rgb(var(--border) / 0.6)`,
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
          maxHeight: `${POPUP_MAX_HEIGHT}px`,
          visibility: ready ? 'visible' : 'hidden',
        }}
      >
      {/* Header */}
      <div ref={headerRef} className="flex items-center gap-3 px-4 py-2 shrink-0 border-b border-border/30">
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          {stats.running && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${stats.running ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="text-[14px] font-extrabold leading-tight" style={{ color: 'rgb(var(--primary))' }}>cc-proxy</h1>
          <p className="text-[11px] text-muted-foreground leading-tight">{stats.running ? <>端口 {stats.port ?? '—'} · {stats.request_count} 次</> : '已停止'}</p>
        </div>
        <button onClick={handleToggleService} className={cn(
          'grid place-items-center w-7 h-7 rounded-lg border transition-all duration-150',
          stats.running ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20' : 'bg-muted text-muted-foreground border-border hover:text-foreground'
        )}>{stats.running ? <StopIcon /> : <PlayIcon />}</button>
        <button onClick={handleTheme} className="grid place-items-center w-7 h-7 rounded-lg border border-border bg-muted text-muted-foreground hover:text-foreground transition-all duration-150">
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>

      {/* Body */}
      <div
        ref={bodyRef}
        className={cn('px-4 py-2 space-y-2', bodyScrollable ? 'overflow-y-auto overflow-x-hidden' : 'overflow-visible')}
        style={bodyScrollable ? { maxHeight: `${POPUP_MAX_HEIGHT - 120}px` } : undefined}
      >
        {configuredProviders.length > 0 && (
          <>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">供应商</span>
            <div className="space-y-0.5">
              {configuredProviders.map(([id, p]) => {
                const isCodex = id === codexId;
                const isClaude = id === claudeId;
                return (
                  <div key={id} className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-muted/30 transition-colors">
                    <ProviderIcon id={id} name={p.name} size="sm" />
                    <span className={cn('text-[12px] truncate flex-1', (isCodex || isClaude) && 'font-bold')}>{p.name || id}</span>
                    <button onClick={() => handleSwitch(id, 'codex')} disabled={isCodex || loading}
                      className={cn('p-0.5 rounded transition-all duration-150', isCodex ? 'cursor-default' : 'cursor-pointer')}
                      title={isCodex ? 'Codex 当前' : '设为 Codex'}>
                      <CodexIcon size={14} dimmed={!isCodex} />
                    </button>
                    <button onClick={() => handleSwitch(id, 'claude')} disabled={isClaude || loading}
                      className={cn('p-0.5 rounded transition-all duration-150', isClaude ? 'cursor-default' : 'cursor-pointer')}
                      title={isClaude ? 'Claude 当前' : '设为 Claude'}>
                      <ClaudeIcon size={14} dimmed={!isClaude} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {configuredProviders.length === 0 && (
          <p className="text-[12px] text-muted-foreground py-2 text-center">暂无已配置的供应商</p>
        )}
      </div>

      {/* Footer */}
      <div ref={footerRef} className="flex items-center gap-2 px-4 py-2 shrink-0 border-t border-border/20">
        <button onClick={handleOpen} className="flex-1 py-2 text-[12px] font-semibold rounded-xl text-center bg-muted hover:bg-muted/70 transition-colors">打开主界面</button>
        <button onClick={handleQuit} className="py-2 px-4 text-[12px] rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors">退出</button>
      </div>
    </div>
    </div>
  );
}
