import { useEffect, useState, useRef } from 'react';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import ProviderIcon from '@/components/ProviderIcon';
import { ClaudeIcon, CodexIcon } from '@/components/BrandIcons';
import type { AppStats } from '@/lib/config';

const PROVIDER_ORDER = ['deepseek', 'dashscope', 'zhipu', 'moonshot', 'minimax', 'volcengine-coding'];

/* ── Icons ── */
const ServerIcon = () => (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/></svg>);
const ZapIcon = () => (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>);
const ClockIcon = () => (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>);

export default function Dashboard() {
  const { service, providers, env, logs, setActiveNav, codexProviderId, claudeProviderId, claudeConfigStatus, codexConfigStatus, loadClaudeStatus, loadCodexStatus, applyClaude3pConfig, removeClaude3pConfig, applyCodexConfig, removeCodexConfig, loading, toast, setToast } = useAppStore();
  const [stats, setStats] = useState<AppStats>({ running: false, request_count: 0 });
  const [speedResults, setSpeedResults] = useState<Record<string, { ok: boolean; latency: number; msg: string } | null>>({});
  const [balanceResults, setBalanceResults] = useState<Record<string, string | null>>({});
  const [appliedBtn, setAppliedBtn] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeProviderId = codexProviderId;
  const activeProvider = providers[activeProviderId];
  const codexProvider = providers[codexProviderId];
  const claudeProvider = providers[claudeProviderId];

  useEffect(() => {
    const load = async () => { try { setStats(await api.service.getStats()); } catch { /* */ } };
    load(); const i = setInterval(load, 3000); return () => clearInterval(i);
  }, []);

  useEffect(() => { loadClaudeStatus(); loadCodexStatus(); }, []);

  // Toast auto-dismiss
  useEffect(() => {
    if (toast) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 4000);
      return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
    }
  }, [toast, setToast]);

  // Applied button feedback auto-reset
  useEffect(() => {
    if (appliedBtn) {
      const t = setTimeout(() => setAppliedBtn(null), 1500);
      return () => clearTimeout(t);
    }
  }, [appliedBtn]);

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

  /* ── Balance query ── */
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
    if (Object.keys(store.providers).length <= 1) return;
    const n = { ...store.providers }; delete n[id];
    store.setProviders(n);
    store.saveProviders();
  };

  /* ── Switch ── */
  const handleSwitch = async (id: string, mode: 'codex' | 'claude') => {
    const store = useAppStore.getState();
    const currentId = mode === 'codex' ? store.codexProviderId : store.claudeProviderId;
    if (id === currentId) return;
    await store.switchActiveProvider(id, mode);
  };

  return (
    <div className="space-y-6">
      {/* Toast notification */}
      {toast && (
        <div className={cn(
          'fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg text-[12px] font-semibold shadow-lg animate-in slide-in-from-top-2 transition-all duration-300',
          toast.type === 'success' ? 'bg-emerald-500/90 text-white' : 'bg-destructive/90 text-white'
        )}>
          {toast.message}
        </div>
      )}
      {/* Status Grid */}
      <div className="grid grid-cols-4 gap-4">
        <div className="status-card">
          <div className="status-icon bg-indigo-500/15 text-indigo-400"><ServerIcon /></div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <CodexIcon size={14} /><span className="text-[11px] font-bold text-muted-foreground uppercase">Codex</span>
            </div>
            <p className="status-value text-lg">{codexProvider?.name || '未选择'}</p>
            <div className="flex items-center gap-1.5 mt-2">
              <ClaudeIcon size={14} /><span className="text-[11px] font-bold text-muted-foreground uppercase">Claude</span>
            </div>
            <p className="status-value text-lg">{claudeProvider?.name || '未选择'}</p>
          </div>
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

      {/* Desktop Integration */}
      <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">桌面集成</h2>
        <div className="panel overflow-hidden">
          {/* ── Claude row ── */}
          <div className="grid items-center px-4 py-2.5 border-b border-border/30" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="flex items-center gap-2.5 text-[12px] min-w-0 flex-wrap">
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <ClaudeIcon size={14} />
                <span className="font-semibold text-foreground">Claude Desktop</span>
              </div>
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold shrink-0 ${claudeConfigStatus?.applied ? 'text-emerald-400' : claudeConfigStatus?.config_file_exists ? 'text-amber-400' : 'text-muted-foreground'}`}>
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${claudeConfigStatus?.applied ? 'bg-emerald-400' : claudeConfigStatus?.config_file_exists ? 'bg-amber-400' : 'bg-slate-500'}`} />
                {claudeConfigStatus?.applied ? '已配置' : claudeConfigStatus?.config_file_exists ? '异常' : '未配置'}
              </span>
              {!claudeConfigStatus?.claude_app_exists && (
                <span className="text-[10px] text-amber-400 font-semibold shrink-0">未检测到应用</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
              {claudeConfigStatus?.applied && (
                <button onClick={removeClaude3pConfig} disabled={loading}
                  className="text-[10px] font-semibold text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded-md border border-border hover:border-destructive/30">
                  清除
                </button>
              )}
              <button onClick={async () => { await applyClaude3pConfig(); setAppliedBtn('claude'); }} disabled={loading}
                className={cn(
                  'text-[10px] font-semibold px-2 py-1 rounded-md disabled:opacity-50 transition-all duration-200',
                  appliedBtn === 'claude'
                    ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30'
                    : 'text-white bg-primary hover:opacity-90'
                )}>
                {appliedBtn === 'claude' ? '已应用' : '应用'}
              </button>
            </div>
          </div>
          {/* ── Codex row ── */}
          {codexProviderId && (
            <div className="grid items-center px-4 py-2.5" style={{ gridTemplateColumns: '1fr auto' }}>
              <div className="flex items-center gap-2.5 text-[12px] min-w-0 flex-wrap">
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <CodexIcon size={14} />
                  <span className="font-semibold text-foreground">Codex</span>
                </div>
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold shrink-0 ${codexConfigStatus?.applied ? 'text-emerald-400' : codexConfigStatus?.config_file_exists ? 'text-amber-400' : 'text-muted-foreground'}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${codexConfigStatus?.applied ? 'bg-emerald-400' : codexConfigStatus?.config_file_exists ? 'bg-amber-400' : 'bg-slate-500'}`} />
                  {codexConfigStatus?.applied ? '已配置' : codexConfigStatus?.config_file_exists ? '异常' : '未配置'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                {codexConfigStatus?.applied && (
                  <button onClick={removeCodexConfig} disabled={loading}
                    className="text-[10px] font-semibold text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded-md border border-border hover:border-destructive/30">
                    清除
                  </button>
                )}
                <button onClick={async () => { await applyCodexConfig(); setAppliedBtn('codex'); }} disabled={loading}
                  className={cn(
                    'text-[10px] font-semibold px-2 py-1 rounded-md disabled:opacity-50 transition-all duration-200',
                    appliedBtn === 'codex'
                      ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30'
                      : 'text-white bg-primary hover:opacity-90'
                  )}>
                  {appliedBtn === 'codex' ? '已应用' : '应用'}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Configured Providers */}
      {configured.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">已配置供应商</h2>
            <button onClick={() => setActiveNav('providers')} className="text-xs text-muted-foreground hover:text-foreground transition-colors">管理全部 →</button>
          </div>
          <div className="grid gap-2.5">
            {configured.map(([id, p]) => {
              const speed = speedResults[id];
              const balance = balanceResults[id];
              return (
                <div key={id} className={cn('provider-switch-card')}>
                  <ProviderIcon id={id} name={p.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold truncate">{p.name || id}</span>
                      {id === codexProviderId && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 flex-shrink-0"><CodexIcon size={10} /> Codex</span>}
                      {id === claudeProviderId && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20 flex-shrink-0"><ClaudeIcon size={10} /> Claude</span>}
                      {speed && <span className={cn('text-[10px] flex-shrink-0', speed.ok ? 'text-emerald-400' : 'text-amber-400')}>{speed.msg}</span>}
                      {balance && <span className="text-[10px] text-blue-400 flex-shrink-0 ml-1">{balance}</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">{p.codexBaseUrl || '-'}</div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleSwitch(id, 'codex')}
                      className={cn('p-1 rounded-lg transition-all duration-150', id === codexProviderId ? 'bg-blue-500/15 ring-1 ring-blue-500/30' : 'text-muted-foreground/30 hover:text-foreground')}
                      title={id === codexProviderId ? 'Codex 当前供应商' : '设为 Codex 供应商'}
                    >
                      <CodexIcon size={16} dimmed={id !== codexProviderId} />
                    </button>
                    <button
                      onClick={() => handleSwitch(id, 'claude')}
                      className={cn('p-1 rounded-lg transition-all duration-150', id === claudeProviderId ? 'bg-orange-500/15 ring-1 ring-orange-500/30' : 'text-muted-foreground/30 hover:text-foreground')}
                      title={id === claudeProviderId ? 'Claude 当前供应商' : '设为 Claude 供应商'}
                    >
                      <ClaudeIcon size={16} dimmed={id !== claudeProviderId} />
                    </button>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => p.apiKey ? handleSpeedTest(id, p.codexBaseUrl || '') : null} className={cn('p-1.5 rounded-lg transition-colors', p.apiKey ? 'text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10' : 'text-muted-foreground/30 cursor-not-allowed')} title="测速" disabled={!p.apiKey}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></button>
                    <button onClick={() => p.apiKey ? handleBalance(id, p.codexBaseUrl || '', p.apiKey) : null} className={cn('p-1.5 rounded-lg transition-colors', p.apiKey ? 'text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10' : 'text-muted-foreground/30 cursor-not-allowed')} title="余额" disabled={!p.apiKey}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h13a1 1 0 0 1 0 2H5a2 2 0 0 0 0 4h13a1 1 0 0 0 1-1v-2"/><rect width="6" height="3" x="16" y="11" rx="1"/></svg></button>
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
