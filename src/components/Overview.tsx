import { useEffect, useState } from 'react';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { CheckCircle2, XCircle, AlertTriangle, Activity } from '@/components/icons';
import { formatDate, formatLatency } from '@/lib/utils';
import type { AppStats, LogEntry } from '@/lib/config';

export default function Overview() {
  const { service, providers, env, logs, startService, stopService } = useAppStore();
  const [stats, setStats] = useState<AppStats>({ running: false, request_count: 0 });
  const activeProviderId = (env as Record<string, string>).PROVIDER_PRESET || '';
  const activeProvider = providers[activeProviderId];
  const logUpstream = (env as Record<string, string>).LOG_UPSTREAM_REQUEST === '1';

  useEffect(() => {
    const load = async () => {
      try {
        const s = await api.service.getStats();
        setStats(s);
      } catch { /* ignore */ }
    };
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleLog = async () => {
    const next = !logUpstream;
    const newEnv = { ...env, LOG_UPSTREAM_REQUEST: next ? '1' : '' };
    useAppStore.getState().setEnv(newEnv);
    await api.env.write(newEnv as Record<string, string>);
  };

  const recentLogs = logs.slice(-5).reverse();

  const iconMap: Record<LogEntry['level'], React.ReactNode> = {
    success: <CheckCircle2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />,
    error: <XCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />,
    warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />,
    info: <Activity className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />,
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Status Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-border overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${service.running ? 'bg-primary/15' : 'bg-muted'}`}>
                <span className={`inline-block w-3 h-3 rounded-full ${service.running ? 'bg-primary shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-muted-foreground/40'}`}>
                  {service.running && <span className="absolute inline-flex w-3 h-3 rounded-full bg-primary animate-ping opacity-75" />}
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight">{service.running ? '运行中' : '已停止'}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {service.running ? `端口 ${service.port || '—'}` : '服务未启动'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight">{stats.request_count}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">请求次数</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border overflow-hidden">
          <CardContent className="p-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight">
                  {logs.length > 0
                    ? `${Math.round(logs.reduce((sum, l) => sum + (l.latency || 0), 0) / logs.filter(l => l.latency).length || 0)}ms`
                    : '—'}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">平均延迟</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-4">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">快速操作</h3>

          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium">服务开关</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {service.running ? '点击停止代理服务' : '点击启动代理服务'}
              </p>
            </div>
            <button
              onClick={() => service.running ? stopService() : startService()}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all duration-150 ${
                service.running
                  ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
            >
              {service.running ? '停止' : '启动'}
            </button>
          </div>

          <div className="flex items-center justify-between py-1" style={{ borderTop: '1px solid rgb(var(--border) / 0.5)' }}>
            <div>
              <p className="text-sm font-medium">活跃供应商</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {activeProvider ? activeProvider.name : '未选择'}
              </p>
            </div>
            <Badge variant="outline" className="text-[11px]">
              {activeProviderId || '无'}
            </Badge>
          </div>

          <div className="flex items-center justify-between py-1" style={{ borderTop: '1px solid rgb(var(--border) / 0.5)' }}>
            <div>
              <p className="text-sm font-medium">记录上游请求详情</p>
              <p className="text-xs text-muted-foreground mt-0.5">开启后在日志中显示请求参数等调试信息</p>
            </div>
            <Switch checked={logUpstream} onChange={handleToggleLog} />
          </div>
        </CardContent>
      </Card>

      {/* Recent Logs */}
      <Card className="border-border">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              最近日志
            </h3>
            {logs.length > 0 && (
              <button
                onClick={() => useAppStore.getState().clearLogs()}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                清空
              </button>
            )}
          </div>
          {recentLogs.length === 0 ? (
            <div className="py-10 text-center">
              <Activity className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="text-xs text-muted-foreground">暂无日志</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {recentLogs.map((log) => (
                <div key={log.id} className="flex gap-2.5 py-2.5 first:pt-0 last:pb-0">
                  <div className="mt-0.5">{iconMap[log.level]}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] text-muted-foreground">{formatDate(log.timestamp)}</span>
                      {log.latency && <span className="text-[10px] text-muted-foreground">{formatLatency(log.latency)}</span>}
                    </div>
                    <p className="text-[12px] truncate">{log.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
