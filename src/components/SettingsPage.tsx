import { useEffect, useState } from 'react';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getStoredTheme, toggleTheme } from '@/lib/theme';
import { SaveIcon, EyeIcon, EyeOffIcon } from '@/lib/icons';
import { Toggle } from '@/components/shared';
import { version as appVersion } from '../../package.json';

export default function SettingsPage() {
  const { env, service, stopService, startService } = useAppStore();
  const [local, setLocal] = useState<Record<string, string>>({ ...(env as Record<string, string>) });
  const [theme, setTheme] = useState(getStoredTheme());
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [needsReapply, setNeedsReapply] = useState(false);

  useEffect(() => { setLocal({ ...(env as Record<string, string>) }); }, [env]);

  const handleSave = async () => {
    const oldKey = (env.PROXY_API_KEY || '').trim();
    const newKey = (local.PROXY_API_KEY || '').trim();
    useAppStore.getState().setEnv(local);
    await api.env.write(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    if (service.running && service.pid) { await stopService(); await startService(); }
    setNeedsReapply(oldKey !== newKey);
  };

  const setF = (k: string, v: string) => setLocal(p => ({ ...p, [k]: v }));

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-lg font-extrabold">设置</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">配置代理服务和外观</p>
      </div>

      {/* Server */}
      <div className="settings-panel">
        <div className="px-5 py-4 border-b border-border/30"><h2 className="text-sm font-bold">服务配置</h2></div>
        <div className="settings-row"><span className="settings-label">监听地址</span><Input className="h-8 text-xs font-mono w-44" value={local.HOST || '127.0.0.1'} onChange={e => setF('HOST', e.target.value)} /></div>
        <div className="settings-row"><span className="settings-label">端口</span><Input className="h-8 text-xs font-mono w-28" value={local.PORT || '8088'} onChange={e => setF('PORT', e.target.value)} /></div>
        <div className="settings-row">
          <span className="settings-label">代理 API Key</span>
          <div className="relative">
            <Input className="h-8 text-xs font-mono w-48 pr-8" type={showKey ? 'text' : 'password'} value={local.PROXY_API_KEY || ''} onChange={e => setF('PROXY_API_KEY', e.target.value)} placeholder="可选" />
            <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
              {showKey ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>
        <div className="settings-row"><span className="settings-label">请求超时 (ms)</span><Input className="h-8 text-xs font-mono w-28" value={local.REQUEST_TIMEOUT_MS || '600000'} onChange={e => setF('REQUEST_TIMEOUT_MS', e.target.value)} /></div>
      </div>

      {/* Advanced */}
      <div className="settings-panel">
        <div className="px-5 py-4 border-b border-border/30"><h2 className="text-sm font-bold">高级配置</h2></div>
        <div className="settings-row">
          <span className="settings-label">最大请求体 (MB)</span>
          <Input className="h-8 text-xs font-mono w-24" value={local.MAX_REQUEST_BODY_SIZE ? String(Number(local.MAX_REQUEST_BODY_SIZE) / 1048576) : '25'} onChange={e => { const mb = parseFloat(e.target.value) || 25; setF('MAX_REQUEST_BODY_SIZE', String(mb * 1048576)); }} />
        </div>
        <div className="settings-row">
          <span className="settings-label">调试日志</span>
          <div className="flex items-center gap-2">
            <Toggle checked={local.DEBUG_REASONING === '1'} onChange={() => setF('DEBUG_REASONING', local.DEBUG_REASONING === '1' ? '0' : '1')} />
            <span className="text-xs text-muted-foreground">{local.DEBUG_REASONING === '1' ? '已开启' : '已关闭'}</span>
          </div>
        </div>
      </div>

      {/* Theme */}
      <div className="settings-panel">
        <div className="px-5 py-4 border-b border-border/30"><h2 className="text-sm font-bold">外观</h2></div>
        <div className="px-5 py-4 flex items-center gap-3">
          {[{ id: 'dark', label: '深色', ring: 'bg-slate-800' }, { id: 'light', label: '浅色', ring: 'bg-white border' }].map(t => (
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
      {needsReapply && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          代理 API Key 已变更。请重新应用 Claude Desktop 和 Codex 配置。
        </div>
      )}

      {/* About */}
      <div className="settings-panel">
        <div className="px-5 py-4 border-b border-border/30"><h2 className="text-sm font-bold">关于</h2></div>
        <div className="settings-row"><span className="settings-label">版本</span><span className="text-sm font-semibold">{appVersion}</span></div>
        <div className="settings-row"><span className="settings-label">代理服务器</span><span className="text-sm font-mono">{service.running ? `Node.js :${service.port}` : '未运行'}</span></div>
        <div className="settings-row"><span className="settings-label">支持协议</span><span className="text-sm">OpenAI Responses / Chat Completions / Anthropic Messages</span></div>
      </div>
    </div>
  );
}
