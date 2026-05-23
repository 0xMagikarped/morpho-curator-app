import { useState, useMemo } from 'react';
import type { Address } from 'viem';
import { encodeFunctionData } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useGuardedWriteContract } from '../../../hooks/useGuardedWriteContract';
import { useV2TimelockedOp, type TimelockStep } from '../../../lib/hooks/useV2TimelockedOp';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { formatTokenAmount, parseTokenAmount, formatWadPercent } from '../../../lib/utils/format';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
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

  // PR 10: each increase is a V2-timelocked op (submit → wait → execute).
  // Each has its own `executableAt` keyed by its exact calldata.
  const absIncreaseCalldata = useMemo(
    () =>
      adapter && isAbsIncrease
        ? encodeFunctionData({
            abi: metaMorphoV2Abi,
            functionName: 'increaseAbsoluteCap',
            args: [adapter.adapterId, parsedAbsCap],
          })
        : undefined,
    [adapter, isAbsIncrease, parsedAbsCap],
  );
  const relIncreaseCalldata = useMemo(
    () =>
      adapter && isRelIncrease
        ? encodeFunctionData({
            abi: metaMorphoV2Abi,
            functionName: 'increaseRelativeCap',
            args: [adapter.adapterId, parsedRelWad],
          })
        : undefined,
    [adapter, isRelIncrease, parsedRelWad],
  );

  const absTimelock = useV2TimelockedOp({
    vaultAddress, chainId, calldata: absIncreaseCalldata, enabled: open && isAbsIncrease,
  });
  const relTimelock = useV2TimelockedOp({
    vaultAddress, chainId, calldata: relIncreaseCalldata, enabled: open && isRelIncrease,
  });

  if (!adapter) return null;

  const timelockDays = Number(timelockSeconds) / 86400;
  const busy = isPending || isConfirming;

  // ------- absolute cap handlers ----------------------------------------
  const submitAbsIncrease = () => {
    if (!absIncreaseCalldata) return;
    writeContract({
      address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'submit',
      args: [absIncreaseCalldata], chainId,
    });
  };
  const executeAbsIncrease = () => {
    writeContract({
      address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'increaseAbsoluteCap',
      args: [adapter.adapterId, parsedAbsCap], chainId,
    });
  };
  const decreaseAbsImmediate = () => {
    writeContract({
      address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'decreaseAbsoluteCap',
      args: [adapter.adapterId, parsedAbsCap], chainId,
    });
  };

  // ------- relative cap handlers ----------------------------------------
  const submitRelIncrease = () => {
    if (!relIncreaseCalldata) return;
    writeContract({
      address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'submit',
      args: [relIncreaseCalldata], chainId,
    });
  };
  const executeRelIncrease = () => {
    writeContract({
      address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'increaseRelativeCap',
      args: [adapter.adapterId, parsedRelWad], chainId,
    });
  };
  const decreaseRelImmediate = () => {
    writeContract({
      address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'decreaseRelativeCap',
      args: [adapter.adapterId, parsedRelWad], chainId,
    });
  };

  const handleClose = () => {
    setNewAbsCap('');
    setNewRelCap('');
    onClose();
  };

  return (
    <Drawer open={open} onClose={handleClose} title={`Update Caps: ${adapter.name ?? 'Adapter'}`}>
      <div className="space-y-6">
        {/* Decoded write / preflight error (PR 6/8 pattern) */}
        {(simulateError || error) && (
          <div role="alert" className="bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
            {simulateError?.message ?? (error instanceof Error ? error.message : 'Transaction failed.')}
          </div>
        )}

        {/* Absolute Cap */}
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
          <TimelockBanner step={absTimelock.step} executableAt={absTimelock.executableAt} />
          {isAbsIncrease ? (
            <ActionButton
              step={absTimelock.step}
              submitLabel="Submit — Increase Abs. Cap"
              executeLabel="Execute — Increase Abs. Cap"
              onSubmit={submitAbsIncrease}
              onExecute={executeAbsIncrease}
              busy={busy}
            />
          ) : isAbsDecrease ? (
            <Button size="sm" onClick={decreaseAbsImmediate} disabled={busy} loading={busy}>
              Decrease Abs. Cap (immediate)
            </Button>
          ) : (
            <Button size="sm" disabled>Update Abs. Cap</Button>
          )}
        </section>

        <div className="border-t border-border-subtle" />

        {/* Relative Cap */}
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
          <TimelockBanner step={relTimelock.step} executableAt={relTimelock.executableAt} />
          {isRelIncrease ? (
            <ActionButton
              step={relTimelock.step}
              submitLabel="Submit — Increase Rel. Cap"
              executeLabel="Execute — Increase Rel. Cap"
              onSubmit={submitRelIncrease}
              onExecute={executeRelIncrease}
              busy={busy}
            />
          ) : isRelDecrease ? (
            <Button size="sm" onClick={decreaseRelImmediate} disabled={busy} loading={busy}>
              Decrease Rel. Cap (immediate)
            </Button>
          ) : (
            <Button size="sm" disabled>Update Rel. Cap</Button>
          )}
        </section>
      </div>
    </Drawer>
  );
}

/** Shared Submit/Wait/Execute button. */
function ActionButton({
  step, submitLabel, executeLabel, onSubmit, onExecute, busy,
}: {
  step: TimelockStep;
  submitLabel: string;
  executeLabel: string;
  onSubmit: () => void;
  onExecute: () => void;
  busy: boolean;
}) {
  if (step === 'loading') return <Button size="sm" disabled>Checking timelock…</Button>;
  if (step === 'pending') return <Button size="sm" disabled>Waiting for timelock…</Button>;
  if (step === 'executable')
    return <Button size="sm" onClick={onExecute} disabled={busy} loading={busy}>{executeLabel}</Button>;
  return <Button size="sm" onClick={onSubmit} disabled={busy} loading={busy}>{submitLabel}</Button>;
}

function TimelockBanner({ step, executableAt }: { step: TimelockStep; executableAt: bigint }) {
  if (step === 'pending') {
    return (
      <div className="bg-warning/10 border border-warning/20 px-2 py-1.5 text-[10px] text-text-primary">
        Submitted. Executable at{' '}
        <span className="font-mono">{new Date(Number(executableAt) * 1000).toUTCString()}</span>.
      </div>
    );
  }
  if (step === 'executable') {
    return (
      <div className="bg-success/10 border border-success/20 px-2 py-1.5 text-[10px] text-text-primary">
        Ready to execute — click <span className="font-mono">Execute</span>.
      </div>
    );
  }
  return null;
}
