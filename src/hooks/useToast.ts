import { useState, useEffect, useRef } from 'react';

export interface Toast {
  message: string;
  type: 'success' | 'error' | 'info';
}

/** Simple auto-dismissing toast state. */
export function useToast(duration = 4000) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!toast) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), duration);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [toast, duration]);

  return { toast, showToast: setToast, clearToast: () => setToast(null) };
}
