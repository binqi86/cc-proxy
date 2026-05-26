import { useState, useMemo, useEffect } from 'react';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { ClaudeIcon, CodexIcon } from '@/components/BrandIcons';
import ProviderIcon from '@/components/ProviderIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ProviderConfig } from '@/lib/config';
import { CLAUDE_MODEL_SLOTS, CLAUDE_DEFAULT_SLOTS, CODEX_MODEL_SLOTS, CODEX_DEFAULT_SLOTS } from '@/lib/config';

const PROVIDER_ORDER = ['deepseek', 'dashscope', 'zhipu', 'moonshot', 'minimax', 'volcengine-coding'];

// Backward compat: old snake_case keys → new claude-* keys
const CLAUDE_KEY_COMPAT: Record<string, string> = {
  'opus_4_7': 'claude-opus-4-7',
  'opus_4_6': 'claude-opus-4-6',
  'opus_3': 'claude-3-opus',
  'sonnet_4_6': 'claude-sonnet-4-6',
  'sonnet_4_5': 'claude-sonnet-4-5',
  'haiku_4_5': 'claude-haiku-4-5',
};

const MODEL_1M_SUFFIX = '[1m]';
const DEFAULT_CODEX_CHAT_PATH = '/v1/chat/completions';
const DEFAULT_CLAUDE_CHAT_PATH = '/v1/chat/completions';
const DEFAULT_MODELS_PATH = '/v1/models';

const UPSTREAM_PROTOCOLS = [
  { id: 'chat-completions', label: 'Chat Completions', desc: '/v1/chat/completions' },
  { id: 'responses', label: 'Responses API', desc: '/v1/responses（直接透传）' },
];

function strip1mSuffix(value: string): string {
  return value.replace(/\[1m\]$/, '').trim();
}

function has1mSuffix(value: string): boolean {
  return value.trimEnd().endsWith(MODEL_1M_SUFFIX);
}

function normalizeProvider1mConfig(provider: ProviderConfig): ProviderConfig {
  const codexBaseUrl = (provider.codexBaseUrl ?? '').trim();
  const claudeBaseUrl = (provider.claudeBaseUrl ?? '').trim();

  const claudeModelMap = { ...(provider.claudeModelMap || {}) };
  const claudeModel1mMap = { ...(provider.claudeModel1mMap || {}) };
  let changed = false;

  for (const [slot, target] of Object.entries(claudeModelMap)) {
    if (has1mSuffix(target)) {
      claudeModelMap[slot] = strip1mSuffix(target);
      claudeModel1mMap[slot] = true;
      changed = true;
    }
  }

  const normalizedDefaultModel = has1mSuffix(provider.defaultModel)
    ? strip1mSuffix(provider.defaultModel)
    : provider.defaultModel;

  return {
    ...provider,
    codexBaseUrl,
    claudeBaseUrl,
    defaultModel: normalizedDefaultModel,
    claudeModelMap: changed ? claudeModelMap : provider.claudeModelMap,
    claudeModel1mMap: Object.keys(claudeModel1mMap).length > 0 ? claudeModel1mMap : provider.claudeModel1mMap,
  };
}

function resolveClaudeSlot(slot: string): string {
  return CLAUDE_KEY_COMPAT[slot] || slot;
}

function isClaudeSlotUsed(cm: Record<string, string> | undefined, slotKey: string): boolean {
  if (!cm) return false;
  if (slotKey in cm) return true;
  // Also check if any old compat key maps to this slot
  for (const [oldKey, newKey] of Object.entries(CLAUDE_KEY_COMPAT)) {
    if (newKey === slotKey && oldKey in cm) return true;
  }
  return false;
}

const PRESETS: Record<string, { name: string; codexBaseUrl: string; icon: string; codexUpstreamProtocol?: string; claudeBaseUrl?: string; defaultModel: string; modelMap: Record<string,string> }> = {
  deepseek: { name: 'DeepSeek', codexBaseUrl: 'https://api.deepseek.com', icon: 'D', claudeBaseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', modelMap: { 'gpt-5.5': 'deepseek-chat', 'gpt-5.4': 'deepseek-chat', 'gpt-5': 'deepseek-chat', 'gpt-5-codex': 'deepseek-chat', 'gpt-5-mini': 'deepseek-chat', 'gpt-5-nano': 'deepseek-chat', 'o4-mini': 'deepseek-chat', 'gpt-5.1': 'deepseek-chat', 'gpt-5.1-codex': 'deepseek-chat', 'gpt-5.1-codex-max': 'deepseek-chat' } },
  dashscope: { name: '阿里云百炼', codexBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', icon: '百', defaultModel: 'qwen-plus', modelMap: { 'gpt-5': 'qwen-plus', 'gpt-5-codex': 'qwen-max', 'gpt-5-mini': 'qwen-turbo', 'o4-mini': 'qwen-plus' } },
  zhipu: { name: '智谱 GLM', codexBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', icon: '智', defaultModel: 'glm-4-plus', modelMap: { 'gpt-5': 'glm-4-plus', 'gpt-5-codex': 'glm-4-plus', 'gpt-5-mini': 'glm-4-flash', 'o4-mini': 'glm-4-flash' } },
  moonshot: { name: 'Moonshot', codexBaseUrl: 'https://api.moonshot.cn/v1', icon: 'M', defaultModel: 'moonshot-v1-8k', modelMap: { 'gpt-5': 'moonshot-v1-8k', 'gpt-5-codex': 'moonshot-v1-32k', 'gpt-5-mini': 'moonshot-v1-8k' } },
  minimax: { name: 'MiniMax', codexBaseUrl: 'https://api.minimax.chat/v1', icon: '迷', defaultModel: 'abab6.5s-chat', modelMap: { 'gpt-5': 'abab6.5s-chat', 'gpt-5-codex': 'abab6.5s-chat', 'gpt-5-mini': 'abab6.5s-chat' } },
  'volcengine-coding': { name: '火山 Coding Plan', codexBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', icon: '火', defaultModel: 'doubao-seed-1-6-251015', modelMap: { 'gpt-5': 'doubao-seed-1-6-251015', 'gpt-5-codex': 'doubao-seed-1-6-251015', 'gpt-5.1': 'doubao-seed-1-6-251015', 'gpt-5.1-codex': 'doubao-seed-1-6-251015', 'gpt-5.1-codex-max': 'doubao-seed-1-6-251015' } },
};

/* Icons */
const PlusIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>);
const BackIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>);
const EyeIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>);
const EyeOffIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" x2="23" y1="1" y2="23"/></svg>);
const EditIcon = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>);
const ChevronRight = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>);

export default function ProvidersPage() {
  const { providers, selectedProvider, env, setSelectedProvider, saveProviders, switchActiveProvider, setActiveNav, setError, editingProviderId, setEditingProviderId, codexProviderId, claudeProviderId } = useAppStore();
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

  const handleEdit = (id: string) => {
    setSelectedProvider(id);
    setEditing(normalizeProvider1mConfig({ ...providers[id], id }));
    setView('edit');
  };
  const handleSave = () => {
    if (!editing?.id) return;
    const normalizedEditing = normalizeProvider1mConfig(editing);
    useAppStore.getState().setProviders({ ...providers, [editing.id]: normalizedEditing });
    saveProviders();
    if (editing.id === activeProviderId && editing.apiKey) {
      useAppStore.getState().setEnv({ ...env, TARGET_API_KEY: editing.apiKey });
    }
    setSaved(true); setTimeout(() => setSaved(false), 2000); setView('list');
  };
  const handleAddPreset = (id: string) => {
    const p = PRESETS[id]; if (!p) return;
    setEditing(normalizeProvider1mConfig({
      id,
      name: p.name,
      apiKey: '',
      codexBaseUrl: p.codexBaseUrl,
      codexUpstreamProtocol: p.codexUpstreamProtocol || 'chat-completions',
      claudeBaseUrl: p.claudeBaseUrl || p.codexBaseUrl,
      defaultModel: p.defaultModel,
      modelMap: p.modelMap,
    }));
    setSelectedProvider(id); setView('edit');
  };
  const handleAddCustom = () => {
    const id = `custom-${Date.now()}`;
    setEditing(normalizeProvider1mConfig({
      id,
      name: '自定义',
      apiKey: '',
      codexBaseUrl: '',
      codexUpstreamProtocol: 'chat-completions',
      claudeBaseUrl: '',
      defaultModel: 'gpt-4',
      modelMap: {},
    }));
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
    const copy = normalizeProvider1mConfig({ ...p, id: newId, name: `${p.name} (副本)` });
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

      {/* Active provider banner — dual mode */}
      {(codexProviderId || claudeProviderId) && (
        <div className="flex items-center gap-4 px-4 py-3 rounded-2xl border border-border/30" style={{ background: 'rgb(var(--muted) / 0.4)' }}>
          <div className="flex items-center gap-2">
            <CodexIcon size={16} />
            <div>
              <div className="text-[10px] font-bold text-muted-foreground uppercase">Codex</div>
              <div className="text-sm font-bold">{codexProviderId ? providers[codexProviderId]?.name || codexProviderId : '未选择'}</div>
            </div>
          </div>
          <div className="w-px h-8 bg-border/40" />
          <div className="flex items-center gap-2">
            <ClaudeIcon size={16} />
            <div>
              <div className="text-[10px] font-bold text-muted-foreground uppercase">Claude</div>
              <div className="text-sm font-bold">{claudeProviderId ? providers[claudeProviderId]?.name || claudeProviderId : '未选择'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Provider table */}
      <div className="panel overflow-hidden">
        {/* Header row */}
        <div className="grid items-center gap-3 px-5 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/20"
          style={{ gridTemplateColumns: '42px 1fr 1.5fr 100px 80px 180px' }}>
          <span></span><span>名称</span><span>API 地址</span><span>状态</span><span>路由到</span><span>操作</span>
        </div>
        <div className="divide-y divide-border/20">
          {sorted.map(([id, p]) => {
            const hasKey = !!p.apiKey?.trim();
            return (
              <div key={id} className={cn('grid items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors')}
                style={{ gridTemplateColumns: '42px 1fr 1.5fr 100px 80px 180px' }}>
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
                <div className="text-[12px] text-muted-foreground truncate">{p.codexBaseUrl || '-'}</div>
                {/* Status */}
                <div>{hasKey ? <span className="text-[11px] text-emerald-400 font-semibold">可用</span> : <span className="text-[11px] text-muted-foreground">未配置 Key</span>}</div>
                {/* Route-to — icon toggle for each mode */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => hasKey ? switchActiveProvider(id, 'codex') : null}
                    disabled={!hasKey || id === codexProviderId}
                    title={id === codexProviderId ? 'Codex 当前供应商' : hasKey ? '设为 Codex 供应商' : '未配置 API Key'}
                    className="transition-all duration-150"
                  >
                    <CodexIcon size={18} dimmed={id !== codexProviderId || !hasKey} />
                  </button>
                  <button
                    onClick={() => hasKey ? switchActiveProvider(id, 'claude') : null}
                    disabled={!hasKey || id === claudeProviderId}
                    title={id === claudeProviderId ? 'Claude 当前供应商' : hasKey ? '设为 Claude 供应商' : '未配置 API Key'}
                    className="transition-all duration-150"
                  >
                    <ClaudeIcon size={18} dimmed={id !== claudeProviderId || !hasKey} />
                  </button>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1">
                  <button onClick={() => hasKey ? handleSpeedTest(id, p.codexBaseUrl || '') : null} className={cn('p-1.5 rounded-lg transition-colors', hasKey ? 'text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10' : 'text-muted-foreground/30 cursor-not-allowed')} title="测速" disabled={!hasKey}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></button>
                  <button onClick={() => hasKey ? handleBalance(id, p.codexBaseUrl || '', p.apiKey || '') : null} className={cn('p-1.5 rounded-lg transition-colors', hasKey ? 'text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10' : 'text-muted-foreground/30 cursor-not-allowed')} title="余额" disabled={!hasKey}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h13a1 1 0 0 1 0 2H5a2 2 0 0 0 0 4h13a1 1 0 0 0 1-1v-2"/><rect width="6" height="3" x="16" y="11" rx="1"/></svg></button>
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
                <div className="min-w-0"><div className="text-sm font-bold">{preset.name}</div>{exists ? <div className="text-[10px] text-muted-foreground">已添加</div> : <div className="text-[10px] text-muted-foreground truncate">{preset.codexBaseUrl}</div>}</div>
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

      {/* Shared fields */}
      <div className="panel p-6 space-y-5">
        <Field label="名称"><Input value={editing?.name || ''} onChange={e => setEditing(editing ? { ...editing, name: e.target.value } : null)} /></Field>
        <Field label="API Key">
          <div className="relative">
            <Input type={showKey ? 'text' : 'password'} value={editing?.apiKey || ''} onChange={e => setEditing(editing ? { ...editing, apiKey: e.target.value } : null)} placeholder="sk-xxx" className="pr-10 font-mono text-xs" />
            <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>{showKey ? <EyeOffIcon /> : <EyeIcon />}</button>
          </div>
        </Field>
        <Field label="默认模型"><Input value={editing?.defaultModel || ''} onChange={e => setEditing(editing ? { ...editing, defaultModel: strip1mSuffix(e.target.value) } : null)} /></Field>
      </div>

      {/* Codex section */}
      <div className="panel overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border/20 bg-muted/30">
          <CodexIcon size={16} /><span className="text-sm font-bold">Codex</span>
        </div>
        <div className="p-6 space-y-5">
          <Field label="Base URL">
            <Input value={editing?.codexBaseUrl || ''} onChange={e => setEditing(editing ? { ...editing, codexBaseUrl: e.target.value } : null)} placeholder="https://api.example.com" />
          </Field>
          <Field label="上游协议">
            <select value={editing?.codexUpstreamProtocol || 'chat-completions'} onChange={e => {
              setEditing(editing ? { ...editing, codexUpstreamProtocol: e.target.value } : null);
            }} className="w-full h-8 rounded-lg border border-border bg-card px-2 text-xs">
              {UPSTREAM_PROTOCOLS.map(p => (
                <option key={p.id} value={p.id}>{p.label}（{p.desc}）</option>
              ))}
            </select>
          </Field>
          <Field label={`${'Codex'} API Key（可选，留空则用公共 Key）`}>
            <Input value={editing?.codexApiKey || ''} type={showKey ? 'text' : 'password'}
              onChange={e => setEditing(editing ? { ...editing, codexApiKey: e.target.value } : null)}
              placeholder="留空使用公共 API Key" className="font-mono text-xs" />
          </Field>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEditing(editing ? { ...editing, codexContextWindow: !editing.codexContextWindow } : null)}
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0',
                editing?.codexContextWindow !== false ? 'bg-blue-500' : 'bg-border'
              )}
            >
              <span className={cn(
                'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                editing?.codexContextWindow !== false ? 'translate-x-4' : 'translate-x-0.5'
              )} />
            </button>
            <span className="text-xs text-muted-foreground">
              1M 上下文窗口{editing?.codexContextWindow !== false ? '（已启用）' : '（已关闭）'}
            </span>
          </div>
          <Field label="模型映射 (Codex → 上游模型)">
            <div className="border border-border rounded-xl divide-y divide-border/30 overflow-hidden">
              {!Object.keys(editing?.modelMap || {}).length ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无映射，点击下方添加槽位</div>
              ) : (
                Object.entries(editing?.modelMap || {}).map(([from, to], i) => {
                  const slotDef = CODEX_MODEL_SLOTS.find(s => s.key === from);
                  const isCustom = !slotDef;
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2.5">
                      {!isCustom ? (
                        <div className="flex items-center gap-1.5 min-w-[120px]">
                          <select value={from}
                            onChange={e => {
                              if (!editing) return;
                              const m = { ...editing.modelMap };
                              delete m[from];
                              m[e.target.value] = to;
                              setEditing({ ...editing, modelMap: m });
                            }}
                            className="w-full h-8 rounded-lg border border-border bg-card px-2 text-[11px] font-mono"
                          >
                            {CODEX_MODEL_SLOTS.map(s => (
                              <option key={s.key} value={s.key} disabled={(editing.modelMap && s.key in editing.modelMap && s.key !== from)}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                          <span className="text-muted-foreground text-[10px] w-12 text-right truncate">{from}</span>
                        </div>
                      ) : (
                        <Input className="flex-1 h-8 text-xs font-mono" value={from} placeholder="model-name"
                          onChange={e => {
                            if (!editing) return;
                            const m = { ...editing.modelMap };
                            const newKey = e.target.value.trim();
                            if (from !== newKey) {
                              if (from) delete m[from];
                              m[newKey] = to;
                            }
                            setEditing({ ...editing, modelMap: m });
                          }}
                        />
                      )}
                      <span className="text-muted-foreground text-xs">→</span>
                      <Input className="flex-1 h-8 text-xs font-mono" value={to} placeholder="上游模型名"
                        onChange={e => {
                          if (!editing) return;
                          setEditing({ ...editing, modelMap: { ...editing.modelMap, [from]: e.target.value } });
                        }}
                      />
                      <button className="text-muted-foreground hover:text-red-400 p-1 flex-shrink-0"
                        onClick={() => { if (!editing) return; const m = { ...editing.modelMap }; delete m[from]; setEditing({ ...editing, modelMap: m }); }}
                      >x</button>
                    </div>
                  );
                })
              )}
              <div className="px-3 py-2 bg-muted/20 flex items-center gap-2">
                <Button variant="ghost" size="sm" className="justify-start text-xs h-7" onClick={() => {
                  if (!editing) return;
                  const m = { ...editing.modelMap };
                  const keys = Object.keys(m);
                  const available = CODEX_DEFAULT_SLOTS.find(s => !keys.includes(s)) || CODEX_MODEL_SLOTS.find(s => !keys.includes(s.key))?.key;
                  if (available) { m[available] = editing.defaultModel || ''; setEditing({ ...editing, modelMap: m }); }
                }}><PlusIcon />添加槽位映射</Button>
                <Button variant="ghost" size="sm" className="justify-start text-xs h-7" onClick={() => {
                  if (!editing) return;
                  const m = { ...editing.modelMap };
                  let n = 1;
                  while (`model-${n}` in m) n++;
                  m[`model-${n}`] = '';
                  setEditing({ ...editing, modelMap: m });
                }}><PlusIcon />自定义模型</Button>
              </div>
            </div>
          </Field>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => switchActiveProvider(editing?.id || '', 'codex')} disabled={editing?.id === codexProviderId}>
              <CodexIcon size={14} dimmed={editing?.id === codexProviderId} /> 设为 Codex 供应商
            </Button>
            <Button size="sm" onClick={() => useAppStore.getState().applyCodexConfig()}>应用到 Codex</Button>
          </div>
        </div>
      </div>

      {/* Claude section */}
      <div className="panel overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border/20 bg-muted/30">
          <ClaudeIcon size={16} /><span className="text-sm font-bold">Claude</span>
        </div>
        <div className="p-6 space-y-5">
          <Field label="Base URL">
            <Input value={editing?.claudeBaseUrl || ''} onChange={e => setEditing(editing ? { ...editing, claudeBaseUrl: e.target.value } : null)} placeholder="https://api.example.com" />
          </Field>
          <Field label={`${'Claude'} API Key（可选，留空则用公共 Key）`}>
            <Input value={editing?.claudeApiKey || ''} type={showKey ? 'text' : 'password'}
              onChange={e => setEditing(editing ? { ...editing, claudeApiKey: e.target.value } : null)}
              placeholder="留空使用公共 API Key" className="font-mono text-xs" />
          </Field>
          <Field label="模型映射 (Claude 路由 → 上游模型)">
            <div className="border border-border rounded-xl divide-y divide-border/30 overflow-hidden">
              {(!editing?.claudeModelMap || Object.keys(editing.claudeModelMap).length === 0) && (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无映射，点击下方添加槽位</div>
              )}
              {(editing?.claudeModelMap && Object.keys(editing.claudeModelMap).length > 0) && (
                Object.entries(editing.claudeModelMap).filter(([slot]) => {
                  const resolved = resolveClaudeSlot(slot);
                  return CLAUDE_MODEL_SLOTS.some(s => s.key === resolved) || resolved.startsWith('claude-');
                }).map(([slot, target], i) => {
                  const resolved = resolveClaudeSlot(slot);
                  const slotDef = CLAUDE_MODEL_SLOTS.find(s => s.key === resolved);
                  const isCustom = !slotDef;
                  return (
                    <div key={i} className="flex items-center gap-2 px-3 py-2.5">
                      {!isCustom ? (
                        <div className="flex items-center gap-1.5 min-w-[100px]">
                          <select value={resolved}
                            onChange={e => {
                              if (!editing) return;
                              const cm = { ...(editing.claudeModelMap || {}) };
                              const flags = { ...(editing.claudeModel1mMap || {}) };
                              delete cm[slot];
                              cm[e.target.value] = strip1mSuffix(target);
                              if (flags[slot]) {
                                flags[e.target.value] = true;
                              }
                              delete flags[slot];
                              setEditing({ ...editing, claudeModelMap: cm, claudeModel1mMap: flags });
                            }}
                            className="w-full h-8 rounded-lg border border-border bg-card px-2 text-[11px] font-mono"
                          >
                            {CLAUDE_MODEL_SLOTS.map(s => (
                              <option key={s.key} value={s.key} disabled={isClaudeSlotUsed(editing?.claudeModelMap, s.key) && s.key !== resolved}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                          <span className="text-muted-foreground text-[10px] w-12 text-right truncate">{slotDef?.claudeId || ''}</span>
                        </div>
                      ) : (
                        <Input className="flex-1 h-8 text-xs font-mono" value={slot} placeholder="claude-xxx"
                          onChange={e => {
                            if (!editing) return;
                            const cm = { ...(editing.claudeModelMap || {}) };
                            const flags = { ...(editing.claudeModel1mMap || {}) };
                            const newKey = e.target.value.trim();
                            if (newKey && newKey !== slot) {
                              delete cm[slot];
                              cm[newKey] = strip1mSuffix(target);
                              if (flags[slot]) { flags[newKey] = true; delete flags[slot]; }
                            } else if (!newKey) {
                              // Keep entry with current slot, user may re-edit
                              cm[slot] = strip1mSuffix(target);
                            }
                            setEditing({ ...editing, claudeModelMap: cm, claudeModel1mMap: flags });
                          }}
                        />
                      )}
                      <span className="text-muted-foreground text-xs">→</span>
                      <Input className="flex-1 h-8 text-xs font-mono" value={target} placeholder="上游模型名"
                        onChange={e => {
                          if (!editing) return;
                          const cleaned = strip1mSuffix(e.target.value);
                          setEditing({ ...editing, claudeModelMap: { ...(editing.claudeModelMap || {}), [slot]: cleaned } });
                        }}
                      />
                      <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer flex-shrink-0">
                        <input type="checkbox" checked={Boolean(editing?.claudeModel1mMap?.[slot]) || has1mSuffix(target)}
                          onChange={e => {
                            if (!editing) return;
                            const cm = { ...(editing.claudeModelMap || {}) };
                            const flags = { ...(editing.claudeModel1mMap || {}) };
                            cm[slot] = strip1mSuffix(target);
                            if (e.target.checked) {
                              flags[slot] = true;
                            } else {
                              delete flags[slot];
                            }
                            setEditing({ ...editing, claudeModelMap: cm, claudeModel1mMap: flags });
                          }}
                          className="w-3 h-3"
                        />
                        1M
                      </label>
                      <button className="text-muted-foreground hover:text-red-400 p-1 flex-shrink-0"
                        onClick={() => {
                          if (!editing) return;
                          const cm = { ...(editing.claudeModelMap || {}) };
                          const flags = { ...(editing.claudeModel1mMap || {}) };
                          delete cm[slot];
                          delete flags[slot];
                          setEditing({ ...editing, claudeModelMap: cm, claudeModel1mMap: flags });
                        }}
                      >x</button>
                    </div>
                  );
                })
              )}
              <div className="px-3 py-2 bg-muted/20 flex items-center gap-2">
                <Button variant="ghost" size="sm" className="justify-start text-xs h-7" onClick={() => {
                  if (!editing) return;
                  const cm = { ...(editing.claudeModelMap || {}) };
                  const available = CLAUDE_DEFAULT_SLOTS.find(s => !isClaudeSlotUsed(cm, s)) || CLAUDE_MODEL_SLOTS.find(s => !isClaudeSlotUsed(cm, s.key))?.key;
                  if (available) { cm[available] = strip1mSuffix(editing.defaultModel || ''); setEditing({ ...editing, claudeModelMap: cm }); }
                }}><PlusIcon />添加槽位映射</Button>
                <Button variant="ghost" size="sm" className="justify-start text-xs h-7" onClick={() => {
                  if (!editing) return;
                  const cm = { ...(editing.claudeModelMap || {}) };
                  let n = 1;
                  while (`claude-custom-${n}` in cm) n++;
                  cm[`claude-custom-${n}`] = '';
                  setEditing({ ...editing, claudeModelMap: cm });
                }}><PlusIcon />自定义路由</Button>
              </div>
            </div>
          </Field>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => switchActiveProvider(editing?.id || '', 'claude')} disabled={editing?.id === claudeProviderId}>
              <ClaudeIcon size={14} dimmed={editing?.id === claudeProviderId} /> 设为 Claude 供应商
            </Button>
            <Button size="sm" onClick={() => useAppStore.getState().applyClaude3pConfig()}>应用到桌面版</Button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave}>{saved ? '✓ 已保存' : '保存'}</Button>
        <Button size="sm" variant="ghost" onClick={() => setView('list')}>返回</Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label className="text-xs font-semibold text-muted-foreground">{label}</label>{children}</div>;
}
