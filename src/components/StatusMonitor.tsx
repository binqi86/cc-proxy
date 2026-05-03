import { useEffect, useRef } from 'react';
import useAppStore from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, AlertTriangle, Activity, Trash2 } from '@/components/icons';
import { formatDate, formatLatency } from '@/lib/utils';
import type { LogEntry } from '@/lib/config';

export default function StatusMonitor() {
  const { service, logs, clearLogs } = useAppStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // newest first, scroll to top
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [logs]);

  const iconMap: Record<LogEntry['level'], React.ReactNode> = {
    success: <CheckCircle2 className="w-4 h-4 text-primary" />,
    error: <XCircle className="w-4 h-4 text-destructive" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-400" />,
    info: <Activity className="w-4 h-4 text-muted-foreground" />,
  };

  const levelLabel: Record<LogEntry['level'], string> = {
    success: '成功',
    error: '错误',
    warning: '警告',
    info: '信息',
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="服务状态"
          value={service.running ? '运行中' : '已停止'}
          accent={service.running ? 'text-primary' : 'text-muted-foreground'}
        />
        <StatCard label="日志条数" value={String(logs.length)} />
        <StatCard
          label="成功 / 失败"
          value={`${logs.filter(l => l.level === 'success').length} / ${logs.filter(l => l.level === 'error').length}`}
        />
      </div>

      {/* Logs */}
      <Card className="flex-1 flex flex-col border-border rounded-xl min-h-0 overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between py-3 px-5 border-b border-border/50 shrink-0">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">实时日志</CardTitle>
          {logs.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearLogs}>
              <Trash2 className="w-3.5 h-3.5" /> 清空
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex-1 p-0 min-h-0">
          <ScrollArea ref={scrollRef} className="h-full">
            {logs.length === 0 ? (
              <div className="py-20 text-center text-muted-foreground">
                <Activity className="w-8 h-8 mx-auto mb-3 opacity-20" />
                <p className="text-sm">暂无日志</p>
                <p className="text-xs mt-1 opacity-60">启动服务后将在此显示运行日志</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {[...logs].reverse().map((log) => (
                  <div key={log.id} className="flex gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex-shrink-0 mt-0.5">{iconMap[log.level]}</div>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">{formatDate(log.timestamp)}</span>
                        <span className="text-[10px] text-muted-foreground/50">[{levelLabel[log.level]}]</span>
                        {log.latency && <span className="text-[10px] text-muted-foreground">{formatLatency(log.latency)}</span>}
                      </div>
                      <p className="text-[13px] break-words">{log.message}</p>
                      {log.data && <pre className="text-[11px] bg-muted/50 p-2.5 rounded-lg mt-1 overflow-x-auto">{JSON.stringify(log.data, null, 2)}</pre>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card className="border-border rounded-xl">
      <CardContent className="flex flex-col items-center justify-center py-5">
        <span className={`text-xl font-bold tracking-tight ${accent || 'text-foreground'}`}>{value}</span>
        <span className="text-[11px] text-muted-foreground mt-1">{label}</span>
      </CardContent>
    </Card>
  );
}
