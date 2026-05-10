import { useEffect, useState } from 'react';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import ProviderIcon from '@/components/ProviderIcon';
import type { AppStats } from '@/lib/config';

const PROVIDER_ORDER = ['deepseek', 'dashscope', 'zhipu', 'moonshot', 'minimax', 'volcengine-coding'];

/* ── Icons ── */
const ServerIcon = () => (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/></svg>);
const ZapIcon = () => (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>);
const ClockIcon = () => (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>);

export default function Dashboard() {
  const { service, providers, env, logs, setActiveNav } = useAppStore();
  const [stats, setStats] = useState<AppStats>({ running: false, request_count: 0 });
  const [speedResults, setSpeedResults] = useState<Record<string, { ok: boolean; latency: number; msg: string } | null>>({});
  const [balanceResults, setBalanceResults] = useState<Record<string, string | null>>({});
  const activeProviderId = (env as Record<string, string>).PROVIDER_PRESET || '';
  const activeProvider = providers[activeProviderId];

  useEffect(() => {
    const load = async () => { try { setStats(await api.service.getStats()); } catch { /* */ } };
    load(); const i = setInterval(load, 3000); return () => clearInterval(i);
  }, []);

  const sorted = Object.entries(providers).sort((a, b) => {
    const ia = PROVIDER_ORDER.indexOf(a[0]), ib = PROVIDER_ORDER.indexOf(b[0]);
    if (ia === -1 && ib === -1) return a[0].localeCompare(b[0]);
    if (ia === -1) return 1; if (ib === -1) return -1;
    return ia - ib;
  });
  const configured = sorted.filter(([, p]) => p.apiKey?.trim());
  const unconfigured = sorted.filter(([, p]) => !p.apiKey?.trim());

  const avgLatency = logs.filter(l => l.latency).length
    ? Math.round(logs.filter(l => l.latency).reduce((s, l) => s + (l.latency || 0), 0) / logs.filter(l => l.latency).length)
    : null;

  /* ── Speed test ── */
  const handleSpeedTest = async (id: string, baseUrl: string) => {
    setSpeedResults(p => ({ ...p, [id]: null }));
    const start = Date.now();
    try {
      const resp = await fetch(baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      const lat = Date.now() - start;
      setSpeedResults(p => ({ ...p, [id]: { ok: resp.ok || resp.status < 500, latency: lat, msg: `${resp.status} ${lat}ms` } }));
    } catch (e: any) { setSpeedResults(p => ({ ...p, [id]: { ok: false, latency: Date.now() - start, msg: `连接失败` } })); }
  };

  /* ── Balance query (via Rust backend) ── */
  const handleBalance = async (id: string, baseUrl: string, apiKey: string) => {
    setBalanceResults(p => ({ ...p, [id]: '查询中...' }));
    try {
      const r = await api.provider.balance(id, baseUrl, apiKey);
      setBalanceResults(p => ({ ...p, [id]: r.balance || r.message }));
    } catch (e: any) { setBalanceResults(p => ({ ...p, [id]: '查询失败' })); }
  };

  /* ── Copy ── */
  const handleCopy = (id: string, p: typeof providers[string]) => {
    const newId = `${id}-copy-${Date.now()}`;
    const store = useAppStore.getState();
    store.setProviders({ ...store.providers, [newId]: { ...p, id: newId, name: `${p.name} (副本)` } });
    store.saveProviders();
  };

  /* ── Delete ── */
  const handleDelete = (id: string) => {
    const store = useAppStore.getState();
    if (Object.keys(store.providers).length <= 1) return; // keep at least one
    const n = { ...store.providers }; delete n[id];
    store.setProviders(n);
    store.saveProviders();
  };

  /* ── Switch ── */
  const handleSwitch = async (id: string) => {
    if (id === activeProviderId) return;
    await useAppStore.getState().switchActiveProvider(id);
  };

  return (
    <div className="space-y-6">
      {/* Status Grid */}
      <div className="grid grid-cols-4 gap-4">
        <div className="status-card">
          <div className="status-icon bg-indigo-500/15 text-indigo-400"><ServerIcon /></div>
          <div><p className="status-value">{activeProvider?.name || '未选择'}</p><p className="status-label">活跃供应商</p></div>
          <span className="text-[11px] text-muted-foreground">{activeProvider?.baseUrl || '请在下方选择'}</span>
        </div>
        <div className="status-card">
          <div className={`status-icon ${service.running ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
            {service.running ? <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400"/></span> : <ServerIcon />}
          </div>
          <div><p className="status-value">{service.running ? `运行中 :${service.port}` : '已停止'}</p><p className="status-label">代理状态</p></div>
          <span className="text-[11px] text-muted-foreground">{service.running ? '正常响应' : '点击右上角 ▶ 启动'}</span>
        </div>
        <div className="status-card">
          <div className="status-icon bg-blue-500/15 text-blue-400"><ZapIcon /></div>
          <div><p className="status-value">{stats.request_count}</p><p className="status-label">请求次数</p></div>
          <span className="text-[11px] text-muted-foreground">本次会话累计</span>
        </div>
        <div className="status-card">
          <div className="status-icon bg-amber-500/15 text-amber-400"><ClockIcon /></div>
          <div><p className="status-value">{avgLatency !== null ? `${avgLatency}ms` : '—'}</p><p className="status-label">平均延迟</p></div>
          <span className="text-[11px] text-muted-foreground">代理转发耗时</span>
        </div>
      </div>

      {/* Configured Providers */}
      {configured.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">已配置供应商</h2>
            <button onClick={() => setActiveNav('providers')} className="text-xs text-muted-foreground hover:text-foreground transition-colors">管理全部 →</button>
          </div>
          <div className="grid gap-2.5">
            {configured.map(([id, p]) => {
              const isActive = id === activeProviderId;
              const speed = speedResults[id];
              const balance = balanceResults[id];
              return (
                <div key={id} className={cn('provider-switch-card', isActive && 'active')}>
                  <ProviderIcon id={id} name={p.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold truncate">{p.name || id}</span>
                      {isActive && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">活跃</span>}
                      {speed && <span className={cn('text-[10px] flex-shrink-0', speed.ok ? 'text-emerald-400' : 'text-amber-400')}>{speed.msg}</span>}
                      {balance && <span className="text-[10px] text-blue-400 flex-shrink-0 ml-1">{balance}</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">{p.baseUrl}</div>
                  </div>
                  <button onClick={() => handleSwitch(id)} disabled={isActive}
                    className={cn('relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0', isActive ? 'bg-emerald-500 cursor-default' : 'bg-muted-foreground/30 hover:bg-primary/40')}>
                    <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200', isActive ? 'left-4' : 'left-0.5')} />
                  </button>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => p.apiKey ? handleSpeedTest(id, p.baseUrl) : null} className={cn('p-1.5 rounded-lg transition-colors', p.apiKey ? 'text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10' : 'text-muted-foreground/30 cursor-not-allowed')} title="测速" disabled={!p.apiKey}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></button>
                    <button onClick={() => p.apiKey ? handleBalance(id, p.baseUrl, p.apiKey) : null} className={cn('p-1.5 rounded-lg transition-colors', p.apiKey ? 'text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10' : 'text-muted-foreground/30 cursor-not-allowed')} title="余额" disabled={!p.apiKey}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h13a1 1 0 0 1 0 2H5a2 2 0 0 0 0 4h13a1 1 0 0 0 1-1v-2"/><rect width="6" height="3" x="16" y="11" rx="1"/></svg></button>
                    <button onClick={() => { useAppStore.getState().setEditingProviderId(id); setActiveNav('providers'); }} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="编辑"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
                    <button onClick={() => handleCopy(id, p)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="复制"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
                    <button onClick={() => setActiveNav('proxy')} className="p-1.5 rounded-lg text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10 transition-colors" title="转发（查看代理）"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 17 20 12 15 7"/><path d="M4 4v16"/></svg></button>
                    <button onClick={() => handleDelete(id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors" title="删除"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg></button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Unconfigured */}
      {unconfigured.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">待配置</h2>
          <div className="grid grid-cols-3 gap-3">
            {unconfigured.map(([id, p]) => (
              <button key={id} onClick={() => { useAppStore.getState().setEditingProviderId(id); setActiveNav('providers'); }}
                className="flex items-center gap-3 p-3 rounded-2xl border border-dashed border-border/50 bg-card/50 hover:border-primary/30 hover:bg-primary/3 transition-all duration-150 text-left">
                <ProviderIcon id={id} name={p.name} size="sm" />
                <div className="min-w-0"><div className="text-sm font-semibold">{p.name || id}</div><div className="text-[10px] text-muted-foreground">点击配置 API Key</div></div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
