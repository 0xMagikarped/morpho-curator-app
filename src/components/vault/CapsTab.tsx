import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ProgressBar } from '../ui/ProgressBar';
import { useVaultInfo, useVaultAllocation, useVaultMarketsFromApi, useVaultRole, useVaultPendingActions } from '../../lib/hooks/useVault';
import { metaMorphoV1Abi } from '../../lib/contracts/abis';
import { formatTokenAmount, formatCountdown, parseTokenAmount } from '../../lib/utils/format';
import { useChainGuard } from '../../lib/hooks/useChainGuard';

interface CapsTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function CapsTab({ chainId, vaultAddress }: CapsTabProps) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const { isMismatch, requestSwitch } = useChainGuard(chainId);
  const role = useVaultRole(chainId, vaultAddress);
  const { data: allocation, isLoading: allocLoading, error: allocError } = useVaultAllocation(chainId, vaultAddress);
  const { data: markets, isLoading: marketsLoading, error: marketsError } = useVaultMarketsFromApi(chainId, vaultAddress);
  const marketIds = allocation
    ? [...new Set([...allocation.supplyQueue, ...allocation.withdrawQueue])]
    : undefined;
  const { data: pendingActions } = useVaultPendingActions(chainId, vaultAddress, marketIds);
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [newCapValue, setNewCapValue] = useState('');
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const interval = setInterval(() => {
      setNowSeconds(BigInt(Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const pendingCaps = pendingActions?.filter((a) => a.type === 'cap') ?? [];

  const handleSubmitCap = () => {
    if (!selectedMarket || !newCapValue || !markets) return;
    const market = markets.find((m) => m.id === selectedMarket);
    if (!market) return;

    const decimals = vault?.assetInfo.decimals ?? 18;
    const capWei = parseTokenAmount(newCapValue, decimals);

    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'submitCap',
      args: [market.params, capWei],
    });
  };

  const handleAcceptCap = (marketId: `0x${string}`) => {
    const market = markets?.find((m) => m.id === marketId);
    if (!market) return;
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'acceptCap',
      args: [market.params],
    });
  };

  const handleRevokeCap = (marketId: `0x${string}`) => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'revokePendingCap',
      args: [marketId],
    });
  };

  if (allocLoading || marketsLoading) {
    return <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-16 bg-bg-hover rounded animate-shimmer" />)}</div>;
  }

  if (allocError || marketsError) {
    const err = allocError || marketsError;
    return (
      <Card className="py-8 text-center">
        <p className="text-danger text-sm">Failed to load caps data</p>
        <p className="text-text-tertiary text-xs mt-1">{err instanceof Error ? err.message : 'Data fetch failed.'}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Chain Mismatch Warning */}
      {isMismatch && (
        <div className="flex items-center justify-between bg-warning/10 border border-warning/20 rounded px-3 py-2">
          <span className="text-xs text-warning">Wallet is on the wrong network. Switch to continue.</span>
          <Button size="sm" variant="secondary" onClick={requestSwitch}>Switch Network</Button>
        </div>
      )}

      {/* Pending Caps */}
      {pendingCaps.length > 0 && (
        <Card className="border-warning/20">
          <CardHeader>
            <CardTitle>Pending Cap Changes</CardTitle>
            <Badge variant="warning">{pendingCaps.length}</Badge>
          </CardHeader>
          <div className="space-y-2">
            {pendingCaps.map((pc, i) => {
              const isReady = pc.validAt <= nowSeconds;

              return (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 px-3 bg-bg-hover/50 rounded"
                >
                  <div>
                    <p className="text-sm text-text-primary">{pc.description}</p>
                    <p className="text-xs text-text-tertiary">
                      {isReady ? 'Ready to accept' : `Available in ${formatCountdown(pc.validAt)}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {isReady && pc.marketId && (
                      <Button size="sm" onClick={() => handleAcceptCap(pc.marketId!)}>
                        Accept
                      </Button>
                    )}
                    {role.isEmergencyRole && pc.marketId && (
                      <Button size="sm" variant="danger" onClick={() => handleRevokeCap(pc.marketId!)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Current Caps */}
      <Card>
        <CardHeader>
          <CardTitle>Market Supply Caps</CardTitle>
        </CardHeader>
        {allocation?.allocations && markets ? (
          <div className="space-y-2">
            {allocation.allocations.map((alloc) => {
              const market = markets.find((m) => m.id === alloc.marketId);
              const capUsed = alloc.supplyCap > 0n
                ? Number((alloc.supplyAssets * 10000n) / alloc.supplyCap) / 100
                : 0;

              return (
                <div
                  key={alloc.marketId}
                  className="flex items-center gap-4 py-2 px-3 bg-bg-hover/30 rounded hover:bg-bg-hover/50 cursor-pointer"
                  onClick={() => setSelectedMarket(alloc.marketId)}
                >
                  <div className="flex-1">
                    <p className="text-sm text-text-primary">
                      {market?.collateralToken.symbol ?? alloc.marketId.slice(0, 10)}
                    </p>
                    <p className="text-xs text-text-tertiary">
                      Supply: {formatTokenAmount(alloc.supplyAssets, vault?.assetInfo.decimals ?? 18)} / Cap: {formatTokenAmount(alloc.supplyCap, vault?.assetInfo.decimals ?? 18)}
                    </p>
                  </div>
                  <div className="w-20">
                    <ProgressBar value={capUsed} className="h-1.5" />
                    <p className="text-[10px] text-text-tertiary text-right mt-0.5 font-mono">{capUsed.toFixed(0)}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-text-tertiary text-sm">No markets with caps.</p>
        )}
      </Card>

      {/* Submit New Cap (Curator only) */}
      {(role.isCurator || role.isOwner) && (
        <Card>
          <CardHeader>
            <CardTitle>Submit Cap Change</CardTitle>
            <Badge variant="info">Timelocked</Badge>
          </CardHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-text-tertiary">Market</label>
              <select
                value={selectedMarket ?? ''}
                onChange={(e) => setSelectedMarket(e.target.value || null)}
                className="w-full mt-1 bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary"
              >
                <option value="">Select market...</option>
                {markets?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.collateralToken.symbol} / {m.loanToken.symbol} ({(Number(m.params.lltv) / 1e18 * 100).toFixed(1)}%)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-text-tertiary">New Supply Cap (in asset tokens)</label>
              <input
                type="number"
                step="0.01"
                value={newCapValue}
                onChange={(e) => setNewCapValue(e.target.value)}
                placeholder="e.g., 1000000"
                className="w-full mt-1 bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary placeholder-text-tertiary"
              />
            </div>
            <div className="text-xs text-warning bg-warning/10 rounded p-2">
              Cap increases are timelocked. After submitting, wait for the timelock duration before accepting.
            </div>
            <Button
              onClick={handleSubmitCap}
              disabled={!selectedMarket || !newCapValue || isMismatch}
              loading={isPending || isConfirming}
            >
              Submit Cap
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
