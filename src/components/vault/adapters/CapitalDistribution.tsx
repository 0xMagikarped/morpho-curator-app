import { formatTokenAmount } from '../../../lib/utils/format';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

interface CapitalDistributionProps {
  adapters: V2AdapterFull[];
  idle: bigint;
  totalAssets: bigint;
  decimals: number;
  assetSymbol: string;
}

const SEGMENT_COLORS = [
  'bg-accent-primary',
  'bg-info',
  'bg-migration',
  'bg-warning',
  'bg-success',
];

export function CapitalDistribution({
  adapters,
  idle,
  totalAssets,
  decimals,
  assetSymbol,
}: CapitalDistributionProps) {
  const total = Number(totalAssets);
  if (total === 0) return null;

  const segments = [
    ...adapters.map((a, i) => ({
      label: a.name ?? `Adapter ${a.address.slice(0, 8)}`,
      value: a.realAssets,
      color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      isLiquidity: a.isLiquidityAdapter,
    })),
    {
      label: 'Idle',
      value: idle,
      color: 'bg-bg-active',
      isLiquidity: false,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Capital Allocation</CardTitle>
        <Badge>
          {formatTokenAmount(totalAssets, decimals)} {assetSymbol}
        </Badge>
      </CardHeader>

      {/* Stacked bar */}
      <div className="flex h-3 w-full overflow-hidden bg-bg-hover mb-3">
        {segments.map((seg, i) => {
          const pct = total > 0 ? (Number(seg.value) / total) * 100 : 0;
          if (pct < 0.1) return null;
          return (
            <div
              key={i}
              className={seg.color}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="space-y-1.5">
        {segments.map((seg, i) => {
          const pct = total > 0 ? (Number(seg.value) / total) * 100 : 0;
          return (
            <div key={i} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 ${seg.color} shrink-0`} />
                <span className="text-text-secondary">
                  {seg.label}
                  {seg.isLiquidity && (
                    <span className="text-accent-primary ml-1 text-[10px]">LIQUIDITY</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-text-primary">
                  {formatTokenAmount(seg.value, decimals)} {assetSymbol}
                </span>
                <span className="font-mono text-text-tertiary w-12 text-right">
                  {pct.toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
