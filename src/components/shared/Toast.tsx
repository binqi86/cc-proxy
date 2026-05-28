import { cn } from '@/lib/utils';
import type { Toast as ToastType } from '@/hooks';

export function Toast({ toast }: { toast: ToastType | null }) {
  if (!toast) return null;
  return (
    <div className={cn(
      'fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg text-[12px] font-semibold shadow-lg animate-fade-in transition-all duration-300',
      toast.type === 'success' ? 'bg-emerald-500/90 text-white'
        : toast.type === 'error' ? 'bg-destructive/90 text-white'
        : 'bg-blue-500/90 text-white'
    )}>
      {toast.message}
    </div>
  );
}
