import { Card, CardHeader, CardTitle } from '../ui/Card';
import { getChainConfig } from '../../config/chains';
import type { VaultSummary } from '../../lib/hooks/useDashboard';

interface PortfolioSummaryProps {
  vaults: VaultSummary[];
}

export function PortfolioSummary({ vaults }: PortfolioSummaryProps) {
  // Group by chain
  const byChain = new Map<number, VaultSummary[]>();
  for (const v of vaults) {
    const arr = byChain.get(v.chainId) ?? [];
    arr.push(v);
    byChain.set(v.chainId, arr);
  }

  const chainCount = byChain.size;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portfolio Overview</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricItem label="Active Vaults" value={vaults.length.toString()} />
        <MetricItem label="Chains" value={chainCount.toString()} />
        <MetricItem
          label="Managed Roles"
          value={vaults.filter((v) => v.role !== 'none').length.toString()}
        />
        <MetricItem
          label="Total Markets"
          value={vaults.reduce((s, v) => s + v.supplyQueueLength, 0).toString()}
        />
      </div>

      {byChain.size > 0 && (
        <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-border-subtle">
          {Array.from(byChain.entries()).map(([chainId, chainVaults]) => {
            const cfg = getChainConfig(chainId);
            return (
              <span key={chainId} className="text-xs text-text-tertiary">
                {cfg?.name ?? `Chain ${chainId}`}: {chainVaults.length} vault{chainVaults.length !== 1 ? 's' : ''}
              </span>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-text-tertiary uppercase">{label}</p>
      <p className="text-lg font-semibold text-text-primary">{value}</p>
    </div>
  );
}
