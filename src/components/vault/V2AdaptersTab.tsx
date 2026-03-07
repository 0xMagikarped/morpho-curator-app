import type { Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useVaultAllocation, useVaultMarkets } from '../../lib/hooks/useVault';
import { truncateAddress } from '../../lib/utils/format';
import { getChainConfig } from '../../config/chains';

interface V2AdaptersTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function V2AdaptersTab({ chainId, vaultAddress }: V2AdaptersTabProps) {
  const chainConfig = getChainConfig(chainId);
  const { data: allocation, isLoading: allocLoading } = useVaultAllocation(chainId, vaultAddress);
  const marketIds = allocation
    ? [...new Set([...allocation.supplyQueue, ...allocation.withdrawQueue])]
    : undefined;
  const { data: markets, isLoading: marketsLoading } = useVaultMarkets(chainId, marketIds);

  if (allocLoading || marketsLoading) {
    return <div className="animate-shimmer h-32 bg-bg-hover rounded" />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Adapters</CardTitle>
          <Badge variant="info">V2</Badge>
        </CardHeader>

        <p className="text-xs text-text-tertiary mb-3">
          V2 vaults use adapters to interact with yield sources. Each market can have a dedicated adapter contract.
        </p>

        {markets && markets.length > 0 ? (
          <div className="space-y-2">
            {markets.map((market) => (
              <div
                key={market.id}
                className="flex items-center justify-between py-2 px-3 bg-bg-hover/30 rounded text-sm"
              >
                <div>
                  <span className="text-text-primary">
                    {market.collateralToken.symbol} / {market.loanToken.symbol}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="success">Morpho V1 Adapter</Badge>
                  {chainConfig && (
                    <a
                      href={`${chainConfig.blockExplorer}/address/${market.params.oracle}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-info hover:text-info/80 font-mono"
                    >
                      {truncateAddress(market.params.oracle, 3)}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-text-tertiary text-sm">No adapters configured.</p>
        )}
      </Card>

      <Card className="border-warning/20">
        <CardHeader>
          <CardTitle>Adapter Management</CardTitle>
        </CardHeader>
        <p className="text-xs text-warning bg-warning/10 rounded p-2">
          Adapter configuration requires timelocked submit/execute transactions. This interface is read-only for now.
          Full adapter management coming soon.
        </p>
      </Card>
    </div>
  );
}
