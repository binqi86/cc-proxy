import { useEffect, useState, useCallback, useRef } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { api } from '@/lib/api';
import { Switch } from '@/components/ui/switch';
import { getStoredTheme, toggleTheme } from '@/lib/theme';
import type { ProviderConfig, AppStats } from '@/lib/config';

const PROVIDER_ORDER = ['deepseek', 'dashscope', 'zhipu', 'moonshot', 'minimax', 'volcengine-coding'];

function sortedProviders(providers: Record<string, ProviderConfig>): [string, ProviderConfig][] {
  const entries = Object.entries(providers);
  entries.sort((a, b) => {
    const ia = PROVIDER_ORDER.indexOf(a[0]);
    const ib = PROVIDER_ORDER.indexOf(b[0]);
    if (ia === -1 && ib === -1) return a[0].localeCompare(b[0]);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return entries;
}

const DARK_CARD = 'rgba(22, 26, 34, 0.97)';
const LIGHT_CARD = 'rgba(255, 255, 255, 0.97)';
const DARK_BORDER = 'rgba(255,255,255,0.1)';
const LIGHT_BORDER = 'rgba(0,0,0,0.12)';
const DARK_DIVIDER = 'rgba(255,255,255,0.07)';
const LIGHT_DIVIDER = 'rgba(0,0,0,0.06)';

export default function TrayPopup() {
  const [stats, setStats] = useState<AppStats>({ running: false, pid: undefined, port: undefined, request_count: 0 });
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [activeProviderId, setActiveProviderId] = useState('');
  const [logUpstream, setLogUpstream] = useState(false);
  const [theme, setTheme] = useState(getStoredTheme());
  const [loading, setLoading] = useState(false);

  const isDark = theme === 'dark';
  const card = isDark ? DARK_CARD : LIGHT_CARD;
  const border = isDark ? DARK_BORDER : LIGHT_BORDER;
  const divider = isDark ? DARK_DIVIDER : LIGHT_DIVIDER;
  const mutedText = isDark ? 'text-slate-400' : 'text-slate-500';
  const textColor = isDark ? 'text-white' : 'text-slate-900';
  const hoverBg = isDark ? 'hover:bg-white/[0.05]' : 'hover:bg-black/[0.04]';
  const footerBg = isDark ? 'bg-white/[0.06]' : 'bg-black/[0.04]';
  const footerHover = isDark ? 'hover:bg-white/[0.12]' : 'hover:bg-black/[0.08]';

  // Only show providers with API keys
  const providerList = sortedProviders(providers);
  const configuredProviders = providerList.filter(([, p]) => p.apiKey && p.apiKey.trim().length > 0);

  // Auto-resize window based on content
  const resizeTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(async () => {
      try {
        const win = getCurrentWebviewWindow();
        // Base height: header + service + settings + footer ≈ 290
        // Each provider row ≈ 32, section title ≈ 30
        const providerCount = configuredProviders.length;
        const providerHeight = providerCount > 0 ? 30 + providerCount * 32 : 44; // or empty msg
        const targetHeight = Math.min(290 + providerHeight, 580);
        await win.setSize(new LogicalSize(340, targetHeight));
      } catch { /* ignore */ }
    }, 100);
  }, [configuredProviders.length]);

  const loadState = useCallback(async () => {
    try {
      const [s, p, env] = await Promise.all([
        api.service.getStats(),
        api.providers.read(),
        api.env.read(),
      ]);
      setStats(s);
      setProviders(p);
      setActiveProviderId(env.PROVIDER_PRESET || '');
      setLogUpstream(env.LOG_UPSTREAM_REQUEST === '1');
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadState();
    const interval = setInterval(async () => {
      try { const s = await api.service.getStats(); setStats(s); } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [loadState]);

  useEffect(() => {
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setStats((prev) => ({ ...prev, running: detail.running, pid: detail.pid, port: detail.port }));
    };
    document.addEventListener('sync-service-status', onSync);
    return () => document.removeEventListener('sync-service-status', onSync);
  }, []);

  useEffect(() => {
    const onProvidersChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setProviders(detail);
    };
    document.addEventListener('providers-changed', onProvidersChanged);
    return () => document.removeEventListener('providers-changed', onProvidersChanged);
  }, []);

  useEffect(() => {
    const onEnvChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        setActiveProviderId(detail.PROVIDER_PRESET || '');
        setLogUpstream(detail.LOG_UPSTREAM_REQUEST === '1');
      }
    };
    document.addEventListener('env-changed', onEnvChanged);
    return () => document.removeEventListener('env-changed', onEnvChanged);
  }, []);

  // Poll localStorage for theme changes from main window
  useEffect(() => {
    const check = () => {
      const t = getStoredTheme();
      setTheme((prev) => prev !== t ? t : prev);
    };
    const interval = setInterval(check, 1000);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', check);
    };
  }, []);

  const handleToggleService = async () => {
    if (loading) return;
    setLoading(true);
    try {
      if (stats.running && stats.pid) {
        await api.service.stop(stats.pid);
        setStats((prev) => ({ ...prev, running: false, pid: undefined, port: undefined }));
      } else {
        const env = await api.env.read();
        if (activeProviderId && env.PROVIDER_PRESET !== activeProviderId) {
          env.PROVIDER_PRESET = activeProviderId;
          const provider = providers[activeProviderId];
          if (provider?.apiKey) env.TARGET_API_KEY = provider.apiKey;
          await api.env.write(env);
        }
        const status = await api.service.start();
        setStats((prev) => ({ ...prev, running: true, pid: status.pid, port: status.port }));
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleToggleProvider = async (id: string) => {
    if (id === activeProviderId || loading) return;
    setLoading(true);
    try {
      const provider = providers[id];
      if (!provider) return;
      const env = await api.env.read();
      env.PROVIDER_PRESET = id;
      env.TARGET_API_KEY = provider.apiKey || env.TARGET_API_KEY || '';
      await api.env.write(env);
      setActiveProviderId(id);

      const { running, pid } = stats;
      if (running && pid) {
        try { await api.service.stop(pid); } catch { /* ignore */ }
        try {
          const status = await api.service.start();
          setStats((prev) => ({ ...prev, running: true, pid: status.pid, port: status.port }));
        } catch {
          setStats((prev) => ({ ...prev, running: false, pid: undefined, port: undefined }));
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleToggleLog = async () => {
    const next = !logUpstream;
    setLogUpstream(next);
    try {
      const env = await api.env.read();
      env.LOG_UPSTREAM_REQUEST = next ? '1' : '';
      await api.env.write(env);
    } catch { /* ignore */ }
  };

  const handleThemeToggle = () => {
    setTheme(toggleTheme());
  };

  const handleOpenMain = async () => {
    await api.window.showMain();
  };

  const handleQuit = async () => {
    await api.window.quit();
  };

  const handleResetCount = async () => {
    await api.window.resetCount();
    setStats((prev) => ({ ...prev, request_count: 0 }));
  };

  return (
    <div
        className="flex flex-col h-screen select-none rounded-2xl overflow-hidden"
        style={{
          background: card,
          border: `1px solid ${border}`,
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3.5 shrink-0"
          style={{ borderBottom: `1px solid ${divider}` }}
        >
          <span
            className={`relative inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              stats.running ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-400'
            }`}
          >
            {stats.running && (
              <span className="absolute inline-flex w-2.5 h-2.5 rounded-full bg-green-500 animate-ping opacity-75" />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <h1 className={`text-[14px] font-semibold leading-tight ${textColor}`}>
              Codex CN Proxy
            </h1>
            <p className={`text-[11px] leading-tight ${mutedText}`}>
              {stats.running ? (
                <>端口 {stats.port ?? '—'} · 请求 {stats.request_count} 次</>
              ) : (
                '已停止'
              )}
            </p>
          </div>
          {stats.request_count > 0 && (
            <button
              onClick={handleResetCount}
              className={`text-[10px] ${mutedText} hover:text-foreground transition-colors px-1.5 py-0.5 rounded`}
            >
              重置
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 custom-scrollbar">
          {/* 服务开关 */}
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-[13px] font-medium ${textColor}`}>服务开关</p>
              <p className={`text-[11px] ${mutedText}`}>
                {stats.running ? '运行中' : '点击启动代理服务'}
              </p>
            </div>
            <Switch checked={stats.running} onChange={handleToggleService} disabled={loading} />
          </div>

          {/* 供应商 */}
          <div className="pt-3" style={{ borderTop: `1px solid ${divider}` }}>
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${mutedText}`}>
              供应商
            </span>
          </div>
          <div className="space-y-0.5 -mt-2">
            {configuredProviders.length === 0 ? (
              <p className={`text-[12px] ${mutedText} py-3 px-2 text-center`}>
                暂无已配置的供应商，
                <button
                  onClick={handleOpenMain}
                  className="underline hover:text-foreground transition-colors"
                >
                  前往主界面
                </button>
                添加 API 密钥
              </p>
            ) : (
              configuredProviders.map(([id, p]) => (
                <div
                  key={id}
                  className={`flex items-center justify-between py-1.5 px-2 rounded-lg ${hoverBg} transition-colors`}
                >
                  <span className={`text-[12px] truncate flex-1 mr-2 ${textColor}`}>
                    {p.name || id}
                  </span>
                  <Switch
                    checked={id === activeProviderId}
                    onChange={() => handleToggleProvider(id)}
                    disabled={id === activeProviderId || loading}
                    small
                  />
                </div>
              ))
            )}
          </div>

          {/* 设置 */}
          <div className="pt-3" style={{ borderTop: `1px solid ${divider}` }}>
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${mutedText}`}>
              设置
            </span>
          </div>
          <div className="space-y-0.5 -mt-2">
            <div className={`flex items-center justify-between py-1.5 px-2 rounded-lg ${hoverBg} transition-colors`}>
              <span className={`text-[12px] ${textColor}`}>记录上游请求详情</span>
              <Switch checked={logUpstream} onChange={handleToggleLog} small />
            </div>
            <div className={`flex items-center justify-between py-1.5 px-2 rounded-lg ${hoverBg} transition-colors`}>
              <span className={`text-[12px] ${textColor}`}>深色模式</span>
              <Switch checked={isDark} onChange={handleThemeToggle} small />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-2 px-4 py-3 shrink-0"
          style={{ borderTop: `1px solid ${divider}` }}
        >
          <button
            onClick={handleOpenMain}
            className={`flex-1 py-2 text-[12px] font-medium rounded-xl transition-colors text-center ${footerBg} ${textColor} ${footerHover}`}
          >
            打开主界面
          </button>
          <button
            onClick={handleQuit}
            className={`py-2 px-4 text-[12px] rounded-xl transition-colors ${mutedText} ${hoverBg}`}
          >
            退出
          </button>
        </div>
      </div>
  );
}
