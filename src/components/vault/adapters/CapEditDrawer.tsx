/**
 * PR 22 — generalized V2 cap edit drawer.
 *
 * Edits absolute + relative caps for ANY cap-map entry, parameterized by
 * the raw `idData` payload (the `bytes` argument that `increase*Cap` /
 * `decrease*Cap` take). The three V2 cap levels each have their own
 * `idData` shape:
 *
 *   - adapter-level    : `abi.encode("this", adapter)`        — adapterIdData
 *   - collateral-level : `abi.encode("collateralToken", token)` — collateralIdData
 *   - market-level     : `abi.encode("this/marketParams", adapter, marketParams)`
 *                                                              — marketIdData
 *
 * The on-chain semantics are identical for all three levels — the V2 vault
 * routes them through the same `increaseAbsoluteCap` / `decreaseAbsoluteCap`
 * / `increaseRelativeCap` / `decreaseRelativeCap` mutators (PR 14 / PR 15).
 * Only the storage key changes. This drawer keeps the entire
 * Submit→Wait→Execute batching (PR 12 / PR 20), simulation guard (PR 8),
 * and error surfacing (PR 6) intact; only the source of `idData` and the
 * current cap values is now plumbed via props.
 *
 * `UpdateCapsDrawer` (PR 10 / PR 12 / PR 14) is now a thin shim around this
 * drawer for the adapter-level case, preserving its existing call sites.
 */
import { useState, useMemo } from 'react';
import type { Address } from 'viem';
import { encodeFunctionData } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useGuardedWriteContract } from '../../../hooks/useGuardedWriteContract';
import {
  useV2TimelockedOp,
  combineTimelockSteps,
  type TimelockOpState,
} from '../../../lib/hooks/useV2TimelockedOp';
import { useV2SelectorTimelocks } from '../../../lib/hooks/useV2SelectorTimelock';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { TimelockCountdown } from '../TimelockCountdown';
import { parseTokenAmount, formatWadPercent, formatCapDisplay } from '../../../lib/utils/format';
import { formatDurationSeconds } from '../../../lib/utils/duration';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';

const ABS_SIG = 'increaseAbsoluteCap(bytes,uint256)';
const REL_SIG = 'increaseRelativeCap(bytes,uint256)';
const CAP_SIGS = [ABS_SIG, REL_SIG] as const;

/** "2d" / "unknown" — never the bogus "0.0d" the vault-level field produced. */
function describeTimelock(secs: bigint | undefined): string {
  if (secs === undefined) return 'loading…';
  if (secs === 0n) return 'no delay';
  return formatDurationSeconds(secs);
}

export interface CapEditDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Visible title; e.g. "Adapter caps", "Collateral caps: WXDC", "Market caps: WXDC/USDC 62.5%". */
  label: string;
  /** Pre-built cap-map idData payload for the entry being edited. */
  idData: `0x${string}` | undefined;
  /** Current on-chain absolute cap (raw token units). */
  currentAbs: bigint;
  /** Current on-chain relative cap (WAD; 1e18 = 100%). */
  currentRel: bigint;
  vaultAddress: Address;
  chainId: number;
  /**
   * @deprecated Ignored on V2. Vault V2 has no single timelock — the real
   * per-selector durations are read on-chain inside this drawer. The prop is
   * kept so the existing call sites still typecheck.
   */
  timelockSeconds?: bigint;
  decimals: number;
  assetSymbol: string;
}

export function CapEditDrawer({
  open,
  onClose,
  label,
  idData,
  currentAbs,
  currentRel,
  vaultAddress,
  chainId,
  decimals,
  assetSymbol,
}: CapEditDrawerProps) {
  const [newAbsCap, setNewAbsCap] = useState('');
  const [newRelCap, setNewRelCap] = useState('');
  const { writeContract, data: txHash, isPending, error, simulateError } = useGuardedWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const parsedAbsCap = useMemo(() => parseTokenAmount(newAbsCap, decimals), [newAbsCap, decimals]);
  const parsedRelWad = useMemo(() => {
    const pct = parseFloat(newRelCap);
    if (isNaN(pct) || pct < 0 || pct > 100) return 0n;
    return BigInt(Math.floor(pct * 1e16)); // 1e18 WAD = 100%
  }, [newRelCap]);

  const isAbsIncrease = !!idData && parsedAbsCap > 0n && parsedAbsCap > currentAbs;
  const isRelIncrease = !!idData && parsedRelWad > 0n && parsedRelWad > currentRel;
  const isAbsDecrease = !!idData && parsedAbsCap > 0n && parsedAbsCap < currentAbs;
  const isRelDecrease = !!idData && parsedRelWad > 0n && parsedRelWad < currentRel;

  // ------- timelocked-call calldata (target functions) ---------------------
  const absIncreaseCalldata = useMemo(
    () =>
      idData && isAbsIncrease
        ? encodeFunctionData({
            abi: metaMorphoV2Abi,
            functionName: 'increaseAbsoluteCap',
            args: [idData, parsedAbsCap],
          })
        : undefined,
    [idData, isAbsIncrease, parsedAbsCap],
  );
  const relIncreaseCalldata = useMemo(
    () =>
      idData && isRelIncrease
        ? encodeFunctionData({
            abi: metaMorphoV2Abi,
            functionName: 'increaseRelativeCap',
            args: [idData, parsedRelWad],
          })
        : undefined,
    [idData, isRelIncrease, parsedRelWad],
  );

  const absTimelock = useV2TimelockedOp({
    vaultAddress,
    chainId,
    calldata: absIncreaseCalldata,
    enabled: open && isAbsIncrease,
  });
  const relTimelock = useV2TimelockedOp({
    vaultAddress,
    chainId,
    calldata: relIncreaseCalldata,
    enabled: open && isRelIncrease,
  });

  const combinedIncrease = useMemo(() => {
    const active: TimelockOpState[] = [];
    if (isAbsIncrease) active.push(absTimelock);
    if (isRelIncrease) active.push(relTimelock);
    return combineTimelockSteps(active);
  }, [isAbsIncrease, isRelIncrease, absTimelock, relTimelock]);

  // Real per-selector durations. The vault-level `timelockSeconds` prop is
  // always 0n on V2 (fetchV2VaultInfo has no single value to report), which
  // is why every increase used to advertise "timelocked (0.0d)".
  const { bySignature: capTimelocks } = useV2SelectorTimelocks(chainId, vaultAddress, CAP_SIGS);
  const absTimelockSecs = capTimelocks[ABS_SIG];
  const relTimelockSecs = capTimelocks[REL_SIG];

  if (!idData) return null;

  const busy = isPending || isConfirming;

  // ------- batched submit (increases) -------------------------------------
  const submitAllIncreases = () => {
    if (!absIncreaseCalldata && !relIncreaseCalldata) return;

    const submits: `0x${string}`[] = [];
    if (absIncreaseCalldata) {
      submits.push(
        encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'submit', args: [absIncreaseCalldata] }),
      );
    }
    if (relIncreaseCalldata) {
      submits.push(
        encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'submit', args: [relIncreaseCalldata] }),
      );
    }

    if (submits.length === 1) {
      const single = absIncreaseCalldata ?? relIncreaseCalldata!;
      writeContract({
        address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'submit', args: [single], chainId,
      });
      return;
    }
    writeContract({
      address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'multicall', args: [submits], chainId,
    });
  };

  // ------- batched execute (increases) ------------------------------------
  const executeAllIncreases = () => {
    if (!absIncreaseCalldata && !relIncreaseCalldata) return;

    const calls: `0x${string}`[] = [];
    if (absIncreaseCalldata) calls.push(absIncreaseCalldata);
    if (relIncreaseCalldata) calls.push(relIncreaseCalldata);

    if (calls.length === 1) {
      if (absIncreaseCalldata) {
        writeContract({
          address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'increaseAbsoluteCap',
          args: [idData, parsedAbsCap], chainId,
        });
      } else {
        writeContract({
          address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'increaseRelativeCap',
          args: [idData, parsedRelWad], chainId,
        });
      }
      return;
    }
    writeContract({
      address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'multicall', args: [calls], chainId,
    });
  };

  // ------- batched immediate decreases ------------------------------------
  const applyAllDecreases = () => {
    const calls: `0x${string}`[] = [];
    if (isAbsDecrease) {
      calls.push(
        encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'decreaseAbsoluteCap', args: [idData, parsedAbsCap] }),
      );
    }
    if (isRelDecrease) {
      calls.push(
        encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'decreaseRelativeCap', args: [idData, parsedRelWad] }),
      );
    }
    if (calls.length === 0) return;

    if (calls.length === 1) {
      if (isAbsDecrease) {
        writeContract({
          address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'decreaseAbsoluteCap',
          args: [idData, parsedAbsCap], chainId,
        });
      } else {
        writeContract({
          address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'decreaseRelativeCap',
          args: [idData, parsedRelWad], chainId,
        });
      }
      return;
    }
    writeContract({
      address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'multicall', args: [calls], chainId,
    });
  };

  const handleClose = () => {
    setNewAbsCap('');
    setNewRelCap('');
    onClose();
  };

  const hasAnyIncrease = isAbsIncrease || isRelIncrease;
  const hasAnyDecrease = isAbsDecrease || isRelDecrease;
  const batchSize = (isAbsIncrease ? 1 : 0) + (isRelIncrease ? 1 : 0);
  const decreaseBatchSize = (isAbsDecrease ? 1 : 0) + (isRelDecrease ? 1 : 0);

  return (
    <Drawer open={open} onClose={handleClose} title={label}>
      <div className="space-y-6">
        {(simulateError || error) && (
          <div role="alert" className="bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
            {simulateError?.message ?? (error instanceof Error ? error.message : 'Transaction failed.')}
          </div>
        )}

        <section className="space-y-2">
          <h4 className="text-xs font-medium text-text-primary">Absolute Cap</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-text-tertiary">Current</span>
              <p className="font-mono text-text-primary mt-0.5">
                {currentAbs > 0n ? formatCapDisplay(currentAbs, decimals, assetSymbol) : 'Not set'}
              </p>
            </div>
          </div>
          <div>
            <label className="text-xs text-text-tertiary block mb-1">New ({assetSymbol})</label>
            <input
              type="number"
              placeholder="0.00"
              value={newAbsCap}
              onChange={(e) => setNewAbsCap(e.target.value)}
              className="w-full bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
            />
          </div>
          {parsedAbsCap > 0n && (
            <p className="text-[10px] text-text-tertiary">
              {isAbsIncrease
                ? `Increase = timelocked (${describeTimelock(absTimelockSecs)})`
                : 'Decrease = immediate'}
            </p>
          )}
        </section>

        <div className="border-t border-border-subtle" />

        <section className="space-y-2">
          <h4 className="text-xs font-medium text-text-primary">Relative Cap</h4>
          <div className="text-xs">
            <span className="text-text-tertiary">Current: </span>
            <span className="font-mono text-text-primary">
              {currentRel > 0n ? formatWadPercent(currentRel) : 'Not set'}
            </span>
          </div>
          <div>
            <label className="text-xs text-text-tertiary block mb-1">New (%)</label>
            <input
              type="number"
              placeholder="0"
              min="0"
              max="100"
              value={newRelCap}
              onChange={(e) => setNewRelCap(e.target.value)}
              className="w-full bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
            />
          </div>
          {parsedRelWad > 0n && (
            <p className="text-[10px] text-text-tertiary">
              {isRelIncrease
                ? `Increase = timelocked (${describeTimelock(relTimelockSecs)})`
                : 'Decrease = immediate'}
            </p>
          )}
        </section>

        <div className="border-t border-border-subtle" />

        {hasAnyIncrease && combinedIncrease.step === 'pending' && (
          <div className="bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-text-primary">
            <strong>Timelock running.</strong>{' '}
            {batchSize > 1 ? 'Both cap changes' : 'Cap change'} submitted —{' '}
            <TimelockCountdown executableAt={combinedIncrease.executableAt} />
          </div>
        )}
        {hasAnyIncrease && combinedIncrease.step === 'executable' && (
          <div className="bg-success/10 border border-success/20 px-3 py-2 text-xs text-text-primary">
            <strong>Ready to execute.</strong>{' '}
            {batchSize > 1 ? 'Both timelocks have' : 'The timelock has'} elapsed — click{' '}
            <span className="font-mono">Execute</span>.
          </div>
        )}

        <div className="space-y-2">
          {hasAnyDecrease && (
            <Button size="sm" onClick={applyAllDecreases} disabled={busy} loading={busy} className="w-full">
              {decreaseBatchSize > 1 ? 'Apply Both Decreases (immediate)' : 'Apply Decrease (immediate)'}
            </Button>
          )}

          {hasAnyIncrease && (
            <IncreaseButton
              combined={combinedIncrease}
              batchSize={batchSize}
              busy={busy}
              onSubmit={submitAllIncreases}
              onExecute={executeAllIncreases}
            />
          )}

          {!hasAnyIncrease && !hasAnyDecrease && (
            <Button size="sm" disabled className="w-full">
              Enter a cap to update
            </Button>
          )}
        </div>

        <div className="bg-bg-hover px-3 py-2 text-xs text-text-secondary">
          Increases are timelocked — absolute {describeTimelock(absTimelockSecs)}, relative{' '}
          {describeTimelock(relTimelockSecs)}. Decreases apply immediately.
          {batchSize > 1 ? ' Submit and execute are batched into one tx each via vault.multicall.' : ''}
        </div>
      </div>
    </Drawer>
  );
}

function IncreaseButton({
  combined,
  batchSize,
  busy,
  onSubmit,
  onExecute,
}: {
  combined: ReturnType<typeof combineTimelockSteps>;
  batchSize: number;
  busy: boolean;
  onSubmit: () => void;
  onExecute: () => void;
}) {
  const plural = batchSize > 1;
  if (combined.step === 'loading') {
    return (
      <Button size="sm" disabled className="w-full">
        Checking timelock…
      </Button>
    );
  }
  if (combined.step === 'pending') {
    return (
      <Button size="sm" disabled className="w-full">
        Waiting for timelock…
      </Button>
    );
  }
  if (combined.step === 'executable') {
    return (
      <Button size="sm" onClick={onExecute} disabled={busy} loading={busy} className="w-full">
        {plural ? 'Execute — Both Increases' : 'Execute — Increase'}
      </Button>
    );
  }
  return (
    <Button size="sm" onClick={onSubmit} disabled={busy} loading={busy} className="w-full">
      {plural ? 'Submit — Both Increases' : 'Submit — Increase'}
    </Button>
  );
}
