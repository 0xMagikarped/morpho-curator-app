import { formatUnits } from 'viem';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { AllocationDiff } from '../../lib/vault/reallocationDiff';
import { formatMarketId } from '../../lib/utils/formatting';

interface ReallocationDiffViewProps {
  diffs: AllocationDiff[];
  assetDecimals: number;
  assetSymbol: string;
  timestamp?: number;
}

export function ReallocationDiffView({ diffs, assetDecimals, assetSymbol, timestamp }: ReallocationDiffViewProps) {
  const netChange = diffs.reduce((s, d) => s + d.delta, 0n);
  const isBalanced = netChange === 0n;

  const fmt = (v: bigint) => {
    const num = parseFloat(formatUnits(v < 0n ? -v : v, assetDecimals));
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reallocation Diff</CardTitle>
        <div className="flex gap-2">
          {isBalanced ? (
            <Badge variant="success">Balanced</Badge>
          ) : (
            <Badge variant="warning">Unbalanced</Badge>
          )}
          {timestamp && (
            <span className="text-[10px] text-text-tertiary">
              {new Date(timestamp).toLocaleString()}
            </span>
          )}
        </div>
      </CardHeader>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
              <th className="text-left py-2 px-2">Market</th>
              <th className="text-right py-2 px-2">Before</th>
              <th className="text-right py-2 px-2">After</th>
              <th className="text-right py-2 px-2">Delta</th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((d) => (
              <tr key={d.marketId} className="border-b border-border-subtle/50">
                <td className="py-2 px-2 font-mono text-xs text-text-primary">
                  {formatMarketId(d.marketId)}
                </td>
                <td className="text-right py-2 px-2 text-text-secondary font-mono">
                  {fmt(d.before)} {assetSymbol}
                </td>
                <td className="text-right py-2 px-2 text-text-primary font-mono">
                  {fmt(d.after)} {assetSymbol}
                </td>
                <td className={`text-right py-2 px-2 font-mono text-xs ${
                  d.delta > 0n ? 'text-success' : d.delta < 0n ? 'text-danger' : 'text-text-tertiary'
                }`}>
                  {d.delta > 0n ? '+' : d.delta < 0n ? '-' : ''}{fmt(d.delta)} {assetSymbol}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={`text-xs mt-2 ${isBalanced ? 'text-success' : 'text-warning'}`}>
        Net change: {netChange > 0n ? '+' : netChange < 0n ? '-' : ''}{fmt(netChange)} {assetSymbol}
        {isBalanced && ' (balanced ✓)'}
      </p>
    </Card>
  );
}
