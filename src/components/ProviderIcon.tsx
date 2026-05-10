import { cn } from '@/lib/utils';

/* ── Provider logo SVGs ── */

// DeepSeek — 鲸鱼
const DeepSeekIcon = () => (
  <svg viewBox="0 0 32 32" fill="none"><ellipse cx="16" cy="17" rx="7" ry="5" fill="#fff" opacity="0.9"/><path d="M6 20c-2-1-3-4-2-7 1-2 4-4 6-3 3-1 8-2 12 0 2-1 5 1 4 3-1 2-5 3-6 1-3 3-10 4-14 6Z" fill="#fff" opacity="0.85"/><circle cx="13" cy="16" r="1.2" fill="#3867D6"/><path d="M10 24c-1 1-1 3 0 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.6"/></svg>
);

// Alibaba Cloud — 云
const AlibabaIcon = () => (
  <svg viewBox="0 0 32 32" fill="none"><path d="M8 22c-4 0-6-3-5-7 1-3 4-5 7-4 1 0 2 1 3 1 2-1 5-1 8 0 1-1 2-1 3-1 3-1 6 1 5 4-1 2-4 3-5 2-1 0-2 0-3 0M10 25v4M16 25v4M22 25v4" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.9"/></svg>
);

// Zhipu GLM — AI 芯片
const ZhipuIcon = () => (
  <svg viewBox="0 0 32 32" fill="none"><rect x="7" y="7" width="18" height="18" rx="4" fill="none" stroke="#fff" strokeWidth="2" opacity="0.8"/><path d="M13 13h6v6h-6z" fill="#fff" opacity="0.6"/><circle cx="11" cy="11" r="1.5" fill="#fff" opacity="0.55"/><circle cx="21" cy="11" r="1.5" fill="#fff" opacity="0.55"/><circle cx="11" cy="21" r="1.5" fill="#fff" opacity="0.55"/></svg>
);

// Moonshot — 火箭/月亮
const MoonshotIcon = () => (
  <svg viewBox="0 0 32 32" fill="none"><path d="M16 4c-3 0-5 2-6 4l2 2c1-1 2-2 4-2 1 0 3 1 3 2 0 3-5 6-7 12 0 2 1 4 3 4s4-1 4-3c0-3 3-7 5-9 2-2 1-5-2-6-2 0-3 0-6 0Z" fill="#fff" opacity="0.85"/><circle cx="22" cy="8" r="2" fill="#fff" opacity="0.6"/></svg>
);

// MiniMax — 闪电/星星
const MiniMaxIcon = () => (
  <svg viewBox="0 0 32 32" fill="none"><polygon points="17,3 8,15 15,15 13,29 26,16 19,16 21,4" fill="#fff" opacity="0.9"/></svg>
);

// Volcengine — 火山
const VolcengineIcon = () => (
  <svg viewBox="0 0 32 32" fill="none"><path d="M16 4L6 16h6l-3 12 14-14h-6l4-10H16Z" fill="#fff" opacity="0.85"/><path d="M8 27h16M10 24h12" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/></svg>
);

// Default fallback
const DefaultIcon = ({ name }: { name?: string }) => (
  <svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="10" stroke="#fff" strokeWidth="2" opacity="0.7" fill="none"/><text x="16" y="21" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#fff" opacity="0.9">{(name || '?').charAt(0)}</text></svg>
);

/* ── Config ── */

type ProviderStyle = { bg: string; Icon: React.FC<{ name?: string }> };

const PROVIDER_STYLES: Record<string, ProviderStyle> = {
  deepseek:            { bg: 'linear-gradient(135deg, #3867D6, #2563EB)', Icon: DeepSeekIcon },
  dashscope:           { bg: 'linear-gradient(135deg, #F97316, #EF4444)', Icon: AlibabaIcon },
  zhipu:               { bg: 'linear-gradient(135deg, #2563EB, #0891B2)', Icon: ZhipuIcon },
  moonshot:            { bg: 'linear-gradient(135deg, #7C3AED, #EC4899)', Icon: MoonshotIcon },
  minimax:             { bg: 'linear-gradient(135deg, #059669, #0D9488)', Icon: MiniMaxIcon },
  'volcengine-coding': { bg: 'linear-gradient(135deg, #1E293B, #475569)', Icon: VolcengineIcon },
};

const DEFAULT_STYLE: ProviderStyle = {
  bg: 'linear-gradient(135deg, #64748B, #94A3B8)',
  Icon: DefaultIcon,
};

export default function ProviderIcon({ id, name, size }: { id: string; name?: string; size?: 'sm' | 'md' | 'lg' }) {
  const style = PROVIDER_STYLES[id] || DEFAULT_STYLE;
  const { Icon } = style;
  const dims = size === 'lg' ? 'w-12 h-12' : size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const inner = size === 'lg' ? 'w-8 h-8' : size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <span className={cn('grid place-items-center rounded-xl flex-shrink-0', dims)} style={{ background: style.bg }}>
      <span className={cn('block', inner)}>
        <Icon name={name} />
      </span>
    </span>
  );
}
