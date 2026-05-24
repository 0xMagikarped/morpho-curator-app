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
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { formatTokenAmount, parseTokenAmount, formatWadPercent } from '../../../lib/utils/format';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import { adapterIdData } from '../../../lib/v2/adapterCapUtils';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

interface UpdateCapsDrawerProps {
  open: boolean;
  onClose: () => void;
  adapter: V2AdapterFull | null;
  vaultAddress: Address;
  chainId: number;
  timelockSeconds: bigint;
  decimals: number;
  assetSymbol: string;
}

/**
 * Update absolute + relative caps on a single V2 adapter.
 *
 * PR 12 — both caps batch into one tx (each direction):
 *
 *   submit ALL increases   → `vault.multicall([submit(absCd), submit(relCd)])`
 *   execute ALL increases  → `vault.multicall([increaseAbsoluteCap, increaseRelativeCap])`
 *   apply ALL decreases    → `vault.multicall([decreaseAbsoluteCap, decreaseRelativeCap])`
 *
 * Single-action cases (only abs or only rel changed) collapse to a direct
 * call — no multicall wrapping when there's nothing to batch.
 *
 * Each increase keeps its own per-calldata `executableAt` slot (V2 keys the
 * timelock on the exact submitted bytes). `combineTimelockSteps` derives the
 * unified Submit/Wait/Execute state across the batch.
 *
 * If the user changes a cap value after submitting, the new calldata has a
 * fresh `executableAt = 0` — the UI correctly falls back to "Submit" because
 * the previously-submitted slot is for the *old* value. The old slot stays
 * queued on-chain harmlessly; only the slot matching the current input is
 * what the Execute multicall would call.
 */
export function UpdateCapsDrawer({
  open,
  onClose,
  adapter,
  vaultAddress,
  chainId,
  timelockSeconds,
  decimals,
  assetSymbol,
}: UpdateCapsDrawerProps) {
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

  const isAbsIncrease = !!adapter && parsedAbsCap > 0n && parsedAbsCap > adapter.absoluteCap;
  const isRelIncrease = !!adapter && parsedRelWad > 0n && parsedRelWad > adapter.relativeCap;
  const isAbsDecrease = !!adapter && parsedAbsCap > 0n && parsedAbsCap < adapter.absoluteCap;
  const isRelDecrease = !!adapter && parsedRelWad > 0n && parsedRelWad < adapter.relativeCap;

  // PR 14 — adapter-level idData is `abi.encode("this", adapter.address)`,
  // NOT the keccak256 hash `adapter.adapterId`. The V2 cap functions decode
  // `idData` as `(string tag, address addr)` internally and revert when fed
  // a 32-byte hash. PR 10 / PR 12 inherited the wrong shape; multicall
  // execute reverted on every real call because of this single misuse.
  const adapterCapIdData = useMemo(
    () => (adapter ? adapterIdData(adapter.address) : undefined),
    [adapter],
  );

  // ------- timelocked-call calldata (target functions) ---------------------
  const absIncreaseCalldata = useMemo(
    () =>
      adapter && isAbsIncrease && adapterCapIdData
        ? encodeFunctionData({
            abi: metaMorphoV2Abi,
            functionName: 'increaseAbsoluteCap',
            args: [adapterCapIdData, parsedAbsCap],
          })
        : undefined,
    [adapter, isAbsIncrease, parsedAbsCap, adapterCapIdData],
  );
  const relIncreaseCalldata = useMemo(
    () =>
      adapter && isRelIncrease && adapterCapIdData
        ? encodeFunctionData({
            abi: metaMorphoV2Abi,
            functionName: 'increaseRelativeCap',
            args: [adapterCapIdData, parsedRelWad],
          })
        : undefined,
    [adapter, isRelIncrease, parsedRelWad, adapterCapIdData],
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

  // Combine the two per-calldata timelock states into one batch state
  // (PR 12). The reducer only includes the active ones — abs-only batches
  // see only abs, mixed batches see both, etc.
  const combinedIncrease = useMemo(() => {
    const active: TimelockOpState[] = [];
    if (isAbsIncrease) active.push(absTimelock);
    if (isRelIncrease) active.push(relTimelock);
    return combineTimelockSteps(active);
  }, [isAbsIncrease, isRelIncrease, absTimelock, relTimelock]);

  if (!adapter) return null;

  const timelockDays = Number(timelockSeconds) / 86400;
  const busy = isPending || isConfirming;

  // ------- batched submit (increases) -------------------------------------
  const submitAllIncreases = () => {
    if (!absIncreaseCalldata && !relIncreaseCalldata) return;

    const submits: `0x${string}`[] = [];
    if (absIncreaseCalldata) {
      submits.push(
        encodeFunctionData({
          abi: metaMorphoV2Abi,
          functionName: 'submit',
          args: [absIncreaseCalldata],
        }),
      );
    }
    if (relIncreaseCalldata) {
      submits.push(
        encodeFunctionData({
          abi: metaMorphoV2Abi,
          functionName: 'submit',
          args: [relIncreaseCalldata],
        }),
      );
    }

    if (submits.length === 1) {
      // Skip the multicall wrap when there's only one — cleaner gas + clearer
      // simulation. The first non-undefined calldata is what we submit.
      const single = absIncreaseCalldata ?? relIncreaseCalldata!;
      writeContract({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: 'submit',
        args: [single],
        chainId,
      });
      return;
    }
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'multicall',
      args: [submits],
      chainId,
    });
  };

  // ------- batched execute (increases) ------------------------------------
  const executeAllIncreases = () => {
    if (!absIncreaseCalldata && !relIncreaseCalldata) return;

    const calls: `0x${string}`[] = [];
    if (absIncreaseCalldata) calls.push(absIncreaseCalldata);
    if (relIncreaseCalldata) calls.push(relIncreaseCalldata);

    if (calls.length === 1) {
      // Single direct call — V2 self-checks executableAt on the target fn.
      if (absIncreaseCalldata) {
        writeContract({
          address: vaultAddress,
          abi: metaMorphoV2Abi,
          functionName: 'increaseAbsoluteCap',
          args: [adapterCapIdData!, parsedAbsCap],
          chainId,
        });
      } else {
        writeContract({
          address: vaultAddress,
          abi: metaMorphoV2Abi,
          functionName: 'increaseRelativeCap',
          args: [adapterCapIdData!, parsedRelWad],
          chainId,
        });
      }
      return;
    }
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'multicall',
      args: [calls],
      chainId,
    });
  };

  // ------- batched immediate decreases ------------------------------------
  const applyAllDecreases = () => {
    const calls: `0x${string}`[] = [];
    if (isAbsDecrease) {
      calls.push(
        encodeFunctionData({
          abi: metaMorphoV2Abi,
          functionName: 'decreaseAbsoluteCap',
          args: [adapterCapIdData!, parsedAbsCap],
        }),
      );
    }
    if (isRelDecrease) {
      calls.push(
        encodeFunctionData({
          abi: metaMorphoV2Abi,
          functionName: 'decreaseRelativeCap',
          args: [adapterCapIdData!, parsedRelWad],
        }),
      );
    }
    if (calls.length === 0) return;

    if (calls.length === 1) {
      if (isAbsDecrease) {
        writeContract({
          address: vaultAddress,
          abi: metaMorphoV2Abi,
          functionName: 'decreaseAbsoluteCap',
          args: [adapterCapIdData!, parsedAbsCap],
          chainId,
        });
      } else {
        writeContract({
          address: vaultAddress,
          abi: metaMorphoV2Abi,
          functionName: 'decreaseRelativeCap',
          args: [adapterCapIdData!, parsedRelWad],
          chainId,
        });
      }
      return;
    }
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'multicall',
      args: [calls],
      chainId,
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
    <Drawer open={open} onClose={handleClose} title={`Update Caps: ${adapter.name ?? 'Adapter'}`}>
      <div className="space-y-6">
        {/* Decoded write / preflight error (PR 6/8 pattern) */}
        {(simulateError || error) && (
          <div role="alert" className="bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
            {simulateError?.message ?? (error instanceof Error ? error.message : 'Transaction failed.')}
          </div>
        )}

        {/* Absolute Cap input */}
        <section className="space-y-2">
          <h4 className="text-xs font-medium text-text-primary">Absolute Cap</h4>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-text-tertiary">Current</span>
              <p className="font-mono text-text-primary mt-0.5">
                {adapter.absoluteCap > 0n
                  ? `${formatTokenAmount(adapter.absoluteCap, decimals)} ${assetSymbol}`
                  : 'Not set'}
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
                ? `Increase = timelocked (${timelockDays.toFixed(1)}d)`
                : 'Decrease = immediate'}
            </p>
          )}
        </section>

        <div className="border-t border-border-subtle" />

        {/* Relative Cap input */}
        <section className="space-y-2">
          <h4 className="text-xs font-medium text-text-primary">Relative Cap</h4>
          <div className="text-xs">
            <span className="text-text-tertiary">Current: </span>
            <span className="font-mono text-text-primary">
              {adapter.relativeCap > 0n ? formatWadPercent(adapter.relativeCap) : 'Not set'}
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
                ? `Increase = timelocked (${timelockDays.toFixed(1)}d)`
                : 'Decrease = immediate'}
            </p>
          )}
        </section>

        <div className="border-t border-border-subtle" />

        {/* Combined timelock banner (PR 12) */}
        {hasAnyIncrease && combinedIncrease.step === 'pending' && (
          <div className="bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-text-primary">
            <strong>Submitted to timelock.</strong>{' '}
            {batchSize > 1 ? `Both cap changes` : `Cap change`} executable at{' '}
            <span className="font-mono">
              {new Date(Number(combinedIncrease.executableAt) * 1000).toUTCString()}
            </span>
            .
          </div>
        )}
        {hasAnyIncrease && combinedIncrease.step === 'executable' && (
          <div className="bg-success/10 border border-success/20 px-3 py-2 text-xs text-text-primary">
            <strong>Ready to execute.</strong>{' '}
            {batchSize > 1 ? 'Both timelocks have' : 'The timelock has'} elapsed — click{' '}
            <span className="font-mono">Execute</span>.
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-2">
          {/* Decreases — immediate. One button covers abs+rel via multicall. */}
          {hasAnyDecrease && (
            <Button
              size="sm"
              onClick={applyAllDecreases}
              disabled={busy}
              loading={busy}
              className="w-full"
            >
              {decreaseBatchSize > 1
                ? 'Apply Both Decreases (immediate)'
                : 'Apply Decrease (immediate)'}
            </Button>
          )}

          {/* Increases — submit→wait→execute. One button reflects combined state. */}
          {hasAnyIncrease && (
            <IncreaseButton
              combined={combinedIncrease}
              batchSize={batchSize}
              busy={busy}
              onSubmit={submitAllIncreases}
              onExecute={executeAllIncreases}
            />
          )}

          {/* Nothing entered yet */}
          {!hasAnyIncrease && !hasAnyDecrease && (
            <Button size="sm" disabled className="w-full">
              Enter a cap to update
            </Button>
          )}
        </div>

        <div className="bg-bg-hover px-3 py-2 text-xs text-text-secondary">
          Increases are timelocked ({timelockDays.toFixed(1)}d). Decreases apply immediately.
          {batchSize > 1 ? ' Submit and execute are batched into one tx each via vault.multicall.' : ''}
        </div>
      </div>
    </Drawer>
  );
}

/**
 * Single button that swaps label + handler based on the combined timelock
 * state of the increase batch.
 */
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
  // not_submitted (or none, but `hasAnyIncrease` gate prevents none here)
  return (
    <Button size="sm" onClick={onSubmit} disabled={busy} loading={busy} className="w-full">
      {plural ? 'Submit — Both Increases' : 'Submit — Increase'}
    </Button>
  );
}
