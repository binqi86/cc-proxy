import { cn } from '@/lib/utils';
import deepseekSvg from '@/assets/providers/deepseek.svg?url';
import dashscopeSvg from '@/assets/providers/dashscope.svg?url';
import zhipuSvg from '@/assets/providers/zhipu.svg?url';
import moonshotSvg from '@/assets/providers/moonshot.svg?url';
import minimaxSvg from '@/assets/providers/minimax.svg?url';
import volcengineSvg from '@/assets/providers/volcengine-coding.svg?url';

const PROVIDER_LOGOS: Record<string, string> = {
  deepseek: deepseekSvg,
  dashscope: dashscopeSvg,
  zhipu: zhipuSvg,
  moonshot: moonshotSvg,
  minimax: minimaxSvg,
  'volcengine-coding': volcengineSvg,
};

function FallbackIcon({ name }: { name?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="10" stroke="rgb(var(--muted-foreground))" strokeWidth="1.5" fill="none" opacity="0.5" />
      <text x="16" y="21" textAnchor="middle" fontSize="14" fontWeight="bold" fill="rgb(var(--muted-foreground))" opacity="0.8">
        {(name || '?').charAt(0).toUpperCase()}
      </text>
    </svg>
  );
}

export default function ProviderIcon({ id, name, size }: { id: string; name?: string; size?: 'sm' | 'md' | 'lg' }) {
  const logoUrl = PROVIDER_LOGOS[id];
  const dims = size === 'lg' ? 'w-12 h-12' : size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const inner = size === 'lg' ? 'w-8 h-8' : size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <span className={cn('grid place-items-center rounded-xl flex-shrink-0 bg-white dark:bg-white/90', dims)}>
      <span className={cn('block', inner)}>
        {logoUrl ? (
          <img src={logoUrl} alt={name || id} className="w-full h-full object-contain" />
        ) : (
          <FallbackIcon name={name || id} />
        )}
      </span>
    </span>
  );
}
