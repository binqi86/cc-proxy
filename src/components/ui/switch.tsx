import * as React from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, checked, onChange, disabled, ...props }, ref) => {
    return (
      <label className={cn('flex items-center gap-2 cursor-pointer', disabled && 'cursor-not-allowed opacity-50')}>
        <div className="relative">
          <input
            type="checkbox"
            ref={ref}
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            className="sr-only"
            {...props}
          />
          <div
            className={cn(
              'peer h-5 w-9 rounded-full border-2 transition-colors',
              checked ? 'bg-accent border-accent' : 'bg-muted border-input',
            )}
          />
          <div
            className={cn(
              'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform shadow',
              checked ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </div>
        {label && <span className="text-sm">{label}</span>}
      </label>
    );
  },
);
Switch.displayName = 'Switch';

export { Switch };
