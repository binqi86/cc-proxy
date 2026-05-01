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
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  const iconMap: Record<LogEntry['level'], React.ReactNode> = {
    success: <CheckCircle2 className="w-4 h-4 text-primary" />,
    error: <XCircle className="w-4 h-4 text-destructive" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-400" />,
    info: <Activity className="w-4 h-4 text-muted-foreground" />,
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Service Status" value={service.running ? 'Running' : 'Stopped'} accent={service.running ? 'text-primary' : 'text-muted-foreground'} />
        <StatCard label="Requests" value={String(logs.length)} />
        <StatCard label="Avg Latency" value={service.running ? '—' : '—'} />
      </div>

      {/* Logs */}
      <Card className="flex-1 flex flex-col border-border min-h-0">
        <CardHeader className="flex flex-row items-center justify-between py-3 px-5 border-b border-border/50">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live Logs</CardTitle>
          {logs.length > 0 && (
            <Button size="sm" variant="ghost" onClick={clearLogs}><Trash2 className="w-3.5 h-3.5" /> Clear</Button>
          )}
        </CardHeader>
        <CardContent className="flex-1 p-0 min-h-0">
          <ScrollArea ref={scrollRef} className="h-full max-h-[calc(100vh-340px)]">
            {logs.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Activity className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No logs yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex-shrink-0 mt-0.5">{iconMap[log.level]}</div>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">{formatDate(log.timestamp)}</span>
                        {log.latency && <span className="text-[11px] text-muted-foreground">{formatLatency(log.latency)}</span>}
                      </div>
                      <p className="text-[13px] break-words">{log.message}</p>
                      {log.data && <pre className="text-[11px] bg-muted p-2 rounded mt-1 overflow-x-auto">{JSON.stringify(log.data, null, 2)}</pre>}
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
    <Card className="border-border">
      <CardContent className="flex flex-col items-center justify-center py-5">
        <span className={`text-xl font-semibold tracking-tight ${accent || 'text-foreground'}`}>{value}</span>
        <span className="text-[11px] text-muted-foreground mt-1">{label}</span>
      </CardContent>
    </Card>
  );
}
