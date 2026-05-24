import { useState, useMemo } from 'react';
import { formatUnits, parseUnits, encodeFunctionData, encodeAbiParameters, type Address } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useGuardedWriteContract } from '../../hooks/useGuardedWriteContract';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { SectionHeader } from '../ui/SectionHeader';
import { AddressDisplay } from '../ui/AddressDisplay';
import { useVaultInfo, useVaultRole } from '../../lib/hooks/useVault';
import { useV2AdapterOverview } from '../../lib/hooks/useV2Adapters';
import { useVaultPermissions } from '../../hooks/useVaultPermissions';
import { useV2AllocationData, type AllocationRow, type V2AllocationData } from '../../lib/hooks/useV2Allocation';
import { useChainGuard } from '../../lib/hooks/useChainGuard';
import { formatTokenAmount, truncateAddress } from '../../lib/utils/format';
import { isUnlimited } from '../../lib/v2/capComputation';
import { metaMorphoV2Abi } from '../../lib/contracts/metaMorphoV2Abi';
import { vaultKeys } from '../../lib/queryKeys';
import { SetLiquidityDrawer } from './adapters/SetLiquidityDrawer';
import type { MarketParams } from '../../types';

interface V2AllocationTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function V2AllocationTab({ chainId, vaultAddress }: V2AllocationTabProps) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const role = useVaultRole(chainId, vaultAddress);
  const { isMismatch, requestSwitch } = useChainGuard(chainId);

  const decimals = vault?.assetInfo.decimals ?? 18;
  const assetSymbol = vault?.assetInfo.symbol ?? '';
  const totalAssets = vault?.totalAssets ?? 0n;

  const { data: overview, isLoading: overviewLoading } = useV2AdapterOverview(chainId, vaultAddress, totalAssets);

  // Find the market-v1 adapter (the one with per-market positions)
  const marketAdapter = overview?.adapters.find((a) => a.type === 'market-v1') ?? null;

  const { data: allocationData, isLoading: allocLoading } = useV2AllocationData(
    chainId,
    vaultAddress,
    totalAssets,
    marketAdapter ?? undefined,
    assetSymbol,
    decimals,
    vault?.asset,
  );

  const [showMarketId, setShowMarketId] = useState(false);
  const [showReallocate, setShowReallocate] = useState(false);
  const [showSetLiquidity, setShowSetLiquidity] = useState(false);
  const permissions = useVaultPermissions(chainId, vaultAddress);

  const canReallocate = role.isAllocator || role.isOwner;
  const isLoading = overviewLoading || allocLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-shimmer h-10 bg-bg-hover" />
        <div className="animate-shimmer h-64 bg-bg-hover" />
      </div>
    );
  }

  if (!marketAdapter) {
    return (
      <Card className="py-8 text-center">
        <p className="text-text-tertiary text-sm">No Market V1 Adapter found.</p>
        <p className="text-text-tertiary text-xs mt-1">
          This tab shows per-market allocation for V2 vaults with a Market V1 Adapter.
          Check the <span className="text-accent-primary font-medium">Adapters</span> tab.
        </p>
      </Card>
    );
  }

  // PR 24 — keep the table visible whenever there's at least one market
  // row (caps-discovered counts), not just allocated positions. The user
  // wants to SEE configured markets even at 0 allocation.
  if (!allocationData) {
    return (
      <Card className="py-8 text-center">
        <p className="text-text-tertiary text-sm">Loading allocation data…</p>
      </Card>
    );
  }
  const marketRowCount = allocationData.rows.filter((r) => r.type === 'market').length;
  if (marketRowCount === 0) {
    return (
      <Card className="py-8 text-center">
        <p className="text-text-tertiary text-sm">No markets configured for this adapter.</p>
        <p className="text-text-tertiary text-[10px] mt-1">
          Use <span className="font-mono">Add Market</span> in the Adapters tab to register a market with caps.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {isMismatch && (
        <div className="flex items-center justify-between bg-warning/10 border border-warning/20 px-3 py-2">
          <span className="text-xs text-warning">Wallet is on the wrong network.</span>
          <Button size="sm" variant="secondary" onClick={requestSwitch}>Switch Network</Button>
        </div>
      )}

      {/* PR 33 — Liquidity Adapter panel (mirrors Morpho's curator UI).
          Shows the active adapter the vault routes new deposits to + the
          current allocation, with a Change button that opens the existing
          SetLiquidityDrawer (PR 14/17). Curator/manager gated. */}
      <LiquidityAdapterPanel
        chainId={chainId}
        adapters={overview?.adapters ?? []}
        currentLiquidityAdapter={overview?.liquidityAdapter ?? null}
        marketAdapter={marketAdapter}
        decimals={decimals}
        assetSymbol={assetSymbol}
        canChange={permissions.canCurate || permissions.canManage || permissions.isAdmin}
        onChange={() => setShowSetLiquidity(true)}
      />

      {/* SetLiquidityDrawer (PR 14/17) — same component used on the
          Adapters tab's "No Liquidity Adapter Set" banner. */}
      <SetLiquidityDrawer
        open={showSetLiquidity}
        onClose={() => setShowSetLiquidity(false)}
        adapters={overview?.adapters ?? []}
        currentLiquidityAdapter={overview?.liquidityAdapter ?? null}
        vaultAddress={vaultAddress}
        chainId={chainId}
        decimals={decimals}
        assetSymbol={assetSymbol}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <SectionHeader>Reallocate Funds</SectionHeader>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-text-tertiary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showMarketId}
              onChange={(e) => setShowMarketId(e.target.checked)}
              className="accent-accent-primary"
            />
            Show Market ID
          </label>
          {canReallocate && (
            <Button size="sm" onClick={() => setShowReallocate(true)}>
              Reallocate
            </Button>
          )}
        </div>
      </div>

      {/* Allocation Table */}
      <AllocationTable
        data={allocationData}
        showMarketId={showMarketId}
      />

      {/* Reallocate Dialog */}
      {showReallocate && allocationData && (
        <ReallocateDialog
          data={allocationData}
          vaultAddress={vaultAddress}
          chainId={chainId}
          onClose={() => setShowReallocate(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// Allocation Table
// ============================================================

/**
 * PR 33 — Morpho-curator-style "Liquidity Adapter" panel at the top of the
 * Allocation tab.
 *
 * Three rows:
 *   - Liquidity Adapter (section header + Change button)
 *   - Active Adapter: name + type badge + address of the currently-
 *     designated liquidity adapter. Falls back to "None" with a styled
 *     warning when zero.
 *   - Current Allocation: realAssets of the active adapter (or 0 if none).
 *
 * The Change button reuses the existing SetLiquidityDrawer (PR 14/17) so
 * the on-chain call (`setLiquidityAdapterAndData`) and the empty-bytes
 * default stay consistent across surfaces.
 */
function LiquidityAdapterPanel({
  chainId,
  adapters,
  currentLiquidityAdapter,
  marketAdapter,
  decimals,
  assetSymbol,
  canChange,
  onChange,
}: {
  chainId: number;
  adapters: Array<{ address: Address; name: string | null; realAssets: bigint; type: 'vault-v1' | 'market-v1' | 'unknown' }>;
  currentLiquidityAdapter: Address | null;
  marketAdapter: { address: Address; name: string | null; realAssets: bigint } | null;
  decimals: number;
  assetSymbol: string;
  canChange: boolean;
  onChange: () => void;
}) {
  const active = currentLiquidityAdapter
    ? adapters.find((a) => a.address.toLowerCase() === currentLiquidityAdapter.toLowerCase()) ?? null
    : null;

  return (
    <Card className="!p-0 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle">
        <SectionHeader>Liquidity Adapter</SectionHeader>
        <Button size="sm" variant="secondary" disabled={!canChange} onClick={onChange}>
          Change
        </Button>
      </div>

      {/* Active Adapter row */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle">
        <span className="text-xs text-text-tertiary">Active Adapter</span>
        {active ? (
          <div className="flex items-center gap-2">
            <span className="text-text-primary text-xs">
              {active.name ?? `Adapter ${active.address.slice(0, 10)}`}
            </span>
            {active.type === 'market-v1' && <Badge variant="success">MKT</Badge>}
            {active.type === 'vault-v1' && <Badge variant="info">V1</Badge>}
            <AddressDisplay address={active.address} chainId={chainId} />
          </div>
        ) : (
          <span className="text-xs text-warning">None — new deposits will sit idle</span>
        )}
      </div>

      {/* Current Allocation row */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-xs text-text-tertiary">Current Allocation</span>
        <span className="text-text-primary text-xs font-mono">
          {formatTokenAmount(active?.realAssets ?? marketAdapter?.realAssets ?? 0n, decimals)} {assetSymbol}
        </span>
      </div>
    </Card>
  );
}

function AllocationTable({
  data,
  showMarketId,
}: {
  data: V2AllocationData;
  showMarketId: boolean;
}) {
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
              <th className="text-left py-2.5 px-3 font-medium">Market</th>
              <th className="text-right py-2.5 px-3 font-medium">Eff. Abs. Cap</th>
              <th className="text-right py-2.5 px-3 font-medium">Eff. Rel. Cap</th>
              <th className="text-right py-2.5 px-3 font-medium">Share</th>
              <th className="text-right py-2.5 px-3 font-medium">Liquidity</th>
              <th className="text-right py-2.5 px-3 font-medium">% Allocated</th>
              <th className="text-right py-2.5 px-3 font-medium">Allocation</th>
              {showMarketId && (
                <th className="text-left py-2.5 px-3 font-medium">Market ID</th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <AllocationRowComponent
                key={row.type === 'idle' ? 'idle' : row.marketId}
                row={row}
                assetSymbol={data.assetSymbol}
                decimals={data.assetDecimals}
                showMarketId={showMarketId}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ============================================================
// Allocation Row
// ============================================================

function formatCompactAmount(value: bigint, decimals: number, symbol: string): string {
  const num = Number(formatUnits(value, decimals));
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M ${symbol}`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K ${symbol}`;
  return `${num.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${symbol}`;
}

function formatAbsCap(value: bigint | undefined, decimals: number, symbol: string): string {
  if (!value || isUnlimited(value)) return '∞';
  return formatCompactAmount(value, decimals, symbol);
}

function formatRelCap(value: bigint | undefined): string {
  if (!value || isUnlimited(value)) return '∞';
  return `${(Number(value) / 1e16).toFixed(0)}%`;
}

function AllocationRowComponent({
  row,
  assetSymbol,
  decimals,
  showMarketId,
}: {
  row: AllocationRow;
  assetSymbol: string;
  decimals: number;
  showMarketId: boolean;
}) {
  const isIdle = row.type === 'idle';
  const hasAllocation = row.allocation > 0n;

  return (
    <tr className="border-b border-border-subtle/50 hover:bg-bg-hover/30">
      {/* Market name */}
      <td className="py-2.5 px-3">
        {isIdle ? (
          <span className="text-text-tertiary font-medium">Idle</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-text-primary font-medium">
              {row.collateralSymbol}/{row.loanSymbol}
            </span>
            <Badge>{row.lltv?.toFixed(0)}%</Badge>
          </div>
        )}
      </td>

      {/* Eff. Abs. Cap */}
      <td className="py-2.5 px-3 text-right font-mono text-text-primary">
        {isIdle ? '' : formatAbsCap(row.effectiveAbsCap, decimals, assetSymbol)}
      </td>

      {/* Eff. Rel. Cap */}
      <td className="py-2.5 px-3 text-right font-mono text-text-primary">
        {isIdle ? '' : formatRelCap(row.effectiveRelCap)}
      </td>

      {/* Share */}
      <td className="py-2.5 px-3 text-right font-mono text-text-primary">
        {isIdle ? '' : `${row.share?.toFixed(2)}%`}
      </td>

      {/* Liquidity */}
      <td className="py-2.5 px-3 text-right font-mono text-text-primary">
        {isIdle ? '' : formatCompactAmount(row.liquidity ?? 0n, decimals, assetSymbol)}
      </td>

      {/* % Allocated */}
      <td className="py-2.5 px-3 text-right">
        {isIdle ? '' : (
          <div className="flex items-center justify-end gap-1.5">
            {hasAllocation && (
              <div className="w-1.5 h-1.5 bg-accent-primary" />
            )}
            <span className="font-mono text-text-primary">{row.percentAllocated.toFixed(2)}%</span>
          </div>
        )}
      </td>

      {/* Allocation */}
      <td className="py-2.5 px-3 text-right font-mono font-medium text-text-primary">
        {formatTokenAmount(row.allocation, decimals)} {assetSymbol}
      </td>

      {/* Market ID */}
      {showMarketId && (
        <td className="py-2.5 px-3 font-mono text-text-tertiary text-[10px]">
          {isIdle ? '—' : truncateAddress(row.marketId ?? '', 6)}
        </td>
      )}
    </tr>
  );
}

// ============================================================
// Reallocate Dialog
// ============================================================

function ReallocateDialog({
  data,
  vaultAddress,
  chainId,
  onClose,
}: {
  data: V2AllocationData;
  vaultAddress: Address;
  chainId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { writeContract, data: hash, isPending, error: txError } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const marketRows = data.rows.filter((r): r is AllocationRow & { type: 'market' } => r.type === 'market');

  const [targets, setTargets] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const row of marketRows) {
      const num = Number(formatUnits(row.allocation, data.assetDecimals));
      init[row.marketId!] = num.toString();
    }
    return init;
  });

  // Compute totals
  const totalTarget = useMemo(() => {
    return Object.values(targets).reduce((sum, v) => sum + (parseFloat(v) || 0), 0);
  }, [targets]);

  const totalAvailable = Number(formatUnits(data.totalAssets, data.assetDecimals));
  const newIdle = totalAvailable - totalTarget;
  const isValid = newIdle >= -0.001; // small tolerance for floating point

  // Check if anything changed
  const hasChanges = useMemo(() => {
    return marketRows.some((row) => {
      const current = Number(formatUnits(row.allocation, data.assetDecimals));
      const target = parseFloat(targets[row.marketId!]) || 0;
      return Math.abs(current - target) > 0.001;
    });
  }, [marketRows, targets, data.assetDecimals]);

  // On success, invalidate and close
  if (isSuccess) {
    queryClient.invalidateQueries({ queryKey: vaultKeys.detail(chainId, vaultAddress) });
    onClose();
  }

  const handleSubmit = () => {
    if (!isValid || !hasChanges) return;

    // Build allocations: withdrawals first, then supplies
    // V2 reallocate goes through the vault's allocate/deallocate on the adapter
    // But the spec says the adapter has a reallocate function directly
    // For V2, reallocation is done via vault.allocate() and vault.deallocate() calls
    // We'll use multicall to batch them

    const calls: `0x${string}`[] = [];
    const withdrawals: { row: AllocationRow; targetRaw: bigint }[] = [];
    const supplies: { row: AllocationRow; targetRaw: bigint }[] = [];

    for (const row of marketRows) {
      if (!row.params) continue;
      const targetNum = parseFloat(targets[row.marketId!]) || 0;
      const targetRaw = parseUnits(targetNum.toFixed(data.assetDecimals), data.assetDecimals);
      const current = row.allocation;

      if (targetRaw < current) {
        withdrawals.push({ row, targetRaw });
      } else if (targetRaw > current) {
        supplies.push({ row, targetRaw });
      }
    }

    // For V2 vaults: deallocate from markets, then allocate to markets
    // Each goes through vault.deallocate(adapter, data, totalAllocated) and vault.allocate(adapter, data, amount)
    // The `data` for market adapter encodes which market to target
    // This is a simplified version using the allocate/deallocate pattern

    for (const { row, targetRaw } of withdrawals) {
      if (!row.params) continue;
      const marketData = encodeMarketParams(row.params);
      calls.push(encodeDeallocate(data.adapterAddress, marketData, targetRaw));
    }

    for (const { row, targetRaw } of supplies) {
      if (!row.params) continue;
      const amount = targetRaw - row.allocation;
      const marketData = encodeMarketParams(row.params);
      calls.push(encodeAllocate(data.adapterAddress, marketData, amount));
    }

    if (calls.length === 0) return;

    if (calls.length === 1) {
      // Single call — decode and send directly
      // For simplicity, use multicall even for single
    }

    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'multicall',
      args: [calls],
      chainId,
    });
  };

  const isBusy = isPending || isConfirming;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-bg-surface border border-border-default w-full max-w-2xl max-h-[80vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-display text-text-primary">Reallocate Funds</h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary text-lg leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <p className="text-[10px] text-text-tertiary">
          Set target allocation for each market. Withdrawals are processed before supplies.
        </p>

        {/* Summary bar */}
        <div className="flex items-center justify-between p-3 bg-bg-hover/50 border border-border-subtle text-xs">
          <div>
            <span className="text-text-tertiary">Available: </span>
            <span className="font-mono text-text-primary">{totalAvailable.toLocaleString()} {data.assetSymbol}</span>
          </div>
          <div>
            <span className="text-text-tertiary">Allocated: </span>
            <span className="font-mono text-text-primary">{totalTarget.toLocaleString()} {data.assetSymbol}</span>
          </div>
          <div>
            <span className="text-text-tertiary">Idle after: </span>
            <span className={`font-mono font-medium ${newIdle < 0 ? 'text-danger' : 'text-accent-primary'}`}>
              {newIdle.toLocaleString()} {data.assetSymbol}
            </span>
          </div>
        </div>

        {newIdle < -0.001 && (
          <div className="text-xs text-danger bg-danger/10 border border-danger/20 p-2">
            Allocation exceeds available funds by {Math.abs(newIdle).toLocaleString()} {data.assetSymbol}.
          </div>
        )}

        {/* Per-market inputs */}
        <div className="space-y-2">
          {marketRows.map((row) => {
            const currentStr = formatTokenAmount(row.allocation, data.assetDecimals);
            return (
              <div key={row.marketId} className="flex items-center gap-3 p-3 bg-bg-hover/30 border border-border-subtle">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-text-primary font-medium truncate">
                      {row.collateralSymbol}/{row.loanSymbol}
                    </span>
                    <Badge>{row.lltv?.toFixed(0)}%</Badge>
                  </div>
                  <div className="text-[10px] text-text-tertiary mt-0.5">
                    Current: {currentStr} {data.assetSymbol}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={targets[row.marketId!] || '0'}
                    onChange={(e) => setTargets({ ...targets, [row.marketId!]: e.target.value })}
                    className="w-32 bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-right text-text-primary font-mono focus:outline-none focus:border-border-focus"
                    min="0"
                    step="any"
                  />
                  <span className="text-xs text-text-tertiary w-10">{data.assetSymbol}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!isValid || !hasChanges || isBusy}
            loading={isBusy}
          >
            {isPending ? 'Confirm...' : isConfirming ? 'Confirming...' : 'Confirm Reallocation'}
          </Button>
        </div>

        {txError && (
          <p className="text-[10px] text-danger max-h-20 overflow-y-auto">{(txError as Error).message}</p>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ABI encoding helpers for multicall
// ============================================================

function encodeMarketParams(params: MarketParams): `0x${string}` {
  return encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'address' },
      { type: 'address' },
      { type: 'uint256' },
    ],
    [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv],
  );
}

function encodeAllocate(adapter: Address, data: `0x${string}`, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: metaMorphoV2Abi,
    functionName: 'allocate',
    args: [adapter, data, amount],
  });
}

function encodeDeallocate(adapter: Address, data: `0x${string}`, totalAllocated: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: metaMorphoV2Abi,
    functionName: 'deallocate',
    args: [adapter, data, totalAllocated],
  });
}
