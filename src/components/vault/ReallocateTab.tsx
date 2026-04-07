import { useState, useMemo, useCallback } from 'react';
import { formatUnits } from 'viem';
import type { Address } from 'viem';
import type { MarketId } from '@morpho-org/blue-sdk';
import { Lock, Unlock, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
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
  isIdle: boolean;
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
    // Parse the final value
    const cleaned = rawInput.replace(/,/g, '.');
    const parsed = parseTokenAmount(cleaned || '0', decimals);
    onChange(parsed);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value;
    // Allow digits, one decimal point, and commas (which we'll normalize)
    const cleaned = input.replace(/[^0-9.,]/g, '');
    setRawInput(cleaned);
    // Live update the bigint value
    const normalized = cleaned.replace(/,/g, '.');
    const parsed = parseTokenAmount(normalized || '0', decimals);
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
      };
    });
  }, [allocation, markets, edits, idleMarketId]);

  // Auto-compute IDLE target when in auto mode
  const totalVaultAssets = vault?.totalAssets ?? 0n;

  const allocationEditsWithIdle = useMemo(() => {
    if (!idleAutoMode || !idleMarketId) return allocationEdits;

    const nonIdleSum = allocationEdits
      .filter((e) => !e.isIdle)
      .reduce((sum, e) => sum + e.targetAssets, 0n);

    const idleTarget = totalVaultAssets > nonIdleSum ? totalVaultAssets - nonIdleSum : 0n;

    return allocationEdits.map((e) => {
      if (e.isIdle) {
        return { ...e, targetAssets: idleTarget };
      }
      return e;
    });
  }, [allocationEdits, idleAutoMode, idleMarketId, totalVaultAssets]);

  // Auto-select catcher: largest target allocation
  const effectiveCatcher = catcherMarketId ?? (allocationEditsWithIdle.length > 0
    ? allocationEditsWithIdle.reduce((max, e) => e.targetAssets > max.targetAssets ? e : max, allocationEditsWithIdle[0]!).marketId
    : null);

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

  const handleExecute = () => {
    if (!isBalanced || !hasChanges || !markets) return;

    const allocations: MarketAllocationArg[] = allocationEditsWithIdle
      .filter((e) => e.targetAssets !== e.currentAssets)
      .map((e) => {
        const market = markets.find((m) => m.id === e.marketId);
        if (!market) throw new Error(`Market not found: ${e.marketId}`);
        return {
          marketParams: market.params,
          assets: e.targetAssets,
        };
      });

    const catcherIdx = allocations.findIndex((a) => {
      const matchEdit = allocationEditsWithIdle.find(
        (e) => e.marketId === effectiveCatcher,
      );
      if (!matchEdit) return false;
      const market = markets.find((m) => m.id === matchEdit.marketId);
      return market && a.marketParams.loanToken === market.params.loanToken
        && a.marketParams.collateralToken === market.params.collateralToken
        && a.marketParams.oracle === market.params.oracle;
    });

    const currentAssetsMap = new Map<string, bigint>();
    for (const e of allocationEditsWithIdle) {
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
  const canExecute = isBalanced && hasChanges && capViolations.length === 0 && !isMismatch;

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
                            className="accent-accent-primary"
                            title="Use as max-catcher (absorbs rounding dust)"
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

function formatApy(apy: number): string {
  return `${(apy * 100).toFixed(2)}%`;
}

function formatWadPercent(wad: bigint): string {
  return `${(Number(wad) / 1e18 * 100).toFixed(1)}%`;
}
