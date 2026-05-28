import { cn } from '@/lib/utils';

/** Animated status indicator dot */
export function StatusDot({ active, size = 'md' }: { active: boolean; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';
  return (
    <span className={cn('relative flex', dim)}>
      {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
      <span className={cn('relative inline-flex rounded-full', dim, active ? 'bg-emerald-400' : 'bg-slate-500')} />
    </span>
  );
}
