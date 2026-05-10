import { useEffect, useRef, useState } from 'react';
import useAppStore from '@/store/appStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AppStats } from '@/lib/config';

const PlayIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 3"/></svg>);
const StopIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>);
const TrashIcon = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg>);

export default function ProxyPage() {
  const { service, logs, startService, stopService, clearLogs } = useAppStore();
  const [stats, setStats] = useState<AppStats>({ running: false, request_count: 0 });
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => { try { setStats(await api.service.getStats()); } catch { /* */ } };
    load(); const i = setInterval(load, 3000); return () => clearInterval(i);
  }, []);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs.length]);

  return (
    <div className="space-y-4">
      <div><h1 className="text-lg font-extrabold">代理</h1><p className="text-[13px] text-muted-foreground mt-0.5">控制本地代理服务和查看实时日志</p></div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-3">
        <StatBox icon="dot" label="状态" value={service.running ? '运行中' : '已停止'} active={service.running} />
        <StatBox icon="port" label="端口" value={service.port ? String(service.port) : '—'} />
        <StatBox icon="count" label="请求次数" value={String(stats.request_count)} />
        <StatBox icon="pid" label="进程 PID" value={service.pid ? String(service.pid) : '—'} />
      </div>

      {/* Control Bar */}
      <div className="flex items-center gap-4 px-5 py-4 panel">
        <div className={cn('grid place-items-center w-12 h-12 rounded-full flex-shrink-0', service.running ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground')}>
          {service.running ? (
            <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400"/></span>
          ) : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/></svg>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold">{service.running ? `代理运行在 :${service.port}` : '代理未启动'}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{service.running ? `已处理 ${stats.request_count} 个请求` : '点击按钮启动 Codex 本地代理'}</div>
        </div>
        <button onClick={() => service.running ? stopService() : startService()} className={cn('flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-150', service.running ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20' : 'text-white')} style={service.running ? {} : { background: 'rgb(var(--primary))' }}>
          {service.running ? <><StopIcon />停止</> : <><PlayIcon />启动</>}
        </button>
        <button onClick={clearLogs} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><TrashIcon />清空</button>
      </div>

      {/* Terminal Log */}
      <div className="terminal-panel">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-500/60"/><span className="w-2.5 h-2.5 rounded-full bg-amber-500/60"/><span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60"/></div>
          <span className="text-[10px] text-slate-500 font-mono">proxy.log</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-4 font-mono text-[13px] leading-relaxed" style={{ fontFamily: "'Fira Code', monospace" }}>
          {!logs.length ? (
            <div className="text-slate-600 py-8 text-center">等待代理事件...</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-3 py-0.5">
                <span className={cn('text-[11px] flex-shrink-0', log.level === 'success' ? 'text-emerald-400' : log.level === 'error' ? 'text-red-400' : log.level === 'warning' ? 'text-amber-400' : 'text-blue-400')}>
                  {log.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={cn('flex-shrink-0 w-10 text-[11px]', log.level === 'success' ? 'text-emerald-500' : log.level === 'error' ? 'text-red-500' : log.level === 'warning' ? 'text-amber-500' : 'text-blue-500')}>
                  {log.level.toUpperCase()}
                </span>
                <span className="text-slate-300 break-all">{log.message}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, active }: { icon: string; label: string; value: string; active?: boolean }) {
  return (
    <div className="flex items-center gap-3 p-4 panel">
      <div className={cn('grid place-items-center w-10 h-10 rounded-full flex-shrink-0', active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground')}>
        {active ? (
          <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400"/></span>
        ) : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>}
      </div>
      <div><p className="text-[11px] text-muted-foreground">{label}</p><p className="text-base font-extrabold">{value}</p></div>
    </div>
  );
}
