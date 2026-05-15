import claudeSvg from '@/assets/claude.svg?url';
import codexSvg from '@/assets/codex.svg?url';

interface BrandIconProps {
  size?: number;
  className?: string;
  dimmed?: boolean;
}

export function ClaudeIcon({ size = 16, className = '', dimmed }: BrandIconProps) {
  return (
    <img
      src={claudeSvg}
      width={size}
      height={size}
      className={className}
      style={{ opacity: dimmed ? 0.3 : 1, transition: 'opacity 150ms' }}
      alt="Claude"
      loading="lazy"
    />
  );
}

export function CodexIcon({ size = 16, className = '', dimmed }: BrandIconProps) {
  return (
    <img
      src={codexSvg}
      width={size}
      height={size}
      className={`codex-icon ${className}`}
      style={{
        opacity: dimmed ? 0.3 : 1,
        transition: 'opacity 150ms',
      }}
      alt="Codex"
      loading="lazy"
    />
  );
}
