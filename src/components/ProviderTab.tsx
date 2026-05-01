import { useState, useMemo } from 'react';
import useAppStore from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Save, XCircle, Eye, EyeOff, CheckCircle2 } from '@/components/icons';
import type { ProviderConfig } from '@/lib/config';

const PROVIDER_ORDER = ['deepseek', 'dashscope', 'zhipu', 'moonshot', 'minimax', 'volcengine-coding'];

function sortedProviderEntries(providers: Record<string, ProviderConfig>): [string, ProviderConfig][] {
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

export default function ProviderTab() {
  const { providers, selectedProvider, env, setSelectedProvider, saveProviders, switchActiveProvider } = useAppStore();
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const activeProviderId = (env as Record<string, string>).PROVIDER_PRESET || '';
  const selectedConfig = selectedProvider && providers[selectedProvider];
  const sortedProviders = useMemo(() => sortedProviderEntries(providers), [providers]);

  const handleSave = () => {
    if (editing?.id) {
      useAppStore.getState().setProviders({ ...providers, [editing.id]: editing });
      saveProviders();
      if (editing.id === activeProviderId && editing.apiKey) {
        const newEnv = { ...env, TARGET_API_KEY: editing.apiKey };
        useAppStore.getState().setEnv(newEnv);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleAddCustom = () => {
    const id = `custom-${Date.now()}`;
    const newProvider: ProviderConfig = {
      id, name: 'Custom Provider', apiKey: '', baseUrl: 'https://api.example.com',
      chatPath: '/v1/chat/completions', modelsPath: '/v1/models',
      defaultModel: 'gpt-4', modelMap: {},
    };
    setEditing(newProvider);
    setSelectedProvider(id);
  };

  const handleToggleActive = async (id: string) => {
    if (id === activeProviderId) return;
    await switchActiveProvider(id);
  };

  return (
    <div className="flex h-full gap-4">
      {/* Sidebar */}
      <div className="w-[220px] flex-shrink-0 rounded-lg border border-border bg-sidebar flex flex-col">
        <div className="px-4 py-3.5 border-b border-border/50">
          <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider leading-none">Providers</h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {sortedProviders.map(([id, provider]) => {
              const isActive = id === activeProviderId;
              return (
                <button
                  key={id}
                  onClick={() => { setSelectedProvider(id); setEditing({ ...provider, id }); }}
                  className={`w-full text-left px-3 py-2 rounded-md text-[13px] transition-all duration-150 group ${
                    selectedProvider === id
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{provider.name || id}</span>
                    <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                      <span onClick={(e) => e.stopPropagation()} title={isActive ? '当前活跃' : '点击切换至此 provider'}>
                        <Switch
                          checked={isActive}
                          onChange={() => handleToggleActive(id)}
                        />
                      </span>
                      {id.startsWith('custom-') && (
                        <Trash2
                          className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = { ...providers };
                            delete next[id];
                            useAppStore.getState().setProviders(next);
                            if (selectedProvider === id) {
                              setSelectedProvider(Object.keys(next)[0] || '');
                              setEditing(null);
                            }
                          }}
                        />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
        <div className="p-2 border-t border-border/50">
          <Button variant="ghost" size="sm" className="w-full justify-start text-xs" onClick={handleAddCustom}>
            <Plus className="w-3.5 h-3.5" />
            Add Provider
          </Button>
        </div>
      </div>

      {/* Editor */}
      <Card className="flex-1 border-border">
        <CardHeader className="flex flex-row items-center justify-between py-3 px-5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">{selectedConfig?.name || 'Select a Provider'}</CardTitle>
            {selectedProvider && selectedProvider === activeProviderId && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/20 text-primary border border-primary/30">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                ACTIVE
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedProvider && selectedProvider !== activeProviderId && (
              <Button size="sm" variant="outline" onClick={() => handleToggleActive(selectedProvider)}>
                Switch to this
              </Button>
            )}
            {editing && (
              <Button size="sm" onClick={handleSave} disabled={saved} variant={saved ? 'outline' : 'default'}>
                {saved ? (
                  <><CheckCircle2 className="w-3.5 h-3.5 text-primary" /> Saved</>
                ) : (
                  <><Save className="w-3.5 h-3.5" /> Save</>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {editing ? (
            <ScrollArea className="h-[calc(100vh-240px)]">
              <div className="space-y-4 p-5">
                <Field label="Name">
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </Field>
                <Field label="API Key" hint="用于访问此 provider 的密钥">
                  <div className="relative">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={editing.apiKey || ''}
                      onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                      placeholder="sk-xxx"
                      className="pr-10 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </Field>
                <Field label="Base URL">
                  <Input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} placeholder="https://api.example.com" />
                </Field>
                <Field label="Chat Path">
                  <Input value={editing.chatPath} onChange={(e) => setEditing({ ...editing, chatPath: e.target.value })} />
                </Field>
                <Field label="Models Path">
                  <Input value={editing.modelsPath} onChange={(e) => setEditing({ ...editing, modelsPath: e.target.value })} />
                </Field>
                <Field label="Default Model">
                  <Input value={editing.defaultModel} onChange={(e) => setEditing({ ...editing, defaultModel: e.target.value })} />
                </Field>
                <Field label="Model Map">
                  <div className="border border-border rounded-md divide-y divide-border">
                    {Object.keys(editing.modelMap || {}).length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-muted-foreground">No mappings</div>
                    ) : (
                      Object.entries(editing.modelMap || {}).map(([from, to], idx) => (
                        <div key={idx} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                          <Input
                            className="flex-1 h-7 text-xs font-mono"
                            value={from}
                            placeholder="source model"
                            onChange={(e) => {
                              const newKey = e.target.value;
                              const m = { ...editing.modelMap };
                              delete m[from];
                              if (newKey) m[newKey] = to;
                              setEditing({ ...editing, modelMap: m });
                            }}
                          />
                          <span className="text-muted-foreground text-xs flex-shrink-0">→</span>
                          <Input
                            className="flex-1 h-7 text-xs font-mono"
                            value={to}
                            placeholder="target model"
                            onChange={(e) => {
                              setEditing({ ...editing, modelMap: { ...editing.modelMap, [from]: e.target.value } });
                            }}
                          />
                          <button
                            className="flex-shrink-0"
                            onClick={() => { const m = { ...editing.modelMap }; delete m[from]; setEditing({ ...editing, modelMap: m }); }}
                          >
                            <XCircle className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive transition-colors" />
                          </button>
                        </div>
                      ))
                    )}
                    <div className="px-3 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-xs"
                        onClick={() => {
                          const key = 'new-model';
                          let n = 1;
                          while (key + (n > 1 ? `-${n}` : '') in (editing.modelMap || {})) n++;
                          const m = { ...editing.modelMap, [key + (n > 1 ? `-${n}` : '')]: '$DEFAULT_MODEL' };
                          setEditing({ ...editing, modelMap: m });
                        }}
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Mapping
                      </Button>
                    </div>
                  </div>
                </Field>

                {/* Model Options */}
                <div className="border-t border-border/50 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                    Model Options (Advanced)
                  </button>
                  {showAdvanced && (
                    <div className="mt-3 space-y-3">
                      {Object.keys(editing.modelOptions || {}).length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">No per-model options configured</p>
                      ) : (
                        Object.entries(editing.modelOptions || {}).map(([modelName, opts], idx) => (
                          <div key={idx} className="border border-border rounded-md p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-[11px] text-muted-foreground">Model</Label>
                              <button
                                onClick={() => {
                                  const mo = { ...editing.modelOptions };
                                  delete mo[modelName];
                                  setEditing({ ...editing, modelOptions: Object.keys(mo).length ? mo : undefined });
                                }}
                              >
                                <XCircle className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive transition-colors" />
                              </button>
                            </div>
                            <Input
                              className="h-7 text-xs font-mono"
                              value={modelName}
                              placeholder="model name, e.g. minimax-m2.7"
                              onChange={(e) => {
                                const newKey = e.target.value;
                                const mo = { ...editing.modelOptions };
                                delete mo[modelName];
                                if (newKey) mo[newKey] = opts;
                                setEditing({ ...editing, modelOptions: mo });
                              }}
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">System Message Mode</Label>
                                <select
                                  value={opts.systemMessageMode || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const mo = { ...editing.modelOptions };
                                    const entry = { ...mo[modelName] };
                                    if (val) {
                                      entry.systemMessageMode = val;
                                    } else {
                                      delete entry.systemMessageMode;
                                    }
                                    mo[modelName] = entry;
                                    setEditing({ ...editing, modelOptions: mo });
                                  }}
                                  className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                                >
                                  <option value="">(default)</option>
                                  <option value="merge">merge</option>
                                  <option value="as-user">as-user</option>
                                </select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[11px] text-muted-foreground">Omit Params</Label>
                                <Input
                                  className="h-7 text-xs"
                                  value={(opts.omitParams || []).join(', ')}
                                  placeholder="max_tokens, stop"
                                  onChange={(e) => {
                                    const arr = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                    const mo = { ...editing.modelOptions };
                                    const entry = { ...mo[modelName] };
                                    if (arr.length) {
                                      entry.omitParams = arr;
                                    } else {
                                      delete entry.omitParams;
                                    }
                                    mo[modelName] = entry;
                                    setEditing({ ...editing, modelOptions: mo });
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-xs"
                        onClick={() => {
                          const mo = { ...editing.modelOptions, 'model-name': {} };
                          setEditing({ ...editing, modelOptions: mo });
                        }}
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Model Option
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          ) : (
            <div className="py-16 text-center text-sm text-muted-foreground">Select a provider from the sidebar to edit</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}
