import { useState, useMemo, useEffect } from 'react';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { ClaudeIcon, CodexIcon } from '@/components/BrandIcons';
import ProviderIcon from '@/components/ProviderIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/shared';
import { cn } from '@/lib/utils';
import { PlusIcon, BackIcon, EyeIcon, EyeOffIcon, EditIcon, CopyIcon, DeleteIcon, SpeedTestIcon, BalanceIcon, ForwardIcon } from '@/lib/icons';
import {
  sortProviders, PRESETS, UPSTREAM_PROTOCOLS, strip1mSuffix, has1mSuffix,
  normalizeProvider1mConfig, resolveClaudeSlot, isClaudeSlotUsed,
} from '@/lib/providers';
import { CLAUDE_MODEL_SLOTS, CLAUDE_DEFAULT_SLOTS, CODEX_MODEL_SLOTS, CODEX_DEFAULT_SLOTS } from '@/lib/config';
import type { ProviderConfig } from '@/lib/config';

export default function ProvidersPage() {
  const { providers, selectedProvider, env, setSelectedProvider, saveProviders, switchActiveProvider, setActiveNav, editingProviderId, setEditingProviderId, codexProviderId, claudeProviderId } = useAppStore();
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState<'list' | 'edit'>('list');
  const [speedResults, setSpeedResults] = useState<Record<string, { ok: boolean; latency: number; msg: string } | null>>({});
  const [balanceResults, setBalanceResults] = useState<Record<string, string | null>>({});

  // Auto-enter edit mode from Dashboard navigation
  useEffect(() => {
    if (editingProviderId && providers[editingProviderId]) {
      handleEdit(editingProviderId);
      setEditingProviderId(null);
    }
  }, [editingProviderId]);

  const sorted = useMemo(() => sortProviders(providers), [providers]);

  // ── Actions ──
  const handleEdit = (id: string) => {
    setSelectedProvider(id);
    setEditing(normalizeProvider1mConfig({ ...providers[id], id }));
    setView('edit');
  };

  const handleSave = () => {
    if (!editing?.id) return;
    const normalized = normalizeProvider1mConfig(editing);
    useAppStore.getState().setProviders({ ...providers, [editing.id]: normalized });
    saveProviders();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setView('list');
  };

  const handleAddPreset = (id: string) => {
    const p = PRESETS[id];
    if (!p) return;
    setEditing(normalizeProvider1mConfig({
      id, name: p.name, apiKey: '', codexBaseUrl: p.codexBaseUrl,
      codexUpstreamProtocol: p.codexUpstreamProtocol || 'chat-completions',
      claudeBaseUrl: p.claudeBaseUrl || p.codexBaseUrl, defaultModel: p.defaultModel, modelMap: p.modelMap,
    }));
    setSelectedProvider(id);
    setView('edit');
  };

  const handleAddCustom = () => {
    const id = `custom-${Date.now()}`;
    setEditing(normalizeProvider1mConfig({ id, name: '自定义', apiKey: '', codexBaseUrl: '', codexUpstreamProtocol: 'chat-completions', claudeBaseUrl: '', defaultModel: 'gpt-4', modelMap: {} }));
    setSelectedProvider(id);
    setView('edit');
  };

  const handleDelete = (id: string) => {
    if (Object.keys(providers).length <= 1) return;
    const n = { ...providers };
    delete n[id];
    useAppStore.getState().setProviders(n);
    saveProviders();
    if (selectedProvider === id) setSelectedProvider(Object.keys(n)[0] || '');
  };

  const handleCopy = (id: string) => {
    const p = providers[id];
    if (!p) return;
    const newId = `${id}-copy-${Date.now()}`;
    useAppStore.getState().setProviders({ ...providers, [newId]: normalizeProvider1mConfig({ ...p, id: newId, name: `${p.name} (副本)` }) });
    saveProviders();
  };

  const handleSpeedTest = async (id: string, baseUrl: string) => {
    setSpeedResults(p => ({ ...p, [id]: null }));
    const start = Date.now();
    try {
      const resp = await fetch(baseUrl, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
      setSpeedResults(p => ({ ...p, [id]: { ok: resp.ok || resp.status < 500, latency: Date.now() - start, msg: `${resp.status} ${Date.now() - start}ms` } }));
    } catch (e: any) {
      setSpeedResults(p => ({ ...p, [id]: { ok: false, latency: Date.now() - start, msg: `失败` } }));
    }
  };

  const handleBalance = async (id: string, baseUrl: string, apiKey: string) => {
    setBalanceResults(p => ({ ...p, [id]: '查询中...' }));
    try {
      const r = await api.provider.balance(id, baseUrl, apiKey);
      setBalanceResults(p => ({ ...p, [id]: r.balance || r.message }));
    } catch { setBalanceResults(p => ({ ...p, [id]: '失败' })); }
  };

  // ── List View ──
  if (view === 'list') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div><h1 className="text-lg font-extrabold">供应商</h1><p className="text-[13px] text-muted-foreground mt-0.5">管理 API 提供商和模型映射</p></div>
        <Button size="sm" variant="outline" onClick={handleAddCustom}><PlusIcon />自定义</Button>
      </div>

      {/* Active banner */}
      {(codexProviderId || claudeProviderId) && (
        <div className="flex items-center gap-4 px-4 py-3 rounded-2xl border border-border/30" style={{ background: 'rgb(var(--muted) / 0.4)' }}>
          <div className="flex items-center gap-2"><CodexIcon size={16} /><div><div className="text-[10px] font-bold text-muted-foreground uppercase">Codex</div><div className="text-sm font-bold">{codexProviderId ? providers[codexProviderId]?.name || codexProviderId : '未选择'}</div></div></div>
          <div className="w-px h-8 bg-border/40" />
          <div className="flex items-center gap-2"><ClaudeIcon size={16} /><div><div className="text-[10px] font-bold text-muted-foreground uppercase">Claude</div><div className="text-sm font-bold">{claudeProviderId ? providers[claudeProviderId]?.name || claudeProviderId : '未选择'}</div></div></div>
        </div>
      )}

      {/* Table */}
      <div className="panel overflow-hidden">
        <div className="grid items-center gap-3 px-5 py-3 text-[11px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/20" style={{ gridTemplateColumns: '42px 1fr 1.5fr 100px 80px 180px' }}>
          <span /><span>名称</span><span>API 地址</span><span>状态</span><span>路由到</span><span>操作</span>
        </div>
        <div className="divide-y divide-border/20">
          {sorted.map(([id, p]) => {
            const hasKey = !!p.apiKey?.trim();
            return (
              <div key={id} className="grid items-center gap-3 px-5 py-3 hover:bg-muted/20 transition-colors" style={{ gridTemplateColumns: '42px 1fr 1.5fr 100px 80px 180px' }}>
                <ProviderIcon id={id} name={p.name} size="sm" />
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate">{p.name || id}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {hasKey && <span className="text-[10px] text-emerald-400 font-semibold">已配置</span>}
                    {speedResults[id] && <span className={cn('text-[10px]', speedResults[id]!.ok ? 'text-emerald-400' : 'text-amber-400')}>{speedResults[id]!.msg}</span>}
                    {balanceResults[id] && <span className="text-[10px] text-blue-400">{balanceResults[id]}</span>}
                  </div>
                </div>
                <div className="text-[12px] text-muted-foreground truncate">{p.codexBaseUrl || '-'}</div>
                <div>{hasKey ? <span className="text-[11px] text-emerald-400 font-semibold">可用</span> : <span className="text-[11px] text-muted-foreground">未配置</span>}</div>
                <div className="flex items-center gap-2">
                  <button onClick={() => hasKey ? switchActiveProvider(id, 'codex') : null} disabled={!hasKey || id === codexProviderId} className="transition-all"><CodexIcon size={18} dimmed={id !== codexProviderId || !hasKey} /></button>
                  <button onClick={() => hasKey ? switchActiveProvider(id, 'claude') : null} disabled={!hasKey || id === claudeProviderId} className="transition-all"><ClaudeIcon size={18} dimmed={id !== claudeProviderId || !hasKey} /></button>
                </div>
                <div className="flex items-center gap-1">
                  <IconBtn onClick={() => hasKey ? handleSpeedTest(id, p.codexBaseUrl || '') : null} disabled={!hasKey} title="测速"><SpeedTestIcon /></IconBtn>
                  <IconBtn onClick={() => hasKey ? handleBalance(id, p.codexBaseUrl || '', p.apiKey || '') : null} disabled={!hasKey} title="余额"><BalanceIcon /></IconBtn>
                  <IconBtn onClick={() => handleEdit(id)} title="编辑"><EditIcon /></IconBtn>
                  <IconBtn onClick={() => handleCopy(id)} title="复制"><CopyIcon /></IconBtn>
                  <IconBtn onClick={() => setActiveNav('proxy')} title="代理"><ForwardIcon /></IconBtn>
                  <IconBtn onClick={() => handleDelete(id)} title="删除" danger><DeleteIcon /></IconBtn>
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
                className={cn('flex items-center gap-3 p-3 rounded-2xl border text-left transition-all',
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

  // ── Edit View ──
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
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border/20 bg-muted/30"><CodexIcon size={16} /><span className="text-sm font-bold">Codex</span></div>
        <div className="p-6 space-y-5">
          <Field label="Base URL"><Input value={editing?.codexBaseUrl || ''} onChange={e => setEditing(editing ? { ...editing, codexBaseUrl: e.target.value } : null)} placeholder="https://api.example.com" /></Field>
          <Field label="上游协议">
            <select value={editing?.codexUpstreamProtocol || 'chat-completions'} onChange={e => setEditing(editing ? { ...editing, codexUpstreamProtocol: e.target.value } : null)} className="w-full h-8 rounded-lg border border-border bg-card px-2 text-xs">
              {UPSTREAM_PROTOCOLS.map(p => <option key={p.id} value={p.id}>{p.label}（{p.desc}）</option>)}
            </select>
          </Field>
          <Field label="Codex API Key（可选）"><Input value={editing?.codexApiKey || ''} type={showKey ? 'text' : 'password'} onChange={e => setEditing(editing ? { ...editing, codexApiKey: e.target.value } : null)} placeholder="留空使用公共 Key" className="font-mono text-xs" /></Field>
          <div className="flex items-center gap-3">
            <Toggle checked={editing?.codexContextWindow !== false} onChange={() => setEditing(editing ? { ...editing, codexContextWindow: !editing.codexContextWindow } : null)} />
            <span className="text-xs text-muted-foreground">1M 上下文窗口{editing?.codexContextWindow !== false ? '（已启用）' : '（已关闭）'}</span>
          </div>
          <ModelMapEditor label="模型映射 (Codex → 上游模型)" map={editing?.modelMap || {}} slots={CODEX_MODEL_SLOTS} defaultSlots={CODEX_DEFAULT_SLOTS} defaultModel={editing?.defaultModel || ''}
            onChange={m => setEditing(editing ? { ...editing, modelMap: m } : null)} />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => switchActiveProvider(editing?.id || '', 'codex')} disabled={editing?.id === codexProviderId}><CodexIcon size={14} dimmed={editing?.id === codexProviderId} /> 设为 Codex</Button>
            <Button size="sm" onClick={() => useAppStore.getState().applyCodexConfig()}>应用到 Codex</Button>
          </div>
        </div>
      </div>

      {/* Claude section */}
      <div className="panel overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border/20 bg-muted/30"><ClaudeIcon size={16} /><span className="text-sm font-bold">Claude</span></div>
        <div className="p-6 space-y-5">
          <Field label="Base URL"><Input value={editing?.claudeBaseUrl || ''} onChange={e => setEditing(editing ? { ...editing, claudeBaseUrl: e.target.value } : null)} placeholder="https://api.example.com" /></Field>
          <Field label="Claude API Key（可选）"><Input value={editing?.claudeApiKey || ''} type={showKey ? 'text' : 'password'} onChange={e => setEditing(editing ? { ...editing, claudeApiKey: e.target.value } : null)} placeholder="留空使用公共 Key" className="font-mono text-xs" /></Field>
          <ClaudeModelMapEditor editing={editing} setEditing={setEditing} />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => switchActiveProvider(editing?.id || '', 'claude')} disabled={editing?.id === claudeProviderId}><ClaudeIcon size={14} dimmed={editing?.id === claudeProviderId} /> 设为 Claude</Button>
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

// ── Reusable sub-components ──

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label className="text-xs font-semibold text-muted-foreground">{label}</label>{children}</div>;
}

function IconBtn({ onClick, disabled, title, danger, children }: { onClick: () => void; disabled?: boolean; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={cn('p-1.5 rounded-lg transition-colors', disabled ? 'text-muted-foreground/30 cursor-not-allowed' : danger ? 'text-muted-foreground hover:text-red-400 hover:bg-red-500/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted')}>
      {children}
    </button>
  );
}

// ── Codex Model Map Editor ──

function ModelMapEditor({ label, map, slots, defaultSlots, defaultModel, onChange }: {
  label: string; map: Record<string, string>; slots: { key: string; label: string }[]; defaultSlots: string[]; defaultModel: string;
  onChange: (m: Record<string, string>) => void;
}) {
  return (
    <Field label={label}>
      <div className="border border-border rounded-xl divide-y divide-border/30 overflow-hidden">
        {!Object.keys(map).length ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无映射</div>
        ) : (
          Object.entries(map).map(([from, to]) => {
            const slotDef = slots.find(s => s.key === from);
            return (
              <div key={from} className="flex items-center gap-2 px-3 py-2.5">
                {slotDef ? (
                  <select value={from} onChange={e => { const m = { ...map }; delete m[from]; m[e.target.value] = to; onChange(m); }} className="w-32 h-8 rounded-lg border border-border bg-card px-2 text-[11px] font-mono">
                    {slots.map(s => <option key={s.key} value={s.key} disabled={s.key in map && s.key !== from}>{s.label}</option>)}
                  </select>
                ) : (
                  <Input className="flex-1 h-8 text-xs font-mono" value={from} onChange={e => { const m = { ...map }; delete m[from]; m[e.target.value.trim()] = to; onChange(m); }} />
                )}
                <span className="text-muted-foreground text-xs">→</span>
                <Input className="flex-1 h-8 text-xs font-mono" value={to} onChange={e => onChange({ ...map, [from]: e.target.value })} placeholder="上游模型名" />
                <button className="text-muted-foreground hover:text-red-400 p-1" onClick={() => { const m = { ...map }; delete m[from]; onChange(m); }}>×</button>
              </div>
            );
          })
        )}
        <div className="px-3 py-2 bg-muted/20 flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => {
            const available = defaultSlots.find(s => !(s in map)) || slots.find(s => !(s.key in map))?.key;
            if (available) onChange({ ...map, [available]: defaultModel });
          }}><PlusIcon />添加槽位</Button>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => {
            let n = 1; while (`model-${n}` in map) n++;
            onChange({ ...map, [`model-${n}`]: '' });
          }}><PlusIcon />自定义</Button>
        </div>
      </div>
    </Field>
  );
}

// ── Claude Model Map Editor ──

function ClaudeModelMapEditor({ editing, setEditing }: { editing: ProviderConfig | null; setEditing: (p: ProviderConfig | null) => void }) {
  if (!editing) return null;
  const cm = editing.claudeModelMap || {};
  const flags = editing.claudeModel1mMap || {};

  return (
    <Field label="模型映射 (Claude 路由 → 上游模型)">
      <div className="border border-border rounded-xl divide-y divide-border/30 overflow-hidden">
        {!Object.keys(cm).length ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">暂无映射</div>
        ) : (
          Object.entries(cm).map(([slot, target]) => {
            const resolved = resolveClaudeSlot(slot);
            const slotDef = CLAUDE_MODEL_SLOTS.find(s => s.key === resolved);
            return (
              <div key={slot} className="flex items-center gap-2 px-3 py-2.5">
                {slotDef ? (
                  <select value={resolved} onChange={e => {
                    const newCm = { ...cm }; const newFlags = { ...flags };
                    delete newCm[slot]; newCm[e.target.value] = strip1mSuffix(target);
                    if (newFlags[slot]) { newFlags[e.target.value] = true; delete newFlags[slot]; }
                    setEditing({ ...editing, claudeModelMap: newCm, claudeModel1mMap: newFlags });
                  }} className="w-28 h-8 rounded-lg border border-border bg-card px-2 text-[11px] font-mono">
                    {CLAUDE_MODEL_SLOTS.map(s => <option key={s.key} value={s.key} disabled={isClaudeSlotUsed(cm, s.key) && s.key !== resolved}>{s.label}</option>)}
                  </select>
                ) : (
                  <Input className="flex-1 h-8 text-xs font-mono" value={slot} onChange={e => {
                    const newCm = { ...cm }; const newFlags = { ...flags };
                    const newKey = e.target.value.trim();
                    if (newKey && newKey !== slot) { delete newCm[slot]; newCm[newKey] = strip1mSuffix(target); if (newFlags[slot]) { newFlags[newKey] = true; delete newFlags[slot]; } }
                    setEditing({ ...editing, claudeModelMap: newCm, claudeModel1mMap: newFlags });
                  }} />
                )}
                <span className="text-muted-foreground text-xs">→</span>
                <Input className="flex-1 h-8 text-xs font-mono" value={target} onChange={e => setEditing({ ...editing, claudeModelMap: { ...cm, [slot]: strip1mSuffix(e.target.value) } })} placeholder="上游模型名" />
                <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={Boolean(flags[slot]) || has1mSuffix(target)} onChange={e => {
                    const newFlags = { ...flags };
                    const newCm = { ...cm }; newCm[slot] = strip1mSuffix(target);
                    if (e.target.checked) newFlags[slot] = true; else delete newFlags[slot];
                    setEditing({ ...editing, claudeModelMap: newCm, claudeModel1mMap: newFlags });
                  }} className="w-3 h-3" />1M
                </label>
                <button className="text-muted-foreground hover:text-red-400 p-1" onClick={() => {
                  const newCm = { ...cm }; const newFlags = { ...flags }; delete newCm[slot]; delete newFlags[slot];
                  setEditing({ ...editing, claudeModelMap: newCm, claudeModel1mMap: newFlags });
                }}>×</button>
              </div>
            );
          })
        )}
        <div className="px-3 py-2 bg-muted/20 flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => {
            const available = CLAUDE_DEFAULT_SLOTS.find(s => !isClaudeSlotUsed(cm, s)) || CLAUDE_MODEL_SLOTS.find(s => !isClaudeSlotUsed(cm, s.key))?.key;
            if (available) setEditing({ ...editing, claudeModelMap: { ...cm, [available]: strip1mSuffix(editing.defaultModel || '') } });
          }}><PlusIcon />添加槽位</Button>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => {
            let n = 1; while (`claude-custom-${n}` in cm) n++;
            setEditing({ ...editing, claudeModelMap: { ...cm, [`claude-custom-${n}`]: '' } });
          }}><PlusIcon />自定义路由</Button>
        </div>
      </div>
    </Field>
  );
}
