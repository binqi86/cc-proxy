import { useEffect, useState, useRef } from 'react';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { sortProviders } from '@/lib/providers';
import { ServerIcon, ZapIcon, ClockIcon, SpeedTestIcon, BalanceIcon, EditIcon, CopyIcon, ForwardIcon, DeleteIcon } from '@/lib/icons';
import { StatusDot, Toast } from '@/components/shared';
import ProviderIcon from '@/components/ProviderIcon';
import { ClaudeIcon, CodexIcon } from '@/components/BrandIcons';
import type { AppStats } from '@/lib/config';

export default function Dashboard() {
  const {
    service, providers, logs, setActiveNav, codexProviderId, claudeProviderId,
    claudeConfigStatus, codexConfigStatus, loadClaudeStatus, loadCodexStatus,
    applyClaude3pConfig, removeClaude3pConfig, applyCodexConfig, removeCodexConfig,
    loading, toast, setToast, switchActiveProvider,
  } = useAppStore();
  const [stats, setStats] = useState<AppStats>({ running: false, request_count: 0 });
  const [speedResults, setSpeedResults] = useState<Record<string, { ok: boolean; msg: string } | null>>({});
  const [balanceResults, setBalanceResults] = useState<Record<string, string | null>>({});
  const [appliedBtn, setAppliedBtn] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const codexProvider = providers[codexProviderId];
  const claudeProvider = providers[claudeProviderId];

  useEffect(() => {
    const load = async () => { try { setStats(await api.service.getStats()); } catch { /* */ } };
    load(); const i = setInterval(load, 3000); return () => clearInterval(i);
  }, []);

  useEffect(() => { loadClaudeStatus(); loadCodexStatus(); }, []);
  useEffect(() => {
    const s = () => { loadClaudeStatus(); loadCodexStatus(); };
    document.addEventListener('desktop-config-changed', s);
    return () => document.removeEventListener('desktop-config-changed', s);
  }, [loadClaudeStatus, loadCodexStatus]);

  useEffect(() => {
    if (toast) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 4000);
      return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
    }
  }, [toast, setToast]);

  useEffect(() => { if (appliedBtn) { const t = setTimeout(() => setAppliedBtn(null), 1500); return () => clearTimeout(t); } }, [appliedBtn]);

  const sorted = sortProviders(providers);
  const configured = sorted.filter(([, p]) => p.apiKey?.trim());
  const unconfigured = sorted.filter(([, p]) => !p.apiKey?.trim());
  const avgLatency = (() => {
    const withLatency = logs.filter(l => l.latency);
    return withLatency.length ? Math.round(withLatency.reduce((s, l) => s + (l.latency || 0), 0) / withLatency.length) : null;
  })();

  const handleSpeedTest = async (id: string, baseUrl: string) => {
    setSpeedResults(p => ({ ...p, [id]: null }));
    const start = Date.now();
    try {
      const resp = await fetch(baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      setSpeedResults(p => ({ ...p, [id]: { ok: resp.ok || resp.status < 500, msg: `${resp.status} ${Date.now() - start}ms` } }));
    } catch { setSpeedResults(p => ({ ...p, [id]: { ok: false, msg: '连接失败' } })); }
  };

  const handleBalance = async (id: string, baseUrl: string, apiKey: string) => {
    setBalanceResults(p => ({ ...p, [id]: '查询中...' }));
    try { const r = await api.provider.balance(id, baseUrl, apiKey); setBalanceResults(p => ({ ...p, [id]: r.balance || r.message })); }
    catch { setBalanceResults(p => ({ ...p, [id]: '查询失败' })); }
  };

  return (
    <div className="space-y-6">
      <Toast toast={toast} />

      {/* Status Grid */}
      <div className="grid grid-cols-4 gap-4">
        <div className="status-card">
          <div className="status-icon bg-indigo-500/15 text-indigo-400"><ServerIcon /></div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-1"><CodexIcon size={14} /><span className="text-[11px] font-bold text-muted-foreground uppercase">Codex</span></div>
            <p className="status-value text-lg">{codexProvider?.name || '未选择'}</p>
            <div className="flex items-center gap-1.5 mt-2"><ClaudeIcon size={14} /><span className="text-[11px] font-bold text-muted-foreground uppercase">Claude</span></div>
            <p className="status-value text-lg">{claudeProvider?.name || '未选择'}</p>
          </div>
        </div>
        <div className="status-card">
          <div className={`status-icon ${service.running ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
            {service.running ? <StatusDot active size="md" /> : <ServerIcon />}
          </div>
          <div><p className="status-value">{service.running ? `运行中 :${service.port}` : '已停止'}</p><p className="status-label">代理状态</p></div>
        </div>
        <div className="status-card">
          <div className="status-icon bg-blue-500/15 text-blue-400"><ZapIcon /></div>
          <div><p className="status-value">{stats.request_count}</p><p className="status-label">请求次数</p></div>
        </div>
        <div className="status-card">
          <div className="status-icon bg-amber-500/15 text-amber-400"><ClockIcon /></div>
          <div><p className="status-value">{avgLatency !== null ? `${avgLatency}ms` : '—'}</p><p className="status-label">平均延迟</p></div>
        </div>
      </div>

      {/* Desktop Integration */}
      <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">桌面集成</h2>
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-border/30">
            <IntegrationCard icon={<CodexIcon size={14} />} label="Codex" status={codexConfigStatus} loading={loading}
              onApply={async () => { await applyCodexConfig(); setAppliedBtn('codex'); }} onRemove={removeCodexConfig}
              appliedBtn={appliedBtn === 'codex'} hasProvider={!!codexProviderId} />
            <IntegrationCard icon={<ClaudeIcon size={14} />} label="Claude" status={claudeConfigStatus} loading={loading}
              onApply={async () => { await applyClaude3pConfig(); setAppliedBtn('claude'); }} onRemove={removeClaude3pConfig}
              appliedBtn={appliedBtn === 'claude'} hasProvider={true} />
          </div>
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
            {configured.map(([id, p]) => (
              <div key={id} className="provider-switch-card">
                <ProviderIcon id={id} name={p.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold truncate">{p.name || id}</span>
                    {id === codexProviderId && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20"><CodexIcon size={10} /> Codex</span>}
                    {id === claudeProviderId && <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20"><ClaudeIcon size={10} /> Claude</span>}
                    {speedResults[id] && <span className={cn('text-[10px]', speedResults[id]!.ok ? 'text-emerald-400' : 'text-amber-400')}>{speedResults[id]!.msg}</span>}
                    {balanceResults[id] && <span className="text-[10px] text-blue-400 ml-1">{balanceResults[id]}</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">{p.codexBaseUrl || '-'}</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => switchActiveProvider(id, 'codex')} className={cn('p-1 rounded-lg transition-all', id === codexProviderId && 'bg-blue-500/15 ring-1 ring-blue-500/30')}><CodexIcon size={16} dimmed={id !== codexProviderId} /></button>
                  <button onClick={() => switchActiveProvider(id, 'claude')} className={cn('p-1 rounded-lg transition-all', id === claudeProviderId && 'bg-orange-500/15 ring-1 ring-orange-500/30')}><ClaudeIcon size={16} dimmed={id !== claudeProviderId} /></button>
                </div>
                <div className="flex items-center gap-0.5">
                  <IconBtn onClick={() => handleSpeedTest(id, p.codexBaseUrl || '')} title="测速"><SpeedTestIcon /></IconBtn>
                  <IconBtn onClick={() => handleBalance(id, p.codexBaseUrl || '', p.apiKey || '')} title="余额"><BalanceIcon /></IconBtn>
                  <IconBtn onClick={() => { useAppStore.getState().setEditingProviderId(id); setActiveNav('providers'); }} title="编辑"><EditIcon /></IconBtn>
                  <IconBtn onClick={() => setActiveNav('proxy')} title="代理"><ForwardIcon /></IconBtn>
                </div>
              </div>
            ))}
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
                className="flex items-center gap-3 p-3 rounded-2xl border border-dashed border-border/50 bg-card/50 hover:border-primary/30 transition-all text-left">
                <ProviderIcon id={id} name={p.name} size="sm" />
                <div className="min-w-0"><div className="text-sm font-semibold">{p.name || id}</div><div className="text-[10px] text-muted-foreground">点击配置</div></div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Sub-components ──

function IntegrationCard({ icon, label, status, loading, onApply, onRemove, appliedBtn, hasProvider }: {
  icon: React.ReactNode; label: string; status: any; loading: boolean;
  onApply: () => void; onRemove: () => void; appliedBtn: boolean; hasProvider: boolean;
}) {
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 text-[12px]">
        <div className="flex items-center gap-1.5">{icon}<span className="font-semibold">{label}</span></div>
        {status && (
          <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', status.applied ? 'text-emerald-400' : 'text-muted-foreground')}>
            <span className={cn('inline-block w-1.5 h-1.5 rounded-full', status.applied ? 'bg-emerald-400' : 'bg-slate-500')} />
            {status.applied ? '已配置' : '未配置'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {status?.applied && (
          <button onClick={onRemove} disabled={loading} className="text-[10px] font-semibold text-muted-foreground hover:text-destructive px-2 py-1 rounded-md border border-border">清除</button>
        )}
        {hasProvider && (
          <button onClick={onApply} disabled={loading}
            className={cn('text-[10px] font-semibold px-2 py-1 rounded-md disabled:opacity-50 transition-all',
              appliedBtn ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30' : 'text-white bg-primary hover:opacity-90')}>
            {appliedBtn ? '已应用' : '应用'}
          </button>
        )}
      </div>
    </div>
  );
}

function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return <button onClick={onClick} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title={title}>{children}</button>;
}
