import { cn } from '../../lib/utils/cn';

const chainColors: Record<number, { dot: string; bg: string; text: string; label: string }> = {
  1329: { dot: 'bg-chain-sei', bg: 'bg-chain-sei/10', text: 'text-chain-sei', label: 'SEI' },
  1: { dot: 'bg-chain-ethereum', bg: 'bg-chain-ethereum/10', text: 'text-chain-ethereum', label: 'ETH' },
  8453: { dot: 'bg-chain-base', bg: 'bg-chain-base/10', text: 'text-chain-base', label: 'BASE' },
};

interface ChainBadgeProps {
  chainId: number;
  className?: string;
}

export function ChainBadge({ chainId, className }: ChainBadgeProps) {
  const config = chainColors[chainId];
  if (!config) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-text-secondary bg-bg-hover', className)}>
        {chainId}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px]', config.bg, config.text, className)}>
      <span className={cn('w-1.5 h-1.5', config.dot)} />
      {config.label}
    </span>
  );
}
