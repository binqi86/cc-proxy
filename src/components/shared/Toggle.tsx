import { cn } from '@/lib/utils';

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function Toggle({ checked, onChange, disabled, size = 'md' }: ToggleProps) {
  const h = size === 'sm' ? 'h-5 w-8' : 'h-6 w-10';
  const dot = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const translate = size === 'sm' ? 'translate-x-3.5' : 'translate-x-5';

  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex items-center rounded-full transition-colors flex-shrink-0 disabled:opacity-30',
        h,
        checked ? 'bg-emerald-500' : 'bg-border'
      )}
    >
      <span className={cn(
        'inline-block rounded-full bg-white transition-transform',
        dot,
        checked ? translate : 'translate-x-0.5'
      )} />
    </button>
  );
}
