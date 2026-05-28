import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { getStoredTheme, toggleTheme, applyTheme } from '@/lib/theme';
import { sortProviders } from '@/lib/providers';
import { getClaudeModels } from '@/store/appStore';
import { ClaudeIcon, CodexIcon } from '@/components/BrandIcons';
import ProviderIcon from '@/components/ProviderIcon';
import { Toggle } from '@/components/shared';
import { PlayIcon, StopIcon, MoonIcon, SunIcon, OpenIcon, QuitIcon } from '@/lib/icons';
import type { ProviderConfig, AppStats } from '@/lib/config';

const POPUP_MIN_HEIGHT = 120;
const POPUP_MAX_HEIGHT = 800;

export default function TrayPopup() {
  const [stats, setStats] = useState<AppStats>({ running: false, pid: undefined, port: undefined, request_count: 0 });
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [codexId, setCodexId] = useState('');
  const [claudeId, setClaudeId] = useState('');
  const [codexStatus, setCodexStatus] = useState<{ applied: boolean; config_file_exists: boolean } | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<{ applied: boolean; config_file_exists: boolean; claude_app_exists: boolean } | null>(null);
  const [localizationStatus, setLocalizationStatus] = useState<{ is_patched: boolean; has_backup: boolean; is_claude_running: boolean } | null>(null);
  const [theme, setTheme] = useState(getStoredTheme());
  const [loading, setLoading] = useState(false);
  const [localizing, setLocalizing] = useState(false);
  const [bodyScrollable, setBodyScrollable] = useState(false);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const switching = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDark = theme === 'dark';
  const providerList = sortProviders(providers);
  const configuredProviders = providerList.filter(([, p]) => p.apiKey && p.apiKey.trim().length > 0);
  const codexProvider = codexId ? providers[codexId] : null;
  const claudeProvider = claudeId ? providers[claudeId] : null;
  const cardRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);

  // Toast auto-dismiss
  useEffect(() => {
    if (toast) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 4000);
      return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
    }
  }, [toast]);

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

  const readEnvAndSync = useCallback(async () => {
    try {
      const env = await api.env.read();
      const m = env as Record<string, string>;
      setCodexId(m.CODEX_PROVIDER_PRESET || m.PROVIDER_PRESET || '');
      setClaudeId(m.CLAUDE_PROVIDER_PRESET || '');
    } catch { /* */ }
  }, []);

  const loadAllStatus = useCallback(async () => {
    try {
      const [cs, cc, ls] = await Promise.all([
        api.claude.getConfigStatus(),
        api.codex.getConfigStatus(),
        api.localization.getStatus(),
      ]);
      setClaudeStatus(cs);
      setCodexStatus(cc);
      setLocalizationStatus(ls);
    } catch { /* */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [s, p] = await Promise.all([api.service.getStats(), api.providers.read()]);
        setStats(s); setProviders(p);
      } catch { /* */ }
      await readEnvAndSync();
      await loadAllStatus();
      setReady(true);
    })();
  }, [readEnvAndSync, loadAllStatus]);

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
      if (switching.current) return;
      readEnvAndSync();
    };
    document.addEventListener('env-changed', s);
    return () => document.removeEventListener('env-changed', s);
  }, [readEnvAndSync]);
  // Sync localization status when changed from main window
  useEffect(() => {
    const s = () => loadAllStatus();
    document.addEventListener('localization-changed', s);
    document.addEventListener('desktop-config-changed', s);
    return () => {
      document.removeEventListener('localization-changed', s);
      document.removeEventListener('desktop-config-changed', s);
    };
  }, [loadAllStatus]);

  useEffect(() => {
    const check = () => { const t = getStoredTheme(); setTheme(p => p !== t ? t : p); applyTheme(t); };
    const i = setInterval(check, 1000); window.addEventListener('focus', check);
    return () => { clearInterval(i); window.removeEventListener('focus', check); };
  }, []);

  // ── helpers ──
  const getEnvConfig = async () => {
    const env = await api.env.read();
    const m = env as Record<string, string>;
    const port = parseInt(m.PORT || '8088', 10);
    const apiKey = (m.PROXY_API_KEY || '').trim();
    if (!apiKey) throw new Error('未配置代理 API Key');
    return { port, apiKey };
  };

  // ── Service ──
  const handleToggleService = async () => {
    if (loading) return; setLoading(true);
    try {
      if (stats.running && stats.pid) { await api.service.stop(stats.pid); setStats(p => ({ ...p, running: false, pid: undefined })); }
      else { const s = await api.service.start(); setStats(p => ({ ...p, running: true, pid: s.pid, port: s.port })); }
      setTimeout(() => loadAllStatus(), 500);
    } catch { /* */ } setLoading(false);
  };

  // ── Switch provider ──
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
        setTimeout(() => loadAllStatus(), 500);
      }
    } catch { /* */ }
    setLoading(false);
    switching.current = false;
  };

  // ── Desktop integration toggles ──
  const handleCodexToggle = async () => {
    if (loading || !codexId) return;
    setLoading(true);
    try {
      const { port, apiKey } = await getEnvConfig();
      const provider = providers[codexId];
      const defaultModel = (provider?.defaultModel || '').replace(/-1m$/i, '');
      if (codexStatus?.applied) {
        await api.codex.removeConfig();
      } else {
        await api.codex.applyConfig(port, apiKey, defaultModel);
      }
      await loadAllStatus();
    } catch (e) { setToast(String(e)); }
    setLoading(false);
  };

  const handleClaudeToggle = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { port, apiKey } = await getEnvConfig();
      if (claudeStatus?.applied) {
        await api.claude.remove3pConfig();
      } else {
        const models = getClaudeModels(providers, claudeId);
        await api.claude.apply3pConfig(port, apiKey, models);
      }
      await loadAllStatus();
      // Claude Desktop needs restart after config change
      if (!claudeStatus?.applied && claudeStatus?.claude_app_exists) {
        try { await api.claude.restartDesktop(); setToast('Claude Desktop 已重启'); } catch { setToast('请手动重启 Claude Desktop 使配置生效'); }
      }
    } catch (e) { setToast(String(e)); }
    setLoading(false);
  };

  const handleLocalizationToggle = async () => {
    if (loading || localizing) return;
    setLocalizing(true);
    try {
      if (localizationStatus?.is_patched) {
        if (localizationStatus?.is_claude_running) {
          setToast('请先退出 Claude Desktop 再恢复汉化');
          setLocalizing(false);
          return;
        }
        await api.localization.restore();
      } else {
        if (localizationStatus?.is_claude_running) {
          setToast('请先退出 Claude Desktop 再应用汉化');
          setLocalizing(false);
          return;
        }
        await api.localization.applyBundled();
      }
      await loadAllStatus();
    } catch (e) { setToast(String(e)); }
    setLocalizing(false);
  };

  const handleTheme = () => setTheme(toggleTheme());
  const handleOpen = async () => { await api.window.showMain(); };
  const handleQuit = async () => { await api.window.quit(); };

  return (
    <div className="h-full w-full flex flex-col select-none">
      {/* Toast */}
      {toast && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-destructive/90 text-white shadow-lg animate-in slide-in-from-top-2">
          {toast}
        </div>
      )}
      <div
        ref={cardRef}
        className="flex min-h-0 flex-col rounded-2xl overflow-hidden"
        style={{
          background: isDark
            ? 'linear-gradient(180deg, rgba(24,24,27,0.92) 0%, rgba(15,15,18,0.94) 100%)'
            : 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(248,248,250,0.94) 100%)',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
          boxShadow: isDark
            ? '0 25px 60px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.05) inset'
            : '0 25px 60px rgba(0,0,0,0.12), 0 0 0 0.5px rgba(255,255,255,0.8) inset',
          backdropFilter: 'blur(40px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.4)',
          maxHeight: `${POPUP_MAX_HEIGHT}px`,
          visibility: ready ? 'visible' : 'hidden',
        }}
      >
      {/* ── Header ── */}
      <div ref={headerRef} className="flex items-center gap-2.5 px-3.5 py-2 shrink-0 border-b border-white/5">
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          {stats.running && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${stats.running ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-slate-500'}`} />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="text-[13px] font-extrabold leading-tight tracking-tight" style={{ color: isDark ? '#a78bfa' : '#7c3aed' }}>cc-proxy</h1>
          <p className="text-[10px] text-muted-foreground leading-tight">{stats.running ? <>:{stats.port ?? '—'} · {stats.request_count} req</> : '已停止'}</p>
        </div>
        <button onClick={handleToggleService} className={cn(
          'grid place-items-center w-7 h-7 rounded-lg border transition-all duration-200',
          stats.running
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20 active:scale-90'
            : 'bg-white/5 text-muted-foreground border-white/5 hover:text-foreground hover:border-white/10 active:scale-90'
        )}>{stats.running ? <StopIcon /> : <PlayIcon />}</button>
        <button onClick={handleTheme} className="grid place-items-center w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] transition-colors active:scale-90">
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>

      {/* ── Body ── */}
      <div
        ref={bodyRef}
        className={cn('px-3.5 py-2 space-y-3', bodyScrollable ? 'overflow-y-auto overflow-x-hidden' : 'overflow-visible')}
        style={bodyScrollable ? { maxHeight: `${POPUP_MAX_HEIGHT - 160}px` } : undefined}
      >
        {/* Desktop Integration */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">桌面集成</span>

          {/* Codex */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.04]">
            <CodexIcon size={15} />
            <span className="text-[11px] font-semibold flex-1">{codexProvider?.name || '未选择'}</span>
            {codexStatus && (
              <span className={cn('text-[10px] font-bold', codexStatus.applied ? 'text-emerald-400' : 'text-muted-foreground')}>
                {codexStatus.applied ? '已配置' : '未配置'}
              </span>
            )}
            <button onClick={handleCodexToggle} disabled={loading || !codexId}
              className={cn(
                'relative inline-flex h-5 w-8 items-center rounded-full transition-colors flex-shrink-0 disabled:opacity-30',
                codexStatus?.applied ? 'bg-emerald-500' : 'bg-slate-400/30 dark:bg-white/10'
              )}
            >
              <span className={cn(
                'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                codexStatus?.applied ? 'translate-x-3.5' : 'translate-x-0.5'
              )} />
            </button>
          </div>

          {/* Claude */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.04]">
            <ClaudeIcon size={15} />
            <span className="text-[11px] font-semibold flex-1">{claudeProvider?.name || '未选择'}</span>
            {claudeStatus && (
              <span className={cn('text-[10px] font-bold', claudeStatus.applied ? 'text-emerald-400' : 'text-muted-foreground')}>
                {claudeStatus.applied ? '已配置' : '未配置'}
              </span>
            )}
            <button onClick={handleClaudeToggle} disabled={loading}
              className={cn(
                'relative inline-flex h-5 w-8 items-center rounded-full transition-colors flex-shrink-0 disabled:opacity-30',
                claudeStatus?.applied ? 'bg-emerald-500' : 'bg-slate-400/30 dark:bg-white/10'
              )}
            >
              <span className={cn(
                'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                claudeStatus?.applied ? 'translate-x-3.5' : 'translate-x-0.5'
              )} />
            </button>
          </div>

          {/* Chinese Localization */}
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.04]">
            <ClaudeIcon size={15} />
            <span className="text-[11px] font-semibold flex-1">一键汉化</span>
            {localizationStatus && (
              <span className={cn('text-[10px] font-bold',
                localizing ? 'text-emerald-400' : localizationStatus.is_patched ? 'text-emerald-400' : 'text-muted-foreground'
              )}>
                {localizing ? '处理中...' : localizationStatus.is_patched ? '已汉化' : '未汉化'}
              </span>
            )}
            {!localizationStatus && (
              <span className="text-[10px] text-muted-foreground">检测中...</span>
            )}
            <button onClick={handleLocalizationToggle} disabled={loading}
              className={cn(
                'relative inline-flex h-5 w-8 items-center rounded-full transition-colors flex-shrink-0 disabled:opacity-30',
                localizationStatus?.is_patched ? 'bg-emerald-500' : 'bg-slate-400/30 dark:bg-white/10'
              )}
            >
              <span className={cn(
                'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                localizationStatus?.is_patched ? 'translate-x-3.5' : 'translate-x-0.5'
              )} />
            </button>
          </div>
        </div>

        {/* Provider Selection */}
        {configuredProviders.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">供应商</span>
            <div className="space-y-0.5">
              {configuredProviders.map(([id, p]) => {
                const isCodex = id === codexId;
                const isClaude = id === claudeId;
                return (
                  <div key={id} className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-white/[0.04] transition-colors">
                    <ProviderIcon id={id} name={p.name} size="sm" />
                    <span className={cn('text-[11px] truncate flex-1', (isCodex || isClaude) && 'font-bold')}>{p.name || id}</span>
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
          </div>
        )}
        {configuredProviders.length === 0 && (
          <p className="text-[11px] text-muted-foreground py-2 text-center">暂无已配置的供应商</p>
        )}
      </div>

      {/* ── Footer ── */}
      <div ref={footerRef} className="flex items-center gap-2 px-3.5 py-2 shrink-0 border-t border-white/5">
        <button onClick={handleOpen} className="flex items-center justify-center gap-1.5 flex-1 py-1.5 text-[11px] font-semibold rounded-xl bg-white/[0.04] hover:bg-white/[0.08] transition-colors active:scale-[0.98]">
          <OpenIcon /> 打开主界面
        </button>
        <button onClick={handleQuit} className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors active:scale-[0.98]">
          <QuitIcon /> 退出
        </button>
      </div>
    </div>
    </div>
  );
}
