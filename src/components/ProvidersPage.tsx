import { useState, useMemo, useEffect } from 'react';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import ProviderIcon from '@/components/ProviderIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ProviderConfig } from '@/lib/config';

const PROVIDER_ORDER = ['deepseek', 'dashscope', 'zhipu', 'moonshot', 'minimax', 'volcengine-coding'];

const PRESETS: Record<string, { name: string; baseUrl: string; icon: string; chatPath: string; defaultModel: string; modelMap: Record<string,string> }> = {
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', icon: 'D', chatPath: '/v1/chat/completions', defaultModel: 'deepseek-chat', modelMap: { 'gpt-5': 'deepseek-chat', 'gpt-5-codex': 'deepseek-chat', 'gpt-5-mini': 'deepseek-chat', 'gpt-5-nano': 'deepseek-chat', 'o4-mini': 'deepseek-chat', 'gpt-5.1': 'deepseek-chat', 'gpt-5.1-codex': 'deepseek-chat', 'gpt-5.1-codex-max': 'deepseek-chat' } },
  dashscope: { name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', icon: '百', chatPath: '/v1/chat/completions', defaultModel: 'qwen-plus', modelMap: { 'gpt-5': 'qwen-plus', 'gpt-5-codex': 'qwen-max', 'gpt-5-mini': 'qwen-turbo', 'o4-mini': 'qwen-plus' } },
  zhipu: { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', icon: '智', chatPath: '/v1/chat/completions', defaultModel: 'glm-4-plus', modelMap: { 'gpt-5': 'glm-4-plus', 'gpt-5-codex': 'glm-4-plus', 'gpt-5-mini': 'glm-4-flash', 'o4-mini': 'glm-4-flash' } },
  moonshot: { name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', icon: 'M', chatPath: '/v1/chat/completions', defaultModel: 'moonshot-v1-8k', modelMap: { 'gpt-5': 'moonshot-v1-8k', 'gpt-5-codex': 'moonshot-v1-32k', 'gpt-5-mini': 'moonshot-v1-8k' } },
  minimax: { name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', icon: '迷', chatPath: '/v1/chat/completions', defaultModel: 'abab6.5s-chat', modelMap: { 'gpt-5': 'abab6.5s-chat', 'gpt-5-codex': 'abab6.5s-chat', 'gpt-5-mini': 'abab6.5s-chat' } },
  'volcengine-coding': { name: '火山 Coding Plan', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', icon: '火', chatPath: '/v1/chat/completions', defaultModel: 'doubao-seed-1-6-251015', modelMap: { 'gpt-5': 'doubao-seed-1-6-251015', 'gpt-5-codex': 'doubao-seed-1-6-251015', 'gpt-5.1': 'doubao-seed-1-6-251015', 'gpt-5.1-codex': 'doubao-seed-1-6-251015', 'gpt-5.1-codex-max': 'doubao-seed-1-6-251015' } },
};

/* Icons */
const PlusIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);
const BackIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>);
const EyeIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>);
const EyeOffIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" x2="23" y1="1" y2="23"/></svg>);
const EditIcon = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>);
const ChevronRight = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>);

export default function ProvidersPage() {
  const { providers, selectedProvider, env, setSelectedProvider, saveProviders, switchActiveProvider, setActiveNav, setError, editingProviderId, setEditingProviderId } = useAppStore();
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState<'list' | 'edit'>('list');
  // Advanced model options removed (CCX: clean pipeline, no per-model hacks)
  const [speedResults, setSpeedResults] = useState<Record<string, { ok: boolean; latency: number; msg: string } | null>>({});
  const [balanceResults, setBalanceResults] = useState<Record<string, string | null>>({});

  const activeProviderId = (env as Record<string, string>).PROVIDER_PRESET || '';

  // Auto-enter edit mode when navigating from Dashboard
  useEffect(() => {
    if (editingProviderId && providers[editingProviderId]) {
      handleEdit(editingProviderId);
      setEditingProviderId(null);
    }
  }, [editingProviderId]);

  const sorted = useMemo(() => {
    const e = Object.entries(providers);
    e.sort((a, b) => { const ia = PROVIDER_ORDER.indexOf(a[0]), ib = PROVIDER_ORDER.indexOf(b[0]); if (ia === -1 && ib === -1) return a[0].localeCompare(b[0]); if (ia === -1) return 1; if (ib === -1) return -1; return ia - ib; });
    return e;
  }, [providers]);

  const handleEdit = (id: string) => { setSelectedProvider(id); setEditing({ ...providers[id], id }); setView('edit'); };
  const handleSave = () => {
    if (!editing?.id) return;
    useAppStore.getState().setProviders({ ...providers, [editing.id]: editing });
    saveProviders();
    if (editing.id === activeProviderId && editing.apiKey) {
      useAppStore.getState().setEnv({ ...env, TARGET_API_KEY: editing.apiKey });
    }
    setSaved(true); setTimeout(() => setSaved(false), 2000); setView('list');
  };
  const handleAddPreset = (id: string) => {
    const p = PRESETS[id]; if (!p) return;
    setEditing({ id, name: p.name, apiKey: '', baseUrl: p.baseUrl, chatPath: p.chatPath, modelsPath: '/v1/models', defaultModel: p.defaultModel, modelMap: p.modelMap });
    setSelectedProvider(id); setView('edit');
  };
  const handleAddCustom = () => {
    const id = `custom-${Date.now()}`;
    setEditing({ id, name: '自定义', apiKey: '', baseUrl: '', chatPath: '/v1/chat/completions', modelsPath: '/v1/models', defaultModel: 'gpt-4', modelMap: {} });
    setSelectedProvider(id); setView('edit');
  };
  const handleDelete = (id: string) => {
    if (Object.keys(providers).length <= 1) return;
    const n = { ...providers }; delete n[id];
    useAppStore.getState().setProviders(n);
    saveProviders();
    if (selectedProvider === id) setSelectedProvider(Object.keys(n)[0] || '');
  };
  const handleCopy = (id: string) => {
    const p = providers[id]; if (!p) return;
    const newId = `${id}-copy-${Date.now()}`;
    const copy = { ...p, id: newId, name: `${p.name} (副本)` };
    useAppStore.getState().setProviders({ ...providers, [newId]: copy });
    saveProviders();
  };
  const handleSpeedTest = async (id: string, baseUrl: string) => {
    setSpeedResults(p => ({ ...p, [id]: null }));
    const start = Date.now();
    try {
      const resp = await fetch(baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      setSpeedResults(p => ({ ...p, [id]: { ok: resp.ok || resp.status < 500, latency: Date.now() - start, msg: `${resp.status} ${Date.now() - start}ms` } }));
    } catch (e: any) { setSpeedResults(p => ({ ...p, [id]: { ok: false, latency: Date.now() - start, msg: `失败: ${e.message || e}` } })); }
  };
  const handleBalance = async (id: string, baseUrl: string, apiKey: string) => {
    setBalanceResults(p => ({ ...p, [id]: '查询中...' }));
    try {
      const r = await api.provider.balance(id, baseUrl, apiKey);
      setBalanceResults(p => ({ ...p, [id]: r.balance || r.message }));
    } catch (e: any) { setBalanceResults(p => ({ ...p, [id]: '失败' })); }
  };

  /* ── List View ── */
  if (view === 'list') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-lg font-extrabold">供应商</h1><p className="text-[13px] text-muted-foreground mt-0.5">管理 API 提供商和模型映射</p></div>
        <Button size="sm" variant="outline" onClick={handleAddCustom}><PlusIcon />自定义</Button>
      </div>

      {/* Active provider banner */}
      {activeProviderId && providers[activeProviderId] && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-emerald-500/20" style={{ background: `rgb(var(--success) / 0.06)` }}>
          <ProviderIcon id={activeProviderId} name={providers[activeProviderId].name} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold">活跃：{providers[activeProviderId].name}</div>
            <div className="text-[11px] text-muted-foreground truncate">{providers[activeProviderId].baseUrl}</div>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">ACTIVE</span>
        </div>
      )}

      {/* Provider table */}
      <div className="panel overflow-hidden">
        {/* Header row */}
        <div className="grid items-center gap-3 px-5 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/20"
          style={{ gridTemplateColumns: '42px 1fr 1.5fr 100px 140px 220px' }}>
          <span></span><span>名称</span><span>API 地址</span><span>状态</span><span>开关</span><span>操作</span>
        </div>
        <div className="divide-y divide-border/20">
          {sorted.map(([id, p]) => {
            const isActive = id === activeProviderId;
            const hasKey = !!p.apiKey?.trim();
            return (
              <div key={id} className={cn('grid items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors', isActive && 'bg-primary/3')}
                style={{ gridTemplateColumns: '42px 1fr 1.5fr 100px 140px 220px' }}>
                {/* Provider icon */}
                <ProviderIcon id={id} name={p.name} size="sm" />
                {/* Name */}
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate">{p.name || id}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {hasKey && <span className="text-[10px] text-emerald-400 font-semibold">已配置</span>}
                    {speedResults[id] && <span className={cn('text-[10px]', speedResults[id]!.ok ? 'text-emerald-400' : 'text-amber-400')}>{speedResults[id]!.msg}</span>}
                    {balanceResults[id] && <span className="text-[10px] text-blue-400">{balanceResults[id]}</span>}
                  </div>
                </div>
                {/* Base URL */}
                <div className="text-[12px] text-muted-foreground truncate">{p.baseUrl}</div>
                {/* Status */}
                <div>{isActive ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">活跃</span> : hasKey ? <span className="text-[11px] text-muted-foreground">就绪</span> : <span className="text-[11px] text-muted-foreground">未配置</span>}</div>
                {/* Toggle */}
                <div>
                  <button onClick={() => switchActiveProvider(id)} disabled={isActive}
                    className={cn('relative w-9 h-5 rounded-full transition-colors duration-200', isActive ? 'bg-emerald-500 cursor-default' : 'bg-muted-foreground/30 hover:bg-primary/40')}>
                    <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200', isActive ? 'left-4' : 'left-0.5')} />
                  </button>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button onClick={() => hasKey ? handleSpeedTest(id, p.baseUrl) : null} className={cn('p-1.5 rounded-lg transition-colors', hasKey ? 'text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10' : 'text-muted-foreground/30 cursor-not-allowed')} title="测速" disabled={!hasKey}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></button>
                  <button onClick={() => hasKey ? handleBalance(id, p.baseUrl, p.apiKey || '') : null} className={cn('p-1.5 rounded-lg transition-colors', hasKey ? 'text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10' : 'text-muted-foreground/30 cursor-not-allowed')} title="余额" disabled={!hasKey}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h13a1 1 0 0 1 0 2H5a2 2 0 0 0 0 4h13a1 1 0 0 0 1-1v-2"/><rect width="6" height="3" x="16" y="11" rx="1"/></svg></button>
                  <button onClick={() => handleEdit(id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="编辑"><EditIcon /></button>
                  <button onClick={() => handleCopy(id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="复制"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></button>
                  <button onClick={() => setActiveNav('proxy')} className="p-1.5 rounded-lg text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10 transition-colors" title="转发（查看代理）"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 17 20 12 15 7"/><path d="M4 4v16"/></svg></button>
                  <button onClick={() => handleDelete(id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors" title="删除"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg></button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Presets */}
      <div>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">快捷预设</h2>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(PRESETS).map(([id, preset]) => {
            const exists = providers[id];
            return (
              <button key={id} onClick={() => !exists && handleAddPreset(id)} disabled={!!exists}
                className={cn('flex items-center gap-3 p-3 rounded-2xl border text-left transition-all duration-150',
                  exists ? 'border-border/50 bg-card opacity-50 cursor-default' : 'border-border bg-card hover:border-primary/30 hover:bg-primary/5')}>
                <ProviderIcon id={id} name={preset.name} size="sm" />
                <div className="min-w-0"><div className="text-sm font-bold">{preset.name}</div>{exists ? <div className="text-[10px] text-muted-foreground">已添加</div> : <div className="text-[10px] text-muted-foreground truncate">{preset.baseUrl}</div>}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  /* ── Edit View ── */
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-3">
        <button onClick={() => setView('list')} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><BackIcon /></button>
        <div><h1 className="text-lg font-extrabold">{editing?.name || '编辑'}</h1><p className="text-[13px] text-muted-foreground mt-0.5">配置 API 连接和模型映射</p></div>
      </div>

      <div className="panel p-6 space-y-5">
        <Field label="名称"><Input value={editing?.name || ''} onChange={e => setEditing(editing ? { ...editing, name: e.target.value } : null)} /></Field>
        <Field label="API Key">
          <div className="relative">
            <Input type={showKey ? 'text' : 'password'} value={editing?.apiKey || ''} onChange={e => setEditing(editing ? { ...editing, apiKey: e.target.value } : null)} placeholder="sk-xxx" className="pr-10 font-mono text-xs" />
            <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>{showKey ? <EyeOffIcon /> : <EyeIcon />}</button>
          </div>
        </Field>
        <Field label="Base URL"><Input value={editing?.baseUrl || ''} onChange={e => setEditing(editing ? { ...editing, baseUrl: e.target.value } : null)} placeholder="https://api.example.com" /></Field>
        <Field label="Chat 路径"><Input value={editing?.chatPath || ''} onChange={e => setEditing(editing ? { ...editing, chatPath: e.target.value } : null)} /></Field>
        <Field label="Models 路径"><Input value={editing?.modelsPath || ''} onChange={e => setEditing(editing ? { ...editing, modelsPath: e.target.value } : null)} /></Field>
        <Field label="默认模型"><Input value={editing?.defaultModel || ''} onChange={e => setEditing(editing ? { ...editing, defaultModel: e.target.value } : null)} /></Field>

        {/* Model Mapping */}
        <Field label="模型映射 (Codex → 上游模型)">
          <div className="border border-border rounded-xl divide-y divide-border/30 overflow-hidden">
            {!Object.keys(editing?.modelMap || {}).length ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无映射</div>
            ) : (
              Object.entries(editing?.modelMap || {}).map(([from, to], i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2.5">
                  <Input className="flex-1 h-8 text-xs font-mono" value={from} placeholder="源模型" onChange={e => { if (!editing) return; const m = { ...editing.modelMap }; delete m[from]; if (e.target.value) m[e.target.value] = to; setEditing({ ...editing, modelMap: m }); }} />
                  <span className="text-muted-foreground text-xs">→</span>
                  <Input className="flex-1 h-8 text-xs font-mono" value={to} placeholder="目标模型" onChange={e => { if (!editing) return; setEditing({ ...editing, modelMap: { ...editing.modelMap, [from]: e.target.value } }); }} />
                  <button className="text-muted-foreground hover:text-red-400 p-1" onClick={() => { if (!editing) return; const m = { ...editing.modelMap }; delete m[from]; setEditing({ ...editing, modelMap: m }); }}>×</button>
                </div>
              ))
            )}
            <div className="px-3 py-2 bg-muted/20">
              <Button variant="ghost" size="sm" className="w-full justify-start text-xs h-7" onClick={() => { if (!editing) return; const k = 'model'; let n = 1; while (`${k}-${n}` in (editing.modelMap || {})) n++; setEditing({ ...editing, modelMap: { ...editing.modelMap, [`${k}-${n}`]: '$DEFAULT_MODEL' } }); }}><PlusIcon />添加映射</Button>
            </div>
          </div>
        </Field>

        {/* CCX per-provider config */}
        <Field label="推理力度映射 (JSON)">
          <Input className="h-8 text-xs font-mono" value={editing?.reasoningMapping ? JSON.stringify(editing.reasoningMapping) : ''} onChange={e => {
            if (!editing) return;
            try { const v = e.target.value.trim(); setEditing({ ...editing, reasoningMapping: v ? JSON.parse(v) : undefined }); } catch { /* invalid JSON, ignore */ }
          }} placeholder='{"xhigh":"xhigh","high":"high"}' />
        </Field>
        <Field label="规范化 Chat Role">
          <select value={editing?.normalizeChatRoles != null ? (editing.normalizeChatRoles ? '1' : '0') : ''} onChange={e => {
            const v = e.target.value;
            setEditing(editing ? { ...editing, normalizeChatRoles: v === '' ? undefined : v === '1' } : null);
          }} className="w-full h-8 rounded-lg border border-border bg-card px-2 text-xs">
            <option value="">默认 (开启)</option><option value="1">开启</option><option value="0">关闭</option>
          </select>
        </Field>

        <div className="flex items-center gap-3 pt-2">
          <Button size="sm" onClick={handleSave}>{saved ? '✓ 已保存' : '保存'}</Button>
          <Button size="sm" variant="outline" onClick={() => switchActiveProvider(editing?.id || '')} disabled={editing?.id === activeProviderId}>切换至此供应商</Button>
          <Button size="sm" variant="ghost" onClick={() => setView('list')}>返回</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label className="text-xs font-semibold text-muted-foreground">{label}</label>{children}</div>;
}
