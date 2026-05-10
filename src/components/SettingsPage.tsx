import { useEffect, useState } from 'react';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getStoredTheme, toggleTheme } from '@/lib/theme';

const SaveIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>);
const EyeIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>);
const EyeOffIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><line x1="1" x2="23" y1="1" y2="23"/></svg>);

const THEMES = [
  { id: 'dark', label: '深色', ring: 'bg-slate-800' },
  { id: 'light', label: '浅色', ring: 'bg-white border' },
];

export default function SettingsPage() {
  const { env, service, saveEnv, stopService, startService } = useAppStore();
  const [local, setLocal] = useState<Record<string, string>>({ ...(env as Record<string, string>) });
  const [theme, setTheme] = useState(getStoredTheme());
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => { setLocal({ ...(env as Record<string, string>) }); }, [env]);

  const handleSave = async () => {
    useAppStore.getState().setEnv(local);
    await api.env.write(local);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    if (service.running && service.pid) { await stopService(); await startService(); }
  };

  const setF = (k: string, v: string) => setLocal(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-6 max-w-2xl">
      <div><h1 className="text-lg font-extrabold">设置</h1><p className="text-[13px] text-muted-foreground mt-0.5">配置代理服务和外观</p></div>

      {/* Server Settings */}
      <div className="settings-panel">
        <div className="px-5 py-4 border-b border-border/30"><h2 className="text-sm font-bold">服务配置</h2></div>
        <div className="settings-row"><span className="settings-label">监听地址</span><Input className="h-8 text-xs font-mono w-44" value={local.HOST || '127.0.0.1'} onChange={e => setF('HOST', e.target.value)} /></div>
        <div className="settings-row"><span className="settings-label">端口</span><Input className="h-8 text-xs font-mono w-28" value={local.PORT || '8088'} onChange={e => setF('PORT', e.target.value)} /></div>
        <div className="settings-row"><span className="settings-label">代理 API Key</span>
          <div className="relative">
            <Input className="h-8 text-xs font-mono w-48 pr-8" type={showKey ? 'text' : 'password'} value={local.PROXY_API_KEY || ''} onChange={e => setF('PROXY_API_KEY', e.target.value)} placeholder="可选" />
            <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
              {showKey ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>
        <div className="settings-row"><span className="settings-label">请求超时 (ms)</span><Input className="h-8 text-xs font-mono w-28" value={local.REQUEST_TIMEOUT_MS || '600000'} onChange={e => setF('REQUEST_TIMEOUT_MS', e.target.value)} /></div>
      </div>

      {/* Advanced Settings */}
      <div className="settings-panel">
        <div className="px-5 py-4 border-b border-border/30"><h2 className="text-sm font-bold">高级配置</h2></div>
        <div className="settings-row"><span className="settings-label">最大请求体 (MB)</span><Input className="h-8 text-xs font-mono w-24" value={local.MAX_REQUEST_BODY_SIZE ? String(Number(local.MAX_REQUEST_BODY_SIZE) / 1048576) : '25'} onChange={e => { const mb = parseFloat(e.target.value) || 25; setF('MAX_REQUEST_BODY_SIZE', String(mb * 1048576)); }} /></div>
      </div>

      {/* Theme */}
      <div className="settings-panel">
        <div className="px-5 py-4 border-b border-border/30"><h2 className="text-sm font-bold">外观</h2></div>
        <div className="px-5 py-4 flex items-center gap-3">
          {THEMES.map(t => (
            <button key={t.id} onClick={() => { if (t.id !== theme) setTheme(toggleTheme()); }}
              className={cn('flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-semibold transition-all duration-150',
                theme === t.id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-primary/20')}>
              <span className={cn('w-4 h-4 rounded-full', t.ring, theme === t.id && 'ring-2 ring-primary ring-offset-1 ring-offset-card')} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={handleSave}><SaveIcon /> {saved ? '已保存' : '保存并重启服务'}</Button>
        {saved && <span className="text-xs text-emerald-400 font-semibold">✓ 配置已保存</span>}
      </div>

      {/* About */}
      <div className="settings-panel">
        <div className="px-5 py-4 border-b border-border/30"><h2 className="text-sm font-bold">关于</h2></div>
        <div className="settings-row"><span className="settings-label">版本</span><span className="text-sm font-semibold">1.0.0</span></div>
        <div className="settings-row"><span className="settings-label">代理服务器</span><span className="text-sm font-mono">{service.running ? `Node.js :${service.port}` : '未运行'}</span></div>
        <div className="settings-row"><span className="settings-label">支持协议</span><span className="text-sm">OpenAI Responses / Chat Completions</span></div>
      </div>
    </div>
  );
}
