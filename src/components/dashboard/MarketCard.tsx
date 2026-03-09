import { ArrowRight, CircleDollarSign } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { UtilizationBar } from '../risk/UtilizationBar';
import { cn } from '../../lib/utils/cn';

type MarketStatus = 'active' | 'at-risk' | 'frozen';

interface MarketCardProps {
  name: string;
  supplyApy: string;
  borrowApy: string;
  utilization: number; // 0-100
  available: string;
  status: MarketStatus;
  onClick?: () => void;
  loading?: boolean;
}

const statusConfig: Record<MarketStatus, { label: string; variant: 'success' | 'warning' | 'danger'; pulse: boolean }> = {
  active: { label: 'Active', variant: 'success', pulse: false },
  'at-risk': { label: 'At-Risk', variant: 'warning', pulse: true },
  frozen: { label: 'Frozen', variant: 'danger', pulse: false },
};

export function MarketCard({
  name,
  supplyApy,
  borrowApy,
  utilization,
  available,
  status,
  onClick,
  loading,
}: MarketCardProps) {
  if (loading) {
    return (
      <Card className="!p-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-4 h-4 rounded bg-bg-hover animate-shimmer" />
          <div className="h-4 w-28 bg-bg-hover rounded animate-shimmer" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i}>
              <div className="h-2.5 w-12 bg-bg-hover rounded animate-shimmer mb-1" />
              <div className="h-4 w-16 bg-bg-hover rounded animate-shimmer" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  const cfg = statusConfig[status];
  const isFrozen = status === 'frozen';

  return (
    <Card
      hover={!isFrozen}
      onClick={onClick}
      className={cn(
        '!p-3 transition-all duration-100 ease-out group',
        isFrozen && 'opacity-45',
        !isFrozen && 'hover:shadow-[0_4px_16px_rgba(0,0,0,0.4)]',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2.5">
        <CircleDollarSign size={16} className="text-text-tertiary" />
        <span className="text-[13px] font-semibold text-text-primary flex-1 truncate">
          {name}
        </span>
        <Badge
          variant={cfg.variant}
          className={cn(cfg.pulse && 'animate-[badge-pulse_500ms_ease-in-out_infinite]')}
        >
          {cfg.label}
        </Badge>
      </div>

      {/* Body: 2-col data grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <DataPair label="Supply APY" value={supplyApy} accent />
        <DataPair label="Borrow APY" value={borrowApy} />
        <div>
          <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Utilization</span>
          <div className="mt-0.5">
            <UtilizationBar utilization={utilization} compact />
          </div>
        </div>
        <DataPair label="Available" value={available} muted />
      </div>

      {/* Footer */}
      <div className="mt-2.5 pt-2 border-t border-border-subtle">
        <button
          className="inline-flex items-center gap-1 text-xs font-mono text-accent-primary hover:text-accent-primary-hover transition-colors min-h-[44px] -my-2"
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
          aria-label={`View ${name} market details`}
        >
          View Market
          <ArrowRight size={12} />
        </button>
      </div>
    </Card>
  );
}

function DataPair({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <span className="text-[10px] text-text-tertiary uppercase tracking-wider">{label}</span>
      <p
        className={cn(
          'text-sm font-mono mt-0.5',
          accent ? 'text-accent-primary' : muted ? 'text-text-tertiary' : 'text-text-primary',
        )}
      >
        {value}
      </p>
    </div>
  );
}
