import { cn } from '@/lib/utils';
import { useState } from 'react';

const PROVIDER_LOGOS: Record<string, string> = {
  deepseek:            'https://www.deepseek.com/favicon.ico',
  dashscope:           'https://dashscope.aliyun.com/favicon.ico',
  zhipu:               'https://open.bigmodel.cn/favicon.ico',
  moonshot:            'https://statics.moonshot.cn/kimi-web-seo/assets/kimi-logo-CegIMkbU.png',
  minimax:             'https://www.minimaxi.com/favicon.ico',
  'volcengine-coding': 'https://lf3-static.bytednsdoc.com/obj/eden-cn/shayvw_lmjsvc/ljhwZthlaukjlkulzlp/logo-theme-light.svg',
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
  const [imgFailed, setImgFailed] = useState(false);
  const logoUrl = PROVIDER_LOGOS[id];
  const dims = size === 'lg' ? 'w-12 h-12' : size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const inner = size === 'lg' ? 'w-8 h-8' : size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <span className={cn('grid place-items-center rounded-xl flex-shrink-0 bg-white dark:bg-white/90', dims)}>
      <span className={cn('block', inner)}>
        {logoUrl && !imgFailed ? (
          <img
            src={logoUrl}
            alt={name || id}
            className="w-full h-full object-contain"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <FallbackIcon name={name || id} />
        )}
      </span>
    </span>
  );
}
