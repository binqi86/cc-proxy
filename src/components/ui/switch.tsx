import * as React from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  small?: boolean;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, checked, onChange, disabled, small, ...props }, ref) => {
    const trackClass = small ? 'h-4 w-7' : 'h-5 w-9';
    const thumbClass = small ? 'h-3 w-3 top-0.5 left-0.5' : 'h-4 w-4 top-0.5 left-0.5';
    const translateClass = small ? 'translate-x-3' : 'translate-x-4';
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
              'peer rounded-full border-2 transition-colors',
              trackClass,
              checked ? 'bg-primary border-primary' : 'bg-muted border-input',
            )}
          />
          <div
            className={cn(
              'absolute rounded-full bg-white transition-transform shadow',
              thumbClass,
              checked ? translateClass : 'translate-x-0',
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
