import { useState } from 'react';
import useAppStore from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2, Save, XCircle } from '@/components/icons';
import type { ProviderConfig } from '@/lib/config';

export default function ProviderTab() {
  const { providers, selectedProvider, setSelectedProvider, saveProviders } = useAppStore();
  const [editing, setEditing] = useState<ProviderConfig | null>(null);

  const selectedConfig = selectedProvider && providers[selectedProvider];

  const handleSave = () => {
    if (editing?.id) {
      useAppStore.getState().setProviders({ ...providers, [editing.id]: editing });
      saveProviders();
    }
  };

  const handleAddCustom = () => {
    const id = `custom-${Date.now()}`;
    const newProvider: ProviderConfig = {
      id, name: 'Custom Provider', baseUrl: 'https://api.example.com',
      chatPath: '/v1/chat/completions', modelsPath: '/v1/models',
      defaultModel: 'gpt-4', modelMap: {},
    };
    setEditing(newProvider);
    setSelectedProvider(id);
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
            {Object.entries(providers).map(([id, provider]) => (
              <button
                key={id}
                onClick={() => { setSelectedProvider(id); setEditing({ ...provider, id }); }}
                className={`w-full text-left px-3 py-2 rounded-md text-[13px] transition-all duration-150 ${
                  selectedProvider === id
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">{provider.name || id}</span>
                  {id.startsWith('custom-') && (
                    <Trash2
                      className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive flex-shrink-0 ml-1 transition-colors"
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
              </button>
            ))}
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
          <CardTitle className="text-sm">{selectedConfig?.name || 'Select a Provider'}</CardTitle>
          {editing && (
            <Button size="sm" onClick={handleSave}><Save className="w-3.5 h-3.5" /> Save</Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {editing ? (
            <ScrollArea className="h-[calc(100vh-240px)]">
              <div className="space-y-4 p-5">
                <Field label="Name">
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
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
                      Object.entries(editing.modelMap || {}).map(([from, to]) => (
                        <div key={from} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                          <code className="px-2 py-0.5 bg-muted rounded text-xs flex-1 truncate">{from}</code>
                          <span className="text-muted-foreground text-xs">→</span>
                          <code className="px-2 py-0.5 bg-muted rounded text-xs flex-1 truncate">{to}</code>
                          <button onClick={() => { const m = { ...editing.modelMap }; delete m[from]; setEditing({ ...editing, modelMap: m }); }}>
                            <XCircle className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive transition-colors" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
