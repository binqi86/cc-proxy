import { useEffect, useState, useRef } from 'react';
import useAppStore from '@/store/appStore';
import { cn } from '@/lib/utils';

export default function ToolsPage() {
  const { localizationStatus, loading, loadLocalizationStatus, applyLocalization, restoreLocalization, toast } = useAppStore();
  const [actionBtn, setActionBtn] = useState<string | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const status = localizationStatus;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadLocalizationStatus(); }, [loadLocalizationStatus]);

  // Local toast for tools page
  const [localToast, setLocalToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const displayToast = toast || localToast;

  useEffect(() => {
    if (displayToast) {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setLocalToast(null), 5000);
      return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
    }
  }, [displayToast]);

  // Action button feedback auto-reset
  useEffect(() => {
    if (actionBtn) {
      const t = setTimeout(() => setActionBtn(null), 2000);
      return () => clearTimeout(t);
    }
  }, [actionBtn]);

  const handleApply = async () => {
    if (status?.is_claude_running) {
      setLocalToast({ message: '请先退出 Claude Desktop 再汉化', type: 'error' });
      return;
    }
    setActionBtn('apply');
    try {
      await applyLocalization();
    } catch {
      setLocalToast({ message: '汉化失败，请查看日志', type: 'error' });
    }
  };

  const handleRestore = async () => {
    if (!restoreConfirm) {
      setRestoreConfirm(true);
      return;
    }
    setRestoreConfirm(false);
    setActionBtn('restore');
    try {
      await restoreLocalization();
    } catch {
      setLocalToast({ message: '恢复失败，请查看日志', type: 'error' });
    }
  };

  const handleRefresh = () => loadLocalizationStatus();

  /* ── Icons ── */
  const GlobeIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>);
  const RefreshIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>);

  return (
    <div className="space-y-6">
      {displayToast && (
        <div className={cn(
          'fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg text-[12px] font-semibold shadow-lg transition-all duration-300',
          displayToast.type === 'success' ? 'bg-emerald-500/90 text-white' : displayToast.type === 'error' ? 'bg-destructive/90 text-white' : 'bg-blue-500/90 text-white'
        )}>
          {displayToast.message}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-extrabold">工具</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">实用集成工具</p>
        </div>
      </div>

      {/* ── Claude Chinese Localization ── */}
      <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">Claude 一键汉化</h2>
        <div className="panel overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/30">
            <div className="flex items-center gap-3">
              <div className={cn(
                'grid place-items-center rounded-full w-10 h-10',
                status?.is_patched ? 'bg-emerald-500/15 text-emerald-400' : status?.error ? 'bg-destructive/10 text-destructive' : 'bg-blue-500/15 text-blue-400'
              )}>
                <GlobeIcon />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold">
                    {status?.is_patched ? '已汉化' : status?.error ? '未检测到 Claude' : '未汉化'}
                  </span>
                  {status?.claude_version && (
                    <span className="text-[11px] text-muted-foreground">v{status.claude_version}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {status?.is_claude_running && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-400">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      Claude 正在运行
                    </span>
                  )}
                  {status?.has_backup && (
                    <span className="text-[10px] text-muted-foreground">已备份原版</span>
                  )}
                  {status?.error && (
                    <span className="text-[10px] text-destructive">{status.error}</span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={handleRefresh} disabled={loading}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30" title="刷新状态">
              <RefreshIcon />
            </button>
          </div>

          {/* Actions */}
          <div className="px-5 py-4 space-y-3">
            {/* Info */}
            <div className="text-[11px] text-muted-foreground bg-muted/30 rounded-lg px-3 py-2 space-y-1">
              <p>• 汉化会将 Claude Desktop 界面替换为简体中文</p>
              <p>• 应用前会自动备份原版，支持一键恢复</p>
              <p>• 汉化需要管理员权限写入 /Applications/Claude.app</p>
              <p className="text-amber-400">• 汉化前请确保 Claude Desktop 已退出</p>
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              {!status?.is_patched ? (
                <button
                  onClick={handleApply}
                  disabled={loading || !!status?.error}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-200 disabled:opacity-50',
                    actionBtn === 'apply'
                      ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30'
                      : 'text-white bg-blue-500 hover:bg-blue-600'
                  )}
                >
                  {loading && actionBtn === 'apply' ? (
                    <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <GlobeIcon />
                  )}
                  {actionBtn === 'apply' ? '汉化中...' : '一键汉化'}
                </button>
              ) : (
                <button
                  onClick={handleRestore}
                  disabled={loading}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-200 disabled:opacity-50',
                    restoreConfirm
                      ? 'text-white bg-destructive hover:bg-destructive/90'
                      : actionBtn === 'restore'
                        ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/30'
                        : 'text-foreground bg-muted hover:bg-muted/80 border border-border'
                  )}
                >
                  {loading && actionBtn === 'restore' ? (
                    <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : null}
                  {restoreConfirm ? '确认恢复原版？' : actionBtn === 'restore' ? '恢复中...' : '恢复原版'}
                </button>
              )}
              {restoreConfirm && (
                <button onClick={() => setRestoreConfirm(false)}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1">
                  取消
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── More tools placeholder ── */}
      <section>
        <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2.5">更多工具</h2>
        <div className="panel p-8 text-center">
          <div className="text-4xl mb-4 opacity-20">🛠️</div>
          <p className="text-sm text-muted-foreground">更多实用工具即将推出</p>
          <p className="text-[11px] text-muted-foreground mt-2">API 测试、模型测速、余额监控等功能即将上线</p>
        </div>
      </section>
    </div>
  );
}
