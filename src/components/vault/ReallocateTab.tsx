import { useState, useMemo } from 'react';
import { formatUnits } from 'viem';
import type { Address } from 'viem';
import type { MarketId } from '@morpho-org/blue-sdk';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useVaultInfo, useVaultAllocation, useVaultMarketsFromApi, useVaultRole } from '../../lib/hooks/useVault';
import { formatTokenAmount, parseTokenAmount } from '../../lib/utils/format';
import { useChainGuard } from '../../lib/hooks/useChainGuard';
import { isMorphoSdkSupported } from '../../lib/morpho/sdk-config';
import {
  useReallocationSimulation,
  type AllocationChange,
  type SimulationResult,
} from '../../hooks/morpho-sdk/useReallocationSimulation';
import {
  useReallocate,
  orderAllocations,
  type MarketAllocationArg,
} from '../../hooks/morpho-sdk/useReallocate';
import { PublicAllocatorPanel } from './PublicAllocatorPanel';

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
  const { reallocate, isPending, isConfirming, isSuccess, error: txError, reset: resetTx } = useReallocate(vaultAddress, chainId);
  const { simulation, isSimulating, simulate } = useReallocationSimulation(vaultAddress, chainId);

  const [edits, setEdits] = useState<Map<string, bigint>>(new Map());
  const [catcherMarketId, setCatcherMarketId] = useState<string | null>(null);

  const sdkSupported = isMorphoSdkSupported(chainId);

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

  // Auto-select catcher: largest target allocation
  const effectiveCatcher = catcherMarketId ?? (allocationEdits.length > 0
    ? allocationEdits.reduce((max, e) => e.targetAssets > max.targetAssets ? e : max, allocationEdits[0]!).marketId
    : null);

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

  const handleSimulate = () => {
    if (!hasChanges || !sdkSupported) return;
    const changes: AllocationChange[] = allocationEdits
      .filter((e) => e.targetAssets !== e.currentAssets)
      .map((e) => ({
        marketId: e.marketId as MarketId,
        targetAssets: e.targetAssets,
      }));
    simulate(changes);
  };

  const handleExecute = () => {
    if (!isBalanced || !hasChanges || !markets) return;

    // Build allocations with all markets that changed
    const allocations: MarketAllocationArg[] = allocationEdits
      .filter((e) => e.targetAssets !== e.currentAssets)
      .map((e) => {
        const market = markets.find((m) => m.id === e.marketId);
        if (!market) throw new Error(`Market not found: ${e.marketId}`);
        return {
          marketParams: market.params,
          assets: e.targetAssets,
        };
      });

    // Find the catcher index and reorder: withdrawals first, catcher last with MAX_UINT256
    const catcherIdx = allocations.findIndex((a) => {
      const matchEdit = allocationEdits.find(
        (e) => e.marketId === effectiveCatcher,
      );
      if (!matchEdit) return false;
      const market = markets.find((m) => m.id === matchEdit.marketId);
      return market && a.marketParams.loanToken === market.params.loanToken
        && a.marketParams.collateralToken === market.params.collateralToken
        && a.marketParams.oracle === market.params.oracle;
    });

    const currentAssetsMap = new Map<string, bigint>();
    for (const e of allocationEdits) {
      const market = markets.find((m) => m.id === e.marketId);
      if (market) {
        const key = `${market.params.loanToken}-${market.params.collateralToken}-${market.params.oracle}-${market.params.irm}-${market.params.lltv}`;
        currentAssetsMap.set(key, e.currentAssets);
      }
    }

    const ordered = orderAllocations(
      allocations,
      currentAssetsMap,
      catcherIdx >= 0 ? catcherIdx : allocations.length - 1,
    );

    reallocate(ordered);
  };

  const assetDecimals = vault?.assetInfo.decimals ?? 18;

  if (allocLoading || marketsLoading) {
    return <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-16 bg-bg-hover animate-shimmer" />)}</div>;
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
        <div className="flex items-center justify-between bg-warning/10 border border-warning/20 px-3 py-2">
          <span className="text-xs text-warning">Wallet is on the wrong network. Switch to continue.</span>
          <Button size="sm" variant="secondary" onClick={requestSwitch}>Switch Network</Button>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Reallocate</CardTitle>
          <div className="flex gap-1.5">
            <Badge>V1 Atomic</Badge>
            {sdkSupported && <Badge variant="info">SDK Simulation</Badge>}
          </div>
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
                    <th className="text-center py-2 w-8">Catcher</th>
                  </tr>
                </thead>
                <tbody>
                  {allocationEdits.map((edit) => {
                    const delta = edit.targetAssets - edit.currentAssets;
                    const overCap = edit.cap > 0n && edit.targetAssets > edit.cap;
                    const isCatcher = edit.marketId === effectiveCatcher;

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
                            className={`w-28 bg-bg-hover border px-2 py-1 text-right text-sm font-mono ${
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
                        <td className="text-center py-2">
                          <input
                            type="radio"
                            name="catcher"
                            checked={isCatcher}
                            onChange={() => setCatcherMarketId(edit.marketId)}
                            className="accent-accent-primary"
                            title="Use as max-catcher (absorbs rounding dust)"
                          />
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

            {/* Simulation Results */}
            {simulation && simulation.isValid && (
              <SimulationPanel simulation={simulation} />
            )}
            {simulation && !simulation.isValid && simulation.error && (
              <div className="text-xs text-danger bg-danger/10 border border-danger/20 px-3 py-2">
                Simulation failed: {simulation.error.slice(0, 200)}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              {sdkSupported && (
                <Button
                  variant="secondary"
                  onClick={handleSimulate}
                  disabled={!hasChanges || isSimulating}
                  loading={isSimulating}
                >
                  {isSimulating ? 'Simulating...' : 'Simulate'}
                </Button>
              )}
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
              {txError && (
                <span className="text-xs text-danger">{(txError as Error).message?.slice(0, 100)}</span>
              )}
              <Button
                variant="ghost"
                onClick={() => { setEdits(new Map()); resetTx(); }}
                disabled={!hasChanges}
              >
                Reset
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Public Allocator Configuration */}
      {vault?.version === 'v1' && markets && allocation && (
        <PublicAllocatorPanel
          chainId={chainId}
          vaultAddress={vaultAddress}
          isOwner={role.isOwner}
          isCurator={role.isCurator}
          assetSymbol={vault.assetInfo.symbol}
          assetDecimals={vault.assetInfo.decimals}
          markets={allocationEdits.map((e) => ({
            marketId: e.marketId,
            label: e.label,
            currentSupply: e.currentAssets,
          }))}
        />
      )}
    </div>
  );
}

function SimulationPanel({ simulation }: { simulation: SimulationResult }) {
  return (
    <Card className="!p-3 bg-bg-hover border-info/20">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-tertiary uppercase font-medium">Simulation Preview</span>
          <Badge variant="info">SDK</Badge>
        </div>

        {/* Vault APY */}
        <div className="flex gap-6 text-xs">
          <div>
            <span className="text-text-tertiary">Vault APY: </span>
            <span className="font-mono text-text-primary">{formatApy(simulation.beforeApy)}</span>
            <span className="text-text-tertiary"> -&gt; </span>
            <span className={`font-mono ${simulation.afterApy > simulation.beforeApy ? 'text-success' : simulation.afterApy < simulation.beforeApy ? 'text-danger' : 'text-text-primary'}`}>
              {formatApy(simulation.afterApy)}
            </span>
          </div>
          <div>
            <span className="text-text-tertiary">Net APY: </span>
            <span className="font-mono text-text-primary">{formatApy(simulation.beforeNetApy)}</span>
            <span className="text-text-tertiary"> -&gt; </span>
            <span className={`font-mono ${simulation.afterNetApy > simulation.beforeNetApy ? 'text-success' : simulation.afterNetApy < simulation.beforeNetApy ? 'text-danger' : 'text-text-primary'}`}>
              {formatApy(simulation.afterNetApy)}
            </span>
          </div>
        </div>

        {/* Per-market impacts */}
        {simulation.marketImpacts.length > 0 && (
          <div className="space-y-1">
            {simulation.marketImpacts.map((m) => (
              <div key={m.marketId} className="flex items-center gap-3 text-xs">
                <span className="text-text-tertiary font-mono w-20 truncate">{m.label}</span>
                <span className="text-text-tertiary">Supply APY:</span>
                <span className="font-mono text-text-primary">{formatApy(m.beforeSupplyApy)}</span>
                <span className="text-text-tertiary">-&gt;</span>
                <span className={`font-mono ${m.afterSupplyApy > m.beforeSupplyApy ? 'text-success' : m.afterSupplyApy < m.beforeSupplyApy ? 'text-danger' : 'text-text-primary'}`}>
                  {formatApy(m.afterSupplyApy)}
                </span>
                <span className="text-text-tertiary">Util:</span>
                <span className="font-mono text-text-primary">{formatWadPercent(m.beforeUtilization)}</span>
                <span className="text-text-tertiary">-&gt;</span>
                <span className="font-mono text-text-primary">{formatWadPercent(m.afterUtilization)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function formatPercent(lltv: bigint): string {
  return `${(Number(lltv) / 1e18 * 100).toFixed(1)}%`;
}

function formatApy(apy: number): string {
  return `${(apy * 100).toFixed(2)}%`;
}

function formatWadPercent(wad: bigint): string {
  return `${(Number(wad) / 1e18 * 100).toFixed(1)}%`;
}
