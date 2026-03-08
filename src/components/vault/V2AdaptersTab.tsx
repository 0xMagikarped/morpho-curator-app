import type { Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useV2Adapters } from '../../lib/hooks/useVault';
import { useVaultInfo } from '../../lib/hooks/useVault';
import { truncateAddress, formatTokenAmount } from '../../lib/utils/format';
import { getChainConfig } from '../../config/chains';

interface V2AdaptersTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function V2AdaptersTab({ chainId, vaultAddress }: V2AdaptersTabProps) {
  const chainConfig = getChainConfig(chainId);
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const { data: adapters, isLoading, error } = useV2Adapters(chainId, vaultAddress);

  const decimals = vault?.assetInfo.decimals ?? 18;
  const assetSymbol = vault?.assetInfo.symbol ?? '';
  const totalAssets = vault?.totalAssets ?? 0n;

  if (isLoading) {
    return <div className="animate-shimmer h-32 bg-bg-hover rounded" />;
  }

  if (error) {
    return (
      <Card className="py-8 text-center">
        <p className="text-danger text-sm">Failed to load adapters</p>
        <p className="text-text-tertiary text-xs mt-1">{error instanceof Error ? error.message : 'Data fetch failed.'}</p>
      </Card>
    );
  }

  const adapterTypeBadge = (type: string) => {
    switch (type) {
      case 'vault-v1':
        return <Badge variant="info">V1 Vault Adapter</Badge>;
      case 'market-v1':
        return <Badge variant="success">V1 Market Adapter</Badge>;
      default:
        return <Badge>Unknown Adapter</Badge>;
    }
  };

  const calcPercent = (assets: bigint): string => {
    if (totalAssets === 0n) return '0%';
    return ((Number(assets) / Number(totalAssets)) * 100).toFixed(1) + '%';
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Adapters</CardTitle>
          <div className="flex gap-2">
            <Badge variant="info">V2</Badge>
            <Badge>{adapters?.length ?? 0} adapter{(adapters?.length ?? 0) !== 1 ? 's' : ''}</Badge>
          </div>
        </CardHeader>

        <p className="text-xs text-text-tertiary mb-3">
          V2 vaults allocate through adapter contracts. Each adapter targets a V1 vault or V1 market.
        </p>

        {adapters && adapters.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
                  <th className="text-left py-2 px-2">Adapter</th>
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-left py-2 px-2">Target</th>
                  <th className="text-right py-2 px-2">Allocation ({assetSymbol})</th>
                  <th className="text-right py-2 px-2">Share</th>
                </tr>
              </thead>
              <tbody>
                {adapters.map((adapter) => (
                  <tr
                    key={adapter.address}
                    className="border-b border-border-subtle/50 hover:bg-bg-hover/30"
                  >
                    <td className="py-2.5 px-2">
                      <div>
                        {adapter.name ? (
                          <span className="text-text-primary text-xs">{adapter.name}</span>
                        ) : (
                          <span className="text-text-primary font-mono text-xs">{truncateAddress(adapter.address)}</span>
                        )}
                        {chainConfig && (
                          <a
                            href={`${chainConfig.blockExplorer}/address/${adapter.address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-[10px] text-info hover:text-info/80 font-mono mt-0.5"
                          >
                            {truncateAddress(adapter.address, 4)}
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-2">
                      {adapterTypeBadge(adapter.type)}
                    </td>
                    <td className="py-2.5 px-2">
                      {adapter.underlyingVault && chainConfig && (
                        <a
                          href={`${chainConfig.blockExplorer}/address/${adapter.underlyingVault}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-info hover:text-info/80 font-mono"
                        >
                          {truncateAddress(adapter.underlyingVault, 4)}
                        </a>
                      )}
                      {adapter.morphoBlue && !adapter.underlyingVault && chainConfig && (
                        <a
                          href={`${chainConfig.blockExplorer}/address/${adapter.morphoBlue}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-info hover:text-info/80 font-mono"
                        >
                          Morpho Blue
                        </a>
                      )}
                      {!adapter.underlyingVault && !adapter.morphoBlue && (
                        <span className="text-text-tertiary text-xs">—</span>
                      )}
                    </td>
                    <td className="text-right py-2.5 px-2 font-mono text-text-primary">
                      {formatTokenAmount(adapter.realAssets, decimals)}
                    </td>
                    <td className="text-right py-2.5 px-2 text-text-secondary">
                      {calcPercent(adapter.realAssets)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-text-tertiary text-sm">No adapters configured.</p>
        )}
      </Card>

      {/* Idle liquidity row */}
      {vault && adapters && adapters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Idle Liquidity</CardTitle>
          </CardHeader>
          <div className="flex items-center justify-between text-sm px-1">
            <span className="text-text-secondary">{assetSymbol} not allocated to adapters</span>
            <span className="font-mono text-text-primary">
              {(() => {
                const allocated = adapters.reduce((sum, a) => sum + a.realAssets, 0n);
                const idle = totalAssets > allocated ? totalAssets - allocated : 0n;
                return formatTokenAmount(idle, decimals) + ' ' + assetSymbol;
              })()}
            </span>
          </div>
        </Card>
      )}

      <Card className="border-warning/20">
        <CardHeader>
          <CardTitle>Adapter Management</CardTitle>
        </CardHeader>
        <p className="text-xs text-warning bg-warning/10 rounded p-2">
          Adapter configuration requires timelocked submit/execute transactions. This interface is read-only for now.
        </p>
      </Card>
    </div>
  );
}
