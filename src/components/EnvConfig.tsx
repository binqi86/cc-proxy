import { useState, useEffect } from 'react';
import useAppStore from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Save, AlertTriangle } from '@/components/icons';
import type { EnvConfig } from '@/lib/config';

export default function EnvConfigPage() {
  const { env, providers, setEnv, saveEnv, startService } = useAppStore();
  const [localEnv, setLocalEnv] = useState<EnvConfig>({ ...env });
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setLocalEnv({ ...env }); }, [env]);

  const handleChange = (key: keyof EnvConfig, value: string | boolean) => {
    setLocalEnv({ ...localEnv, [key]: value });
    setDirty(true);
  };

  const handleSave = () => { setEnv(localEnv); saveEnv().then(() => setDirty(false)); };

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Server */}
      <Section title="Server">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Host"><Input value={localEnv.HOST || '127.0.0.1'} onChange={e => handleChange('HOST', e.target.value)} /></Field>
          <Field label="Port"><Input type="number" value={localEnv.PORT || '8787'} onChange={e => handleChange('PORT', e.target.value)} /></Field>
        </div>
        <Field label="Proxy API Key" hint="Set this so Codex requires the same key">
          <Input type="password" value={localEnv.PROXY_API_KEY || ''} onChange={e => handleChange('PROXY_API_KEY', e.target.value)} placeholder="local-codex-proxy-key" />
        </Field>
      </Section>

      {/* Upstream */}
      <Section title="Upstream">
        <div className="bg-muted/40 border border-border/50 rounded-md p-3 mb-2">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Provider Preset and API Key are managed from the <span className="font-medium text-foreground">Providers</span> tab.
            Use the radio toggle in the sidebar to switch active providers.
          </p>
        </div>
        <Field label="Provider Preset" hint="Managed from Providers tab">
          <div className="flex items-center gap-2">
            <Input
              value={localEnv.PROVIDER_PRESET || ''}
              readOnly
              className="bg-muted/50 text-muted-foreground cursor-default font-mono text-xs"
            />
            {localEnv.PROVIDER_PRESET && providers[localEnv.PROVIDER_PRESET] && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-primary/10 text-primary whitespace-nowrap flex-shrink-0">
                {providers[localEnv.PROVIDER_PRESET].name}
              </span>
            )}
          </div>
        </Field>
        <Field label="Target API Key" hint="Synced from active provider's API Key">
          <Input
            type="password"
            value={localEnv.TARGET_API_KEY || ''}
            readOnly
            className="bg-muted/50 text-muted-foreground cursor-default font-mono text-xs"
          />
        </Field>
        <Field label="Request Timeout (ms)">
          <Input type="number" value={localEnv.REQUEST_TIMEOUT_MS || '600000'} onChange={e => handleChange('REQUEST_TIMEOUT_MS', e.target.value)} />
        </Field>
      </Section>

      {/* Advanced */}
      <Section title="Advanced">
        <div className="flex items-center justify-between py-1">
          <div>
            <Label className="text-sm">Log Upstream Requests</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Log all upstream API requests for debugging</p>
          </div>
          <Switch checked={localEnv.LOG_UPSTREAM_REQUEST === '1'} onChange={e => handleChange('LOG_UPSTREAM_REQUEST', e.target.checked ? '1' : '')} />
        </div>
      </Section>

      <Button className="w-full" onClick={() => { handleSave(); setTimeout(() => startService(), 500); }} disabled={!dirty}>
        <Save className="w-3.5 h-3.5" /> Save & Restart
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border">
      <CardHeader className="py-3 px-5 border-b border-border/50"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent className="p-5 space-y-3">{children}</CardContent>
    </Card>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        {label}
        {required && <AlertTriangle className="w-3 h-3 text-destructive" />}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}
