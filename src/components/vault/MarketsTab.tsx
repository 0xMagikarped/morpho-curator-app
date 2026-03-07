import type { Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { ProgressBar } from '../ui/ProgressBar';
import { UtilizationBar } from '../risk/UtilizationBar';
import { useVaultInfo, useVaultAllocation, useVaultMarkets, useVaultMarketsFromApi } from '../../lib/hooks/useVault';
import { isApiSupportedChain } from '../../lib/data/morphoApi';
import { formatTokenAmount, formatPercent, truncateAddress } from '../../lib/utils/format';
import { getChainConfig } from '../../config/chains';

interface MarketsTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function MarketsTab({ chainId, vaultAddress }: MarketsTabProps) {
  const chainConfig = getChainConfig(chainId);
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const useApi = isApiSupportedChain(chainId);
  const { data: allocation, isLoading: allocLoading, error: allocError } = useVaultAllocation(chainId, vaultAddress);
  const marketIds = allocation
    ? [...new Set([...allocation.supplyQueue, ...allocation.withdrawQueue])]
    : undefined;
  // For API-supported chains, markets come from the shared API query
  const rpcMarkets = useVaultMarkets(chainId, marketIds);
  const apiMarkets = useVaultMarketsFromApi(chainId, vaultAddress);
  const { data: markets, isLoading: marketsLoading, error: marketsError } = useApi ? apiMarkets : rpcMarkets;

  const isLoading = allocLoading || marketsLoading;
  const error = allocError || marketsError;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-bg-hover rounded animate-shimmer" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="py-8 text-center">
        <p className="text-danger text-sm">Failed to load markets</p>
        <p className="text-text-tertiary text-xs mt-1">
          {error instanceof Error ? error.message : 'RPC call failed — try refreshing the page.'}
        </p>
      </Card>
    );
  }

  if (!allocation || !markets || markets.length === 0) {
    return (
      <Card className="py-8 text-center">
        <p className="text-text-tertiary text-sm">No markets enabled in this vault.</p>
        <p className="text-text-tertiary text-xs mt-1">
          The supply and withdraw queues are empty.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Market Allocation</CardTitle>
          <Badge>{markets.length} markets</Badge>
        </CardHeader>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] text-text-tertiary uppercase">Total Allocated</p>
            <p className="text-sm font-medium">
              {formatTokenAmount(allocation.totalAllocated, vault?.assetInfo.decimals ?? 18)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary uppercase">Supply Queue</p>
            <p className="text-sm font-medium">{allocation.supplyQueue.length} markets</p>
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary uppercase">Withdraw Queue</p>
            <p className="text-sm font-medium">{allocation.withdrawQueue.length} markets</p>
          </div>
        </div>
      </Card>

      {/* Markets Table */}
      <Card>
        <CardHeader>
          <CardTitle>Enabled Markets</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
                <th className="text-left py-2 px-2">Collateral</th>
                <th className="text-right py-2 px-2">LLTV</th>
                <th className="text-right py-2 px-2">Supply</th>
                <th className="text-right py-2 px-2">Cap</th>
                <th className="text-right py-2 px-2">Used</th>
                <th className="text-right py-2 px-2">Util</th>
                <th className="text-right py-2 px-2">Oracle</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((market) => {
                const alloc = allocation.allocations.find((a) => a.marketId === market.id);
                const capUsed = alloc && alloc.supplyCap > 0n
                  ? Number((alloc.supplyAssets * 10000n) / alloc.supplyCap) / 100
                  : 0;

                return (
                  <tr
                    key={market.id}
                    className="border-b border-border-subtle/50 hover:bg-bg-hover/30 cursor-pointer"
                  >
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary">
                          {market.collateralToken.symbol}
                        </span>
                        <span className="text-text-tertiary text-xs">
                          / {market.loanToken.symbol}
                        </span>
                      </div>
                    </td>
                    <td className="text-right py-2.5 px-2 text-text-primary">
                      {formatPercent(Number(market.params.lltv) / 1e18)}
                    </td>
                    <td className="text-right py-2.5 px-2 text-text-primary">
                      {alloc ? formatTokenAmount(alloc.supplyAssets, vault?.assetInfo.decimals ?? 18) : '0'}
                    </td>
                    <td className="text-right py-2.5 px-2 text-text-secondary">
                      {alloc ? formatTokenAmount(alloc.supplyCap, vault?.assetInfo.decimals ?? 18) : '0'}
                    </td>
                    <td className="text-right py-2.5 px-2 w-24">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-text-primary text-xs">{capUsed.toFixed(0)}%</span>
                        <ProgressBar value={capUsed} className="w-12 h-1.5" />
                      </div>
                    </td>
                    <td className="text-right py-2.5 px-2">
                      <UtilizationBar utilization={market.utilization * 100} compact />
                    </td>
                    <td className="text-right py-2.5 px-2">
                      <a
                        href={`${chainConfig?.blockExplorer}/address/${market.params.oracle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-info hover:text-info/80 font-mono"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {truncateAddress(market.params.oracle, 3)}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
