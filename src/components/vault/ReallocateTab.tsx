import { useState, useMemo, useCallback } from 'react';
import { formatUnits } from 'viem';
import type { Address } from 'viem';
import type { MarketId } from '@morpho-org/blue-sdk';
import { Lock, Unlock, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useVaultInfo, useVaultAllocation, useVaultMarketsFromApi, useVaultRole } from '../../lib/hooks/useVault';
import { formatTokenAmount, parseTokenAmount, formatApyDisplay, getApyColorClass } from '../../lib/utils/format';
import { useChainGuard } from '../../lib/hooks/useChainGuard';
import { isMorphoSdkSupported } from '../../lib/morpho/sdk-config';
import {
  useReallocationSimulation,
  type AllocationChange,
  type SimulationResult,
} from '../../hooks/morpho-sdk/useReallocationSimulation';
import {
  useReallocate,
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
  isIdle: boolean;
  supplyApy: number;
  utilization: number;
  totalSupplyAssets: bigint;
  totalBorrowAssets: bigint;
  lltv: bigint;
}

// ============================================================
// Normalize decimal input: handle EU-style commas vs thousands separators
// If the string contains a dot, commas are thousands separators (strip them).
// If no dot, treat the LAST comma as decimal separator.
// ============================================================

function normalizeDecimalInput(input: string): string {
  if (!input) return input;
  if (input.includes('.')) {
    // Dot present — commas are thousands separators
    return input.replace(/,/g, '');
  }
  // No dot — treat last comma as decimal point
  const lastComma = input.lastIndexOf(',');
  if (lastComma === -1) return input;
  return input.slice(0, lastComma).replace(/,/g, '') + '.' + input.slice(lastComma + 1);
}

// ============================================================
// Token Amount Input — format on blur, raw on focus
// ============================================================

function TokenAmountInput({
  value,
  decimals,
  onChange,
  disabled,
  error,
  className,
}: {
  value: bigint;
  decimals: number;
  onChange: (v: bigint) => void;
  disabled?: boolean;
  error?: boolean;
  className?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [rawInput, setRawInput] = useState('');

  const formattedValue = formatTokenAmount(value, decimals, 6);
  const rawValue = formatUnits(value, decimals);

  const handleFocus = () => {
    setIsFocused(true);
    setRawInput(rawValue);
  };

  const handleBlur = () => {
    setIsFocused(false);
    const parsed = parseTokenAmount(normalizeDecimalInput(rawInput) || '0', decimals);
    onChange(parsed);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    // Allow digits, one decimal point, and commas
    const cleaned = input.replace(/[^0-9.,]/g, '');
    setRawInput(cleaned);
    const parsed = parseTokenAmount(normalizeDecimalInput(cleaned) || '0', decimals);
    onChange(parsed);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={isFocused ? rawInput : formattedValue}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={handleChange}
      disabled={disabled}
      className={`w-32 bg-bg-hover border px-2 py-1 text-right text-sm font-mono ${
        disabled ? 'opacity-50 cursor-not-allowed text-text-tertiary' : ''
      } ${
        error ? 'border-danger/40 text-danger' : 'border-border-default text-text-primary'
      } ${className ?? ''}`}
    />
  );
}

// ============================================================
// Simulation Error Parser
// ============================================================

interface ParsedError {
  message: string;
  severity: 'error' | 'warning';
  suggestion?: string;
  raw: string;
}

function parseSimulationError(error: string): ParsedError {
  if (error.includes('unknown holding')) {
    return {
      message: 'Simulation cannot determine vault token balance',
      severity: 'warning',
      suggestion: 'This is likely a simulator limitation. The on-chain transaction may still succeed — try executing directly.',
      raw: error,
    };
  }
  if (error.includes('insufficient') || error.includes('liquidity')) {
    return {
      message: 'Insufficient liquidity to complete this reallocation',
      severity: 'error',
      suggestion: 'Reduce the withdrawal amount from the affected market.',
      raw: error,
    };
  }
  if (error.includes('cap') || error.includes('exceeds')) {
    return {
      message: 'Target exceeds supply cap for one or more markets',
      severity: 'error',
      suggestion: 'Lower the target amount below the market supply cap.',
      raw: error,
    };
  }
  return { message: 'Simulation failed', severity: 'error', raw: error };
}

// ============================================================
// Main Component
// ============================================================

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
  const [idleAutoMode, setIdleAutoMode] = useState(true);

  const sdkSupported = isMorphoSdkSupported(chainId);
  const assetDecimals = vault?.assetInfo.decimals ?? 18;
  const assetSymbol = vault?.assetInfo.symbol ?? '???';

  // Identify the IDLE "market" — it's the allocation entry where utilization is 0%
  // and collateral token is zero address (i.e., no collateral = idle funds)
  // In Morpho, IDLE is represented by having supplyAssets in the vault but not allocated to any market
  // The allocation list includes all queue entries — the one with the zero-address collateral is IDLE
  const idleMarketId = useMemo(() => {
    if (!allocation?.allocations || !markets) return null;
    for (const a of allocation.allocations) {
      const market = markets.find((m) => m.id === a.marketId);
      if (market && market.collateralToken.address === '0x0000000000000000000000000000000000000000') {
        return a.marketId;
      }
    }
    return null;
  }, [allocation, markets]);

  // Build allocationEdits with IDLE detection
  const allocationEdits = useMemo<AllocationEdit[]>(() => {
    if (!allocation?.allocations || !markets) return [];

    return allocation.allocations.map((a) => {
      const market = markets.find((m) => m.id === a.marketId);
      const isIdle = a.marketId === idleMarketId;
      return {
        marketId: a.marketId,
        currentAssets: a.supplyAssets,
        targetAssets: edits.get(a.marketId) ?? a.supplyAssets,
        label: isIdle ? 'IDLE' : market
          ? `${market.collateralToken.symbol} ${formatLltv(market.params.lltv)}`
          : a.marketId.slice(0, 10),
        cap: a.supplyCap,
        isIdle,
        supplyApy: isIdle ? 0 : (market?.supplyAPY ?? 0),
        utilization: isIdle ? 0 : (market?.utilization ?? 0),
        totalSupplyAssets: market?.state.totalSupplyAssets ?? 0n,
        totalBorrowAssets: market?.state.totalBorrowAssets ?? 0n,
        lltv: market?.params.lltv ?? 0n,
      };
    });
  }, [allocation, markets, edits, idleMarketId]);

  // Auto-compute IDLE target when in auto mode
  // Use sum of current allocations (not totalAssets) to avoid rounding mismatch
  // between ERC-4626 totalAssets() and the sum of per-market supplyAssets
  const totalAllocated = useMemo(() => {
    return allocationEdits.reduce((sum, e) => sum + e.currentAssets, 0n);
  }, [allocationEdits]);

  const allocationEditsWithIdle = useMemo(() => {
    if (!idleAutoMode || !idleMarketId) return allocationEdits;

    const nonIdleSum = allocationEdits
      .filter((e) => !e.isIdle)
      .reduce((sum, e) => sum + e.targetAssets, 0n);

    const idleTarget = totalAllocated > nonIdleSum ? totalAllocated - nonIdleSum : 0n;
    if (nonIdleSum > totalAllocated) {
      console.warn('[ReallocateTab] Non-idle targets exceed total allocated — IDLE clipped to 0');
    }

    return allocationEdits.map((e) => {
      if (e.isIdle) {
        return { ...e, targetAssets: idleTarget };
      }
      return e;
    });
  }, [allocationEdits, idleAutoMode, idleMarketId, totalAllocated]);

  // Auto-select catcher: must be a SUPPLY market (target > current) so MAX_UINT256
  // absorbs dust correctly. Prefer IDLE, then the supply entry with the largest target.
  // NEVER pick a withdrawal market — MAX_UINT256 would reverse its direction and revert.
  const effectiveCatcher = catcherMarketId ?? (() => {
    if (allocationEditsWithIdle.length === 0) return null;
    // Prefer IDLE as catcher if it's receiving funds (target >= current)
    const idle = allocationEditsWithIdle.find((e) => e.isIdle && e.targetAssets >= e.currentAssets);
    if (idle) return idle.marketId;
    // Otherwise pick the supply market with the largest target
    const supplyMarkets = allocationEditsWithIdle.filter((e) => e.targetAssets > e.currentAssets);
    if (supplyMarkets.length > 0) {
      return supplyMarkets.reduce((max, e) => e.targetAssets > max.targetAssets ? e : max, supplyMarkets[0]).marketId;
    }
    // Fallback: IDLE even if decreasing (it's the safest catcher)
    const idleAny = allocationEditsWithIdle.find((e) => e.isIdle);
    if (idleAny) return idleAny.marketId;
    // Last resort: largest target
    return allocationEditsWithIdle.reduce((max, e) => e.targetAssets > max.targetAssets ? e : max, allocationEditsWithIdle[0]).marketId;
  })();

  // Balance check
  const totalWithdrawn = allocationEditsWithIdle.reduce(
    (s, e) => s + (e.targetAssets < e.currentAssets ? e.currentAssets - e.targetAssets : 0n),
    0n,
  );
  const totalSupplied = allocationEditsWithIdle.reduce(
    (s, e) => s + (e.targetAssets > e.currentAssets ? e.targetAssets - e.currentAssets : 0n),
    0n,
  );
  const isBalanced = totalWithdrawn === totalSupplied;
  const hasChanges = allocationEditsWithIdle.some((e) => e.targetAssets !== e.currentAssets);
  const imbalanceAmount = totalWithdrawn > totalSupplied ? totalWithdrawn - totalSupplied : totalSupplied - totalWithdrawn;

  // Validations
  const capViolations = allocationEditsWithIdle
    .filter((e) => e.targetAssets > e.cap && e.cap > 0n)
    .map((e) => ({ label: e.label, target: e.targetAssets, cap: e.cap }));

  // Warn if the catcher market's target is at its cap — MAX_UINT256 dust absorption
  // will push it over the cap and revert with InconsistentReallocation or SupplyCapExceeded
  const catcherAtCap = (() => {
    const ce = allocationEditsWithIdle.find((e) => e.marketId === effectiveCatcher);
    if (!ce || ce.cap === 0n) return false;
    return ce.targetAssets >= ce.cap;
  })();

  // Projected vault APY = weighted average of per-market supply APY by target allocation
  const projectedApy = useMemo(() => {
    if (!hasChanges || totalAllocated === 0n) return null;
    let weightedSum = 0;
    for (const e of allocationEditsWithIdle) {
      const weight = Number(e.targetAssets) / Number(totalAllocated);
      weightedSum += weight * e.supplyApy;
    }
    return weightedSum;
  }, [allocationEditsWithIdle, hasChanges, totalAllocated]);

  const currentWeightedApy = useMemo(() => {
    if (totalAllocated === 0n) return null;
    let weightedSum = 0;
    for (const e of allocationEditsWithIdle) {
      const weight = Number(e.currentAssets) / Number(totalAllocated);
      weightedSum += weight * e.supplyApy;
    }
    return weightedSum;
  }, [allocationEditsWithIdle, totalAllocated]);

  const handleTargetChange = useCallback((marketId: string, value: bigint) => {
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(marketId, value);
      return next;
    });
  }, []);

  const handleQuickAction = useCallback((marketId: string, action: 'zero' | 'current' | 'max', currentAssets: bigint, cap: bigint) => {
    setEdits((prev) => {
      const next = new Map(prev);
      if (action === 'zero') next.set(marketId, 0n);
      else if (action === 'current') next.delete(marketId);
      else if (action === 'max') next.set(marketId, cap > 0n ? cap : currentAssets);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setEdits(new Map());
    resetTx();
  }, [resetTx]);

  const handleAutoFixIdle = useCallback(() => {
    setIdleAutoMode(true);
  }, []);

  const handleSimulate = () => {
    if (!hasChanges || !sdkSupported) return;
    const changes: AllocationChange[] = allocationEditsWithIdle
      .filter((e) => e.targetAssets !== e.currentAssets)
      .map((e) => ({
        marketId: e.marketId as MarketId,
        targetAssets: e.targetAssets,
      }));
    simulate(changes);
  };

  const handleExecute = async () => {
    if (!isBalanced || !hasChanges || !markets) return;

    // Safety: if manually selected catcher is a withdrawal market, override to auto-select
    const catcherEdit = allocationEditsWithIdle.find((e) => e.marketId === effectiveCatcher);
    const safeCatcher = (catcherEdit && catcherEdit.targetAssets < catcherEdit.currentAssets)
      ? null // force auto-selection below
      : effectiveCatcher;

    // Build allocations for all changed markets EXCEPT the catcher
    // (the catcher will be appended last with MAX_UINT256)
    const changedAllocations: MarketAllocationArg[] = [];
    let catcherParams: MarketAllocationArg | null = null;

    for (const e of allocationEditsWithIdle) {
      const market = markets.find((m) => m.id === e.marketId);
      if (!market) continue;

      const isCatcher = e.marketId === safeCatcher;

      if (isCatcher) {
        // Save catcher separately — will be appended with MAX_UINT256
        catcherParams = { marketParams: market.params, assets: e.targetAssets };
      } else if (e.targetAssets !== e.currentAssets) {
        changedAllocations.push({
          marketParams: market.params,
          assets: e.targetAssets,
        });
      }
    }

    // Build current assets map for ordering
    const currentAssetsMap = new Map<string, bigint>();
    for (const e of allocationEditsWithIdle) {
      const market = markets.find((m) => m.id === e.marketId);
      if (market) {
        const key = `${market.params.loanToken}-${market.params.collateralToken}-${market.params.oracle}-${market.params.irm}-${market.params.lltv}`;
        currentAssetsMap.set(key, e.currentAssets);
      }
    }

    // Sort: withdrawals first (target < current), then supplies
    changedAllocations.sort((a, b) => {
      const aKey = `${a.marketParams.loanToken}-${a.marketParams.collateralToken}-${a.marketParams.oracle}-${a.marketParams.irm}-${a.marketParams.lltv}`;
      const bKey = `${b.marketParams.loanToken}-${b.marketParams.collateralToken}-${b.marketParams.oracle}-${b.marketParams.irm}-${b.marketParams.lltv}`;
      const aDelta = a.assets - (currentAssetsMap.get(aKey) ?? 0n);
      const bDelta = b.assets - (currentAssetsMap.get(bKey) ?? 0n);
      if (aDelta < 0n && bDelta >= 0n) return -1;
      if (aDelta >= 0n && bDelta < 0n) return 1;
      return 0;
    });

    // Append catcher last — use MAX_UINT256 only if the market has headroom under its cap.
    // If the catcher's target is at or near its supply cap, MAX_UINT256 would push it over
    // the cap (the contract supplies ALL remaining vault balance, which may exceed the cap
    // by rounding dust). In that case, use the exact target amount and let dust stay idle.
    const MAX_UINT256 = 2n ** 256n - 1n;
    if (catcherParams) {
      const catcherCap = catcherEdit?.cap ?? 0n;
      const catcherTarget = catcherEdit?.targetAssets ?? 0n;
      // Use MAX_UINT256 only if cap is 0 (unlimited) or target is well below the cap
      const hasCapHeadroom = catcherCap === 0n || catcherTarget < catcherCap;
      changedAllocations.push({
        ...catcherParams,
        assets: hasCapHeadroom ? MAX_UINT256 : catcherParams.assets,
      });
    }

    await reallocate(changedAllocations);
  };

  // Loading
  if (allocLoading || marketsLoading) {
    return <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-16 bg-bg-hover animate-shimmer" />)}</div>;
  }

  // Error
  if (allocError || marketsError) {
    const err = allocError || marketsError;
    return (
      <Card className="py-8 text-center">
        <p className="text-danger text-sm">Failed to load allocation data</p>
        <p className="text-text-tertiary text-xs mt-1">{err instanceof Error ? err.message : 'Data fetch failed.'}</p>
      </Card>
    );
  }

  // Role guard
  if (!role.isAllocator && !role.isOwner) {
    return (
      <Card className="py-8 text-center">
        <p className="text-text-tertiary text-sm">
          You need the Allocator or Owner role to reallocate.
        </p>
      </Card>
    );
  }

  const canSimulate = hasChanges && sdkSupported && !isSimulating;
  const canExecute = isBalanced && hasChanges && capViolations.length === 0 && !isMismatch && !catcherAtCap;

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

        {allocationEditsWithIdle.length === 0 ? (
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
                    <th className="text-center py-2 w-6"></th>
                    <th className="text-right py-2">Target</th>
                    <th className="text-right py-2">Delta</th>
                    <th className="text-right py-2">Util</th>
                    <th className="text-right py-2">APY</th>
                    <th className="text-right py-2">Supply Cap</th>
                    <th className="text-center py-2 w-8">Catcher</th>
                    <th className="text-right py-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {allocationEditsWithIdle.map((edit) => {
                    const delta = edit.targetAssets - edit.currentAssets;
                    const overCap = edit.cap > 0n && edit.targetAssets > edit.cap;
                    const isCatcher = edit.marketId === effectiveCatcher;
                    const isChanged = edit.targetAssets !== edit.currentAssets;
                    const isIdleLocked = edit.isIdle && idleAutoMode;

                    return (
                      <tr
                        key={edit.marketId}
                        className={`border-b border-border-subtle/50 ${
                          isChanged ? 'bg-accent-primary-muted/20' : ''
                        } ${edit.isIdle ? 'bg-bg-hover/30' : ''}`}
                      >
                        {/* Market label */}
                        <td className="py-2 text-text-primary">
                          <div className="flex items-center gap-1.5">
                            <span>{edit.label}</span>
                            {isIdleLocked && (
                              <Badge variant="default" className="text-[9px] py-0 px-1">AUTO</Badge>
                            )}
                          </div>
                        </td>

                        {/* Current */}
                        <td className="text-right py-2 text-text-secondary font-mono">
                          {formatTokenAmount(edit.currentAssets, assetDecimals, 2)}
                        </td>

                        {/* Arrow */}
                        <td className="text-center py-2 text-text-tertiary/50 text-xs">&rarr;</td>

                        {/* Target input */}
                        <td className="text-right py-2">
                          <div className="flex items-center justify-end gap-1">
                            {edit.isIdle && (
                              <button
                                onClick={() => setIdleAutoMode(!idleAutoMode)}
                                className="text-text-tertiary hover:text-text-primary p-0.5"
                                title={idleAutoMode ? 'Unlock IDLE (manual mode)' : 'Lock IDLE (auto-balance)'}
                                aria-label={idleAutoMode ? 'Unlock IDLE for manual editing' : 'Lock IDLE for auto-balance'}
                              >
                                {idleAutoMode ? <Lock size={12} /> : <Unlock size={12} />}
                              </button>
                            )}
                            <TokenAmountInput
                              value={edit.targetAssets}
                              decimals={assetDecimals}
                              onChange={(v) => handleTargetChange(edit.marketId, v)}
                              disabled={isIdleLocked}
                              error={overCap}
                            />
                          </div>
                        </td>

                        {/* Delta */}
                        <td className={`text-right py-2 font-mono text-xs ${
                          delta > 0n ? 'text-success' : delta < 0n ? 'text-danger' : 'text-text-tertiary'
                        }`}>
                          {delta === 0n ? '—' : (
                            <>
                              {delta > 0n ? '+' : '-'}
                              {formatTokenAmount(delta < 0n ? -delta : delta, assetDecimals, 2)}
                            </>
                          )}
                        </td>

                        {/* Utilization: current → projected */}
                        <td className="text-right py-2 font-mono text-xs">
                          {edit.isIdle ? (
                            <span className="text-text-tertiary">—</span>
                          ) : (() => {
                            const projected = computeProjectedUtilization(edit);
                            const isChanged = edit.targetAssets !== edit.currentAssets;
                            return (
                              <span className="whitespace-nowrap">
                                <span className={getUtilColorClass(edit.utilization, edit.lltv)}>
                                  {formatUtilPercent(edit.utilization)}
                                </span>
                                {isChanged && projected != null && (
                                  <>
                                    <span className="text-text-tertiary/50 mx-0.5">&rarr;</span>
                                    <span className={getUtilChangeClass(edit.utilization, projected)}>
                                      {formatUtilPercent(projected)}
                                    </span>
                                  </>
                                )}
                              </span>
                            );
                          })()}
                        </td>

                        {/* APY */}
                        <td className={`text-right py-2 font-mono text-xs ${getApyColorClass(edit.supplyApy)}`}>
                          {formatApyDisplay(edit.supplyApy)}
                        </td>

                        {/* Supply Cap */}
                        <td className={`text-right py-2 font-mono text-xs ${
                          overCap ? 'text-danger' : 'text-text-tertiary'
                        }`}>
                          {formatTokenAmount(edit.cap, assetDecimals, 0)}
                        </td>

                        {/* Catcher radio */}
                        <td className="text-center py-2">
                          <input
                            type="radio"
                            name="catcher"
                            checked={isCatcher}
                            onChange={() => setCatcherMarketId(edit.marketId)}
                            disabled={edit.targetAssets < edit.currentAssets}
                            className="accent-accent-primary disabled:opacity-30 disabled:cursor-not-allowed"
                            title={edit.targetAssets < edit.currentAssets
                              ? "Cannot use a withdrawal market as catcher"
                              : "Use as max-catcher (absorbs rounding dust)"}
                          />
                        </td>

                        {/* Quick actions */}
                        <td className="text-right py-2">
                          {!isIdleLocked && (
                            <div className="flex gap-0.5 justify-end">
                              <button
                                onClick={() => handleQuickAction(edit.marketId, 'zero', edit.currentAssets, edit.cap)}
                                className="text-[9px] text-text-tertiary hover:text-danger px-1 py-0.5"
                                title="Set to zero (withdraw all)"
                              >
                                0
                              </button>
                              <button
                                onClick={() => handleQuickAction(edit.marketId, 'current', edit.currentAssets, edit.cap)}
                                className="text-[9px] text-text-tertiary hover:text-text-primary px-1 py-0.5"
                                title="Reset to current"
                              >
                                <RotateCcw size={10} />
                              </button>
                              {edit.cap > 0n && (
                                <button
                                  onClick={() => handleQuickAction(edit.marketId, 'max', edit.currentAssets, edit.cap)}
                                  className="text-[9px] text-text-tertiary hover:text-accent-primary px-1 py-0.5"
                                  title="Set to max cap"
                                >
                                  MAX
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Balance Status */}
            <BalanceStatus
              isBalanced={isBalanced}
              idleAutoMode={idleAutoMode}
              hasChanges={hasChanges}
              totalWithdrawn={totalWithdrawn}
              totalSupplied={totalSupplied}
              imbalanceAmount={imbalanceAmount}
              assetDecimals={assetDecimals}
              assetSymbol={assetSymbol}
              capViolations={capViolations}
              onAutoFix={handleAutoFixIdle}
            />

            {/* Projected APY */}
            {hasChanges && projectedApy != null && currentWeightedApy != null && (
              <div className="flex items-center gap-4 text-xs px-1">
                <span className="text-text-tertiary">Weighted APY:</span>
                <span className="font-mono text-text-primary">{formatApyDisplay(currentWeightedApy)}</span>
                <span className="text-text-tertiary">&rarr;</span>
                <span className={`font-mono font-medium ${getApyColorClass(projectedApy)}`}>
                  {formatApyDisplay(projectedApy)}
                </span>
                {projectedApy !== currentWeightedApy && (
                  <span className={`font-mono text-[10px] ${projectedApy > currentWeightedApy ? 'text-success' : 'text-danger'}`}>
                    ({formatApyDisplay(projectedApy - currentWeightedApy, { showPlus: true })})
                  </span>
                )}
              </div>
            )}

            {/* Catcher at cap warning */}
            {catcherAtCap && hasChanges && (
              <div className="flex items-center gap-2 text-xs text-warning bg-warning/10 border border-warning/20 px-3 py-2">
                <span>&#9888;</span>
                <span>
                  Catcher market is at its supply cap. Rounding dust may cause a revert.
                  Lower the target slightly below the cap or pick a different catcher with more headroom.
                </span>
              </div>
            )}

            {/* Simulation Results */}
            {simulation && simulation.isValid && (
              <SimulationPanel simulation={simulation} />
            )}
            {simulation && !simulation.isValid && simulation.error && (
              <SimulationErrorDisplay error={simulation.error} />
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              {sdkSupported && (
                <Button
                  variant="secondary"
                  onClick={handleSimulate}
                  disabled={!canSimulate}
                  loading={isSimulating}
                >
                  {isSimulating ? 'Simulating...' : !hasChanges ? 'No Changes' : 'Simulate'}
                </Button>
              )}
              <Button
                onClick={handleExecute}
                disabled={!canExecute}
                loading={isPending || isConfirming}
              >
                {isPending ? 'Signing...' : isConfirming ? 'Confirming...' : 'Execute Reallocation'}
              </Button>
              {isSuccess && (
                <Badge variant="success">Transaction confirmed</Badge>
              )}
              {txError && (
                <span className="text-xs text-danger max-h-20 overflow-y-auto block">{(txError as Error).message}</span>
              )}
              <Button
                variant="ghost"
                onClick={handleReset}
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
          markets={allocationEditsWithIdle.map((e) => ({
            marketId: e.marketId,
            label: e.label,
            currentSupply: e.currentAssets,
          }))}
        />
      )}
    </div>
  );
}

// ============================================================
// Balance Status Component
// ============================================================

function BalanceStatus({
  isBalanced,
  idleAutoMode,
  hasChanges,
  totalWithdrawn,
  totalSupplied,
  imbalanceAmount,
  assetDecimals,
  assetSymbol,
  capViolations,
  onAutoFix,
}: {
  isBalanced: boolean;
  idleAutoMode: boolean;
  hasChanges: boolean;
  totalWithdrawn: bigint;
  totalSupplied: bigint;
  imbalanceAmount: bigint;
  assetDecimals: number;
  assetSymbol: string;
  capViolations: Array<{ label: string; target: bigint; cap: bigint }>;
  onAutoFix: () => void;
}) {
  if (!hasChanges) {
    return (
      <div className="text-xs text-text-tertiary py-1">
        No changes — targets match current allocation.
      </div>
    );
  }

  return (
    <div className="space-y-1 text-xs">
      {/* Balance line */}
      {isBalanced && idleAutoMode && (
        <div className="flex items-center gap-2 text-success">
          <span>&#10003;</span>
          <span>Balanced — IDLE absorbs remainder automatically</span>
        </div>
      )}
      {isBalanced && !idleAutoMode && (
        <div className="flex items-center gap-2 text-success">
          <span>&#10003;</span>
          <span>
            Balanced — Withdrawn: {formatTokenAmount(totalWithdrawn, assetDecimals, 2)} = Supplied: {formatTokenAmount(totalSupplied, assetDecimals, 2)}
          </span>
        </div>
      )}
      {!isBalanced && (
        <div className="flex items-center gap-2 text-warning">
          <span>&#9888;</span>
          <span>
            Imbalanced by {formatTokenAmount(imbalanceAmount, assetDecimals, 2)} {assetSymbol} — Withdrawn: {formatTokenAmount(totalWithdrawn, assetDecimals, 2)} &#8800; Supplied: {formatTokenAmount(totalSupplied, assetDecimals, 2)}
          </span>
          {!idleAutoMode && (
            <button
              onClick={onAutoFix}
              className="text-accent-primary hover:text-accent-primary-hover underline ml-1"
            >
              Auto-fix: send remainder to IDLE
            </button>
          )}
        </div>
      )}

      {/* Cap violations */}
      {capViolations.map((v, i) => (
        <div key={i} className="flex items-center gap-2 text-danger">
          <span>!!</span>
          <span>{v.label}: target ({formatTokenAmount(v.target, assetDecimals, 2)}) exceeds cap ({formatTokenAmount(v.cap, assetDecimals, 2)})</span>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Simulation Error Display
// ============================================================

function SimulationErrorDisplay({ error }: { error: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const parsed = parseSimulationError(error);

  return (
    <div className={`text-xs border px-3 py-2 space-y-1.5 ${
      parsed.severity === 'warning'
        ? 'text-warning bg-warning/10 border-warning/20'
        : 'text-danger bg-danger/10 border-danger/20'
    }`}>
      <div className="font-medium">{parsed.message}</div>
      {parsed.suggestion && (
        <div className="text-text-secondary">{parsed.suggestion}</div>
      )}
      <button
        onClick={() => setShowRaw(!showRaw)}
        className="flex items-center gap-1 text-text-tertiary hover:text-text-primary"
      >
        {showRaw ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        Technical details
      </button>
      {showRaw && (
        <pre className="text-[10px] text-text-tertiary whitespace-pre-wrap break-all mt-1 max-h-32 overflow-y-auto">
          {error}
        </pre>
      )}
    </div>
  );
}

// ============================================================
// Simulation Panel
// ============================================================

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
            <span className="text-text-tertiary"> &rarr; </span>
            <span className={`font-mono ${simulation.afterApy > simulation.beforeApy ? 'text-success' : simulation.afterApy < simulation.beforeApy ? 'text-danger' : 'text-text-primary'}`}>
              {formatApy(simulation.afterApy)}
            </span>
          </div>
          <div>
            <span className="text-text-tertiary">Net APY: </span>
            <span className="font-mono text-text-primary">{formatApy(simulation.beforeNetApy)}</span>
            <span className="text-text-tertiary"> &rarr; </span>
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
                <span className="text-text-tertiary">&rarr;</span>
                <span className={`font-mono ${m.afterSupplyApy > m.beforeSupplyApy ? 'text-success' : m.afterSupplyApy < m.beforeSupplyApy ? 'text-danger' : 'text-text-primary'}`}>
                  {formatApy(m.afterSupplyApy)}
                </span>
                <span className="text-text-tertiary">Util:</span>
                <span className="font-mono text-text-primary">{formatWadPercent(m.beforeUtilization)}</span>
                <span className="text-text-tertiary">&rarr;</span>
                <span className="font-mono text-text-primary">{formatWadPercent(m.afterUtilization)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================================
// Helpers
// ============================================================

function formatLltv(lltv: bigint): string {
  return `${(Number(lltv) / 1e18 * 100).toFixed(1)}%`;
}

/**
 * Compute projected utilization after a vault reallocation delta.
 * delta = targetAssets - currentAssets (positive = more supply to this market)
 * projectedUtil = totalBorrowAssets / (totalSupplyAssets + delta)
 */
function computeProjectedUtilization(edit: AllocationEdit): number | null {
  if (edit.isIdle) return null;
  const delta = edit.targetAssets - edit.currentAssets;
  const projectedSupply = edit.totalSupplyAssets + delta;
  if (projectedSupply <= 0n) return edit.totalBorrowAssets > 0n ? 1 : 0;
  return Number(edit.totalBorrowAssets) / Number(projectedSupply);
}

function formatUtilPercent(util: number): string {
  return `${(util * 100).toFixed(1)}%`;
}

function getUtilColorClass(util: number, lltv: bigint): string {
  const lltvRatio = Number(lltv) / 1e18;
  // Critical: utilization > 91% of LLTV
  if (lltvRatio > 0 && util > lltvRatio * 0.91) return 'text-danger';
  // Warning: utilization > 80%
  if (util > 0.8) return 'text-warning';
  // Normal
  if (util > 0) return 'text-text-primary';
  return 'text-text-tertiary';
}

function getUtilChangeClass(current: number, projected: number): string {
  const diff = projected - current;
  if (Math.abs(diff) < 0.001) return 'text-text-tertiary';
  return diff > 0 ? 'text-warning' : 'text-success';
}

function formatApy(apy: number): string {
  return `${(apy * 100).toFixed(2)}%`;
}

function formatWadPercent(wad: bigint): string {
  return `${(Number(wad) / 1e18 * 100).toFixed(1)}%`;
}
