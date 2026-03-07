import { useState } from 'react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { truncateAddress } from '../../lib/utils/format';
import { formatTokenDisplay } from '../../lib/utils/formatting';
import type { PositionData } from '../../lib/market/positionHealth';

interface PositionHealthTableProps {
  positions: PositionData[];
  collateralSymbol: string;
  loanSymbol: string;
  collateralDecimals: number;
  loanDecimals: number;
  loading?: boolean;
}

type HealthFilter = 'all' | 'lt1.2' | 'lt1.1' | 'liquidatable';

export function PositionHealthTable({
  positions,
  collateralSymbol,
  loanSymbol,
  collateralDecimals,
  loanDecimals,
  loading,
}: PositionHealthTableProps) {
  const [filter, setFilter] = useState<HealthFilter>('all');

  const filtered = positions.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'lt1.2') return p.healthRatio < 1.2;
    if (filter === 'lt1.1') return p.healthRatio < 1.1;
    if (filter === 'liquidatable') return p.healthRatio < 1.0;
    return true;
  });

  const healthColor = (h: number) =>
    h < 1.0 ? 'text-danger' : h < 1.1 ? 'text-warning' : h < 1.2 ? 'text-warning' : 'text-success';

  const healthLabel = (h: number) =>
    h === Infinity ? 'N/A' : h < 1.0 ? 'Liquidatable' : h < 1.1 ? 'Critical' : h < 1.2 ? 'At Risk' : 'Healthy';

  if (loading) {
    return <div className="animate-shimmer h-32 bg-bg-hover rounded" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Position Health</CardTitle>
        <Badge>{positions.length} positions</Badge>
      </CardHeader>

      <div className="flex gap-1 mb-3">
        {(['all', 'lt1.2', 'lt1.1', 'liquidatable'] as HealthFilter[]).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'primary' : 'ghost'}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'lt1.2' ? '< 1.2' : f === 'lt1.1' ? '< 1.1' : 'Liquidatable'}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-text-tertiary text-sm py-4 text-center">
          No positions match the current filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
                <th className="text-left py-2 px-2">Borrower</th>
                <th className="text-right py-2 px-2">Collateral</th>
                <th className="text-right py-2 px-2">Borrow</th>
                <th className="text-right py-2 px-2">Health</th>
                <th className="text-right py-2 px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.borrower} className="border-b border-border-subtle/50">
                  <td className="py-2 px-2 font-mono text-xs text-text-primary">
                    {truncateAddress(p.borrower)}
                  </td>
                  <td className="text-right py-2 px-2 text-text-primary font-mono text-xs">
                    {formatTokenDisplay(Number(p.collateral) / Math.pow(10, collateralDecimals), collateralSymbol)} {collateralSymbol}
                  </td>
                  <td className="text-right py-2 px-2 text-text-primary font-mono text-xs">
                    {formatTokenDisplay(Number(p.borrowAssets) / Math.pow(10, loanDecimals), loanSymbol)} {loanSymbol}
                  </td>
                  <td className={`text-right py-2 px-2 font-mono text-xs ${healthColor(p.healthRatio)}`}>
                    {p.healthRatio === Infinity ? '∞' : p.healthRatio.toFixed(3)}
                  </td>
                  <td className="text-right py-2 px-2">
                    <Badge variant={p.healthRatio < 1.0 ? 'danger' : p.healthRatio < 1.2 ? 'warning' : 'success'}>
                      {healthLabel(p.healthRatio)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
