import { useState, useEffect } from 'react';
import useAppStore from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Save } from '@/components/icons';
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
    <div className="space-y-5 max-w-2xl">
      {/* Server */}
      <Section title="服务器">
        <div className="grid grid-cols-2 gap-4">
          <Field label="主机地址">
            <Input value={localEnv.HOST || '127.0.0.1'} onChange={e => handleChange('HOST', e.target.value)} />
          </Field>
          <Field label="端口">
            <Input type="number" value={localEnv.PORT || '8787'} onChange={e => handleChange('PORT', e.target.value)} />
          </Field>
        </div>
        <Field label="代理 API 密钥" hint="设置后 Codex 需要提供相同的密钥才能使用代理">
          <Input type="password" value={localEnv.PROXY_API_KEY || ''} onChange={e => handleChange('PROXY_API_KEY', e.target.value)} placeholder="local-codex-proxy-key" />
        </Field>
      </Section>

      {/* Upstream */}
      <Section title="上游服务">
        <div className="bg-muted/30 border border-border/50 rounded-lg p-3 text-[11px] text-muted-foreground leading-relaxed">
          供应商和 API 密钥由<span className="font-medium text-foreground">供应商管理</span>页面统一配置。
          使用侧边栏的开关即可切换活跃供应商。
        </div>
        <Field label="供应商预设" hint="由供应商管理页面配置">
          <div className="flex items-center gap-2">
            <Input
              value={localEnv.PROVIDER_PRESET || ''}
              readOnly
              className="bg-muted/50 text-muted-foreground cursor-default font-mono text-xs"
            />
            {localEnv.PROVIDER_PRESET && providers[localEnv.PROVIDER_PRESET] && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-primary/10 text-primary whitespace-nowrap flex-shrink-0">
                {providers[localEnv.PROVIDER_PRESET].name}
              </span>
            )}
          </div>
        </Field>
        <Field label="目标 API 密钥" hint="同步自活跃供应商的 API 密钥">
          <Input
            type="password"
            value={localEnv.TARGET_API_KEY || ''}
            readOnly
            className="bg-muted/50 text-muted-foreground cursor-default font-mono text-xs"
          />
        </Field>
        <Field label="请求超时 (毫秒)">
          <Input type="number" value={localEnv.REQUEST_TIMEOUT_MS || '600000'} onChange={e => handleChange('REQUEST_TIMEOUT_MS', e.target.value)} />
        </Field>
      </Section>

      {/* Advanced */}
      <Section title="高级设置">
        <div className="flex items-center justify-between py-1">
          <div>
            <Label className="text-sm">记录上游请求详情</Label>
            <p className="text-xs text-muted-foreground mt-0.5">开启后在日志中显示请求参数等调试信息</p>
          </div>
          <Switch checked={localEnv.LOG_UPSTREAM_REQUEST === '1'} onChange={e => handleChange('LOG_UPSTREAM_REQUEST', e.target.checked ? '1' : '')} />
        </div>
      </Section>

      <Button className="w-full h-10" onClick={() => { handleSave(); setTimeout(() => startService(), 500); }} disabled={!dirty}>
        <Save className="w-4 h-4" /> 保存并重启服务
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border rounded-xl overflow-hidden">
      <CardHeader className="py-3 px-5 border-b border-border/50">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-4">{children}</CardContent>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/60">{hint}</p>}
    </div>
  );
}
