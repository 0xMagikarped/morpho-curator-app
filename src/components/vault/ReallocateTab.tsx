import { useState, useMemo } from 'react';
import { formatUnits } from 'viem';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useVaultInfo, useVaultAllocation, useVaultMarketsFromApi, useVaultRole } from '../../lib/hooks/useVault';
import { metaMorphoV1Abi } from '../../lib/contracts/abis';
import { formatTokenAmount, parseTokenAmount } from '../../lib/utils/format';
import { useChainGuard } from '../../lib/hooks/useChainGuard';
import type { MarketAllocation } from '../../types';

interface ReallocateTabProps {
  chainId: number;
  vaultAddress: Address;
}

interface AllocationEdit {
  marketId: `0x${string}`;
  currentAssets: bigint;
  targetAssets: bigint;
  label: string;
  cap: bigint;
}

export function ReallocateTab({ chainId, vaultAddress }: ReallocateTabProps) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const { isMismatch, requestSwitch } = useChainGuard(chainId);
  const role = useVaultRole(chainId, vaultAddress);
  const { data: allocation, isLoading: allocLoading, error: allocError } = useVaultAllocation(chainId, vaultAddress);
  const { data: markets, isLoading: marketsLoading, error: marketsError } = useVaultMarketsFromApi(chainId, vaultAddress);
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const [edits, setEdits] = useState<Map<string, bigint>>(new Map());

  const allocationEdits = useMemo<AllocationEdit[]>(() => {
    if (!allocation?.allocations || !markets) return [];

    return allocation.allocations.map((a) => {
      const market = markets.find((m) => m.id === a.marketId);
      return {
        marketId: a.marketId,
        currentAssets: a.supplyAssets,
        targetAssets: edits.get(a.marketId) ?? a.supplyAssets,
        label: market ? `${market.collateralToken.symbol} ${formatPercent(market.params.lltv)}` : a.marketId.slice(0, 10),
        cap: a.supplyCap,
      };
    });
  }, [allocation, markets, edits]);

  const totalWithdrawn = allocationEdits.reduce(
    (s, e) => s + (e.targetAssets < e.currentAssets ? e.currentAssets - e.targetAssets : 0n),
    0n,
  );
  const totalSupplied = allocationEdits.reduce(
    (s, e) => s + (e.targetAssets > e.currentAssets ? e.targetAssets - e.currentAssets : 0n),
    0n,
  );
  const isBalanced = totalWithdrawn === totalSupplied;
  const hasChanges = allocationEdits.some((e) => e.targetAssets !== e.currentAssets);

  // Validation
  const validations = allocationEdits
    .filter((e) => e.targetAssets > e.cap && e.cap > 0n)
    .map((e) => `${e.label}: target exceeds cap`);

  const handleTargetChange = (marketId: string, value: string) => {
    const newEdits = new Map(edits);
    const decimals = vault?.assetInfo.decimals ?? 18;
    const parsed = parseTokenAmount(value || '0', decimals);
    newEdits.set(marketId, parsed);
    setEdits(newEdits);
  };

  const handleExecute = () => {
    if (!isBalanced || !hasChanges || !markets) return;

    // Build MarketAllocation[] for V1 reallocate
    const allocations: MarketAllocation[] = allocationEdits
      .filter((e) => e.targetAssets !== e.currentAssets)
      .map((e) => {
        const market = markets.find((m) => m.id === e.marketId);
        if (!market) throw new Error(`Market not found: ${e.marketId}`);

        let assets = e.targetAssets;
        // Special values: 0 = full withdrawal, max uint = supply all idle
        if (e.targetAssets === 0n && e.currentAssets > 0n) {
          assets = 0n; // Full withdrawal by shares
        }

        return {
          marketParams: market.params,
          assets,
        };
      });

    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'reallocate',
      args: [allocations.map((a) => ({ marketParams: a.marketParams, assets: a.assets }))],
    });
  };

  const assetDecimals = vault?.assetInfo.decimals ?? 18;

  if (allocLoading || marketsLoading) {
    return <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-16 bg-bg-hover rounded animate-shimmer" />)}</div>;
  }

  if (allocError || marketsError) {
    const err = allocError || marketsError;
    return (
      <Card className="py-8 text-center">
        <p className="text-danger text-sm">Failed to load allocation data</p>
        <p className="text-text-tertiary text-xs mt-1">{err instanceof Error ? err.message : 'Data fetch failed.'}</p>
      </Card>
    );
  }

  if (!role.isAllocator && !role.isOwner) {
    return (
      <Card className="py-8 text-center">
        <p className="text-text-tertiary text-sm">
          You need the Allocator or Owner role to reallocate.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {isMismatch && (
        <div className="flex items-center justify-between bg-warning/10 border border-warning/20 rounded px-3 py-2">
          <span className="text-xs text-warning">Wallet is on the wrong network. Switch to continue.</span>
          <Button size="sm" variant="secondary" onClick={requestSwitch}>Switch Network</Button>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Reallocate</CardTitle>
          <Badge>V1 Atomic</Badge>
        </CardHeader>

        {allocationEdits.length === 0 ? (
          <p className="text-text-tertiary text-sm py-4">No markets to reallocate.</p>
        ) : (
          <div className="space-y-3">
            {/* Allocation Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
                    <th className="text-left py-2">Market</th>
                    <th className="text-right py-2">Current</th>
                    <th className="text-center py-2"></th>
                    <th className="text-right py-2">Target</th>
                    <th className="text-right py-2">Delta</th>
                    <th className="text-right py-2">Cap</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationEdits.map((edit) => {
                    const delta = edit.targetAssets - edit.currentAssets;
                    const overCap = edit.cap > 0n && edit.targetAssets > edit.cap;

                    return (
                      <tr key={edit.marketId} className="border-b border-border-subtle/50">
                        <td className="py-2 text-text-primary">{edit.label}</td>
                        <td className="text-right py-2 text-text-secondary font-mono">
                          {formatTokenAmount(edit.currentAssets, assetDecimals)}
                        </td>
                        <td className="text-center py-2 text-text-tertiary">-&gt;</td>
                        <td className="text-right py-2">
                          <input
                            type="number"
                            step="0.01"
                            value={formatUnits(edit.targetAssets, assetDecimals)}
                            onChange={(e) => handleTargetChange(edit.marketId, e.target.value)}
                            className={`w-28 bg-bg-hover border rounded px-2 py-1 text-right text-sm font-mono ${
                              overCap ? 'border-danger/20 text-danger' : 'border-border-default text-text-primary'
                            }`}
                          />
                        </td>
                        <td className={`text-right py-2 font-mono text-xs ${
                          delta > 0n ? 'text-success' : delta < 0n ? 'text-danger' : 'text-text-tertiary'
                        }`}>
                          {delta > 0n ? '+' : ''}{formatTokenAmount(delta < 0n ? -delta : delta, assetDecimals)}
                          {delta < 0n ? ' -' : ''}
                        </td>
                        <td className="text-right py-2 text-text-tertiary font-mono text-xs">
                          {formatTokenAmount(edit.cap, assetDecimals)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Validation Summary */}
            <div className="space-y-1 text-xs">
              <div className={`flex items-center gap-2 ${isBalanced ? 'text-success' : 'text-danger'}`}>
                <span>{isBalanced ? 'ok' : '!!'}</span>
                <span>
                  Withdrawn: {formatTokenAmount(totalWithdrawn, assetDecimals)} == Supplied: {formatTokenAmount(totalSupplied, assetDecimals)}
                  {!isBalanced && ' (MUST BALANCE)'}
                </span>
              </div>
              {validations.map((v, i) => (
                <div key={i} className="flex items-center gap-2 text-danger">
                  <span>!!</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>

            {/* Execute */}
            <div className="flex gap-3 pt-2">
              <Button
                onClick={handleExecute}
                disabled={!isBalanced || !hasChanges || validations.length > 0 || isMismatch}
                loading={isPending || isConfirming}
              >
                {isPending ? 'Signing...' : isConfirming ? 'Confirming...' : 'Execute Reallocation'}
              </Button>
              {isSuccess && (
                <Badge variant="success">Transaction confirmed</Badge>
              )}
              <Button
                variant="ghost"
                onClick={() => setEdits(new Map())}
                disabled={!hasChanges}
              >
                Reset
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function formatPercent(lltv: bigint): string {
  return `${(Number(lltv) / 1e18 * 100).toFixed(1)}%`;
}
