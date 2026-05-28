import { useEffect, useState } from 'react';
import useAppStore from '@/store/appStore';
import { cn } from '@/lib/utils';
import { GlobeIcon, RefreshIcon } from '@/lib/icons';
import { Toast } from '@/components/shared';
import { useToast } from '@/hooks';

export default function ToolsPage() {
  const { localizationStatus, loading, loadLocalizationStatus, applyLocalization, restoreLocalization, toast: storeToast } = useAppStore();
  const { toast: localToast, showToast } = useToast(5000);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const status = localizationStatus;
  const displayToast = storeToast || localToast;

  useEffect(() => { loadLocalizationStatus(); }, [loadLocalizationStatus]);

  const handleApply = async () => {
    if (status?.is_claude_running) { showToast({ message: '请先退出 Claude Desktop 再汉化', type: 'error' }); return; }
    try { await applyLocalization(); } catch { showToast({ message: '汉化失败', type: 'error' }); }
  };

  const handleRestore = async () => {
    if (!restoreConfirm) { setRestoreConfirm(true); return; }
    setRestoreConfirm(false);
    if (status?.is_claude_running) { showToast({ message: '请先退出 Claude Desktop', type: 'error' }); return; }
    try { await restoreLocalization(); } catch { showToast({ message: '恢复失败', type: 'error' }); }
  };

  return (
    <div className="space-y-6">
      <Toast toast={displayToast} />

      <div>
        <h1 className="text-lg font-extrabold">工具</h1>
        <p className="text-[13px] text-muted-foreground mt-0.5">实用集成工具</p>
      </div>

      {/* Claude Localization */}
      <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">Claude 一键汉化</h2>
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/30">
            <div className="flex items-center gap-3">
              <div className={cn('grid place-items-center rounded-full w-10 h-10',
                status?.is_patched ? 'bg-emerald-500/15 text-emerald-400' : status?.error ? 'bg-destructive/10 text-destructive' : 'bg-blue-500/15 text-blue-400')}>
                <GlobeIcon />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold">{status?.is_patched ? '已汉化' : status?.error ? '未检测到 Claude' : '未汉化'}</span>
                  {status?.claude_version && <span className="text-[11px] text-muted-foreground">v{status.claude_version}</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {status?.is_claude_running && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />Claude 正在运行
                    </span>
                  )}
                  {status?.has_backup && <span className="text-[10px] text-muted-foreground">已备份原版</span>}
                  {status?.error && <span className="text-[10px] text-destructive">{status.error}</span>}
                </div>
              </div>
            </div>
            <button onClick={() => loadLocalizationStatus()} disabled={loading}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30">
              <RefreshIcon />
            </button>
          </div>

          <div className="px-5 py-4 space-y-3">
            <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 space-y-1">
              <p>• 汉化会将 Claude Desktop 界面替换为简体中文</p>
              <p>• 应用前会自动备份原版，支持一键恢复</p>
              <p className="text-amber-400">• 汉化前请确保 Claude Desktop 已退出</p>
            </div>

            <div className="flex items-center gap-2">
              {!status?.is_patched ? (
                <button onClick={handleApply} disabled={loading || !!status?.error}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 transition-all">
                  <GlobeIcon width={16} height={16} /> 一键汉化
                </button>
              ) : (
                <button onClick={handleRestore} disabled={loading}
                  className={cn('inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all disabled:opacity-50',
                    restoreConfirm ? 'text-white bg-destructive' : 'text-foreground bg-muted border border-border')}>
                  {restoreConfirm ? '确认恢复原版？' : '恢复原版'}
                </button>
              )}
              {restoreConfirm && (
                <button onClick={() => setRestoreConfirm(false)} className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1">取消</button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Placeholder */}
      <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">更多工具</h2>
        <div className="panel p-8 text-center">
          <div className="text-4xl mb-4 opacity-20">🛠️</div>
          <p className="text-sm text-muted-foreground">更多实用工具即将推出</p>
        </div>
      </section>
    </div>
  );
}
