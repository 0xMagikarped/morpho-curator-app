import { useMemo } from 'react';
import type { Address } from 'viem';
import { encodeFunctionData } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useGuardedWriteContract } from '../../../hooks/useGuardedWriteContract';
import { useV2TimelockedOp } from '../../../lib/hooks/useV2TimelockedOp';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { formatTokenAmount } from '../../../lib/utils/format';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

interface RemoveAdapterDrawerProps {
  open: boolean;
  onClose: () => void;
  adapter: V2AdapterFull | null;
  vaultAddress: Address;
  chainId: number;
  timelockSeconds: bigint;
  decimals: number;
  assetSymbol: string;
}

export function RemoveAdapterDrawer({
  open,
  onClose,
  adapter,
  vaultAddress,
  chainId,
  timelockSeconds,
  decimals,
  assetSymbol,
}: RemoveAdapterDrawerProps) {
  const { writeContract, data: txHash, isPending, error, simulateError } = useGuardedWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  // PR 10: state machine over `executableAt(removeAdapter calldata)`.
  const submitCalldata = useMemo(
    () =>
      adapter
        ? encodeFunctionData({ abi: metaMorphoV2Abi, functionName: 'removeAdapter', args: [adapter.address] })
        : undefined,
    [adapter],
  );
  const timelockState = useV2TimelockedOp({
    vaultAddress,
    chainId,
    calldata: submitCalldata,
    enabled: open,
  });

  if (!adapter) return null;

  const hasAllocation = adapter.realAssets > 0n;
  const timelockDays = Number(timelockSeconds) / 86400;
  const canAct = !hasAllocation;

  const handleSubmit = () => {
    if (!submitCalldata) return;
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'submit',
      args: [submitCalldata],
      chainId,
    });
  };

  const handleExecute = () => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'removeAdapter',
      args: [adapter.address],
      chainId,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Remove: ${adapter.name ?? 'Adapter'}`}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          {timelockState.step === 'loading' ? (
            <Button variant="danger" disabled className="flex-1">Checking timelock…</Button>
          ) : timelockState.step === 'pending' ? (
            <Button variant="danger" disabled className="flex-1">Waiting for timelock…</Button>
          ) : timelockState.step === 'executable' ? (
            <Button
              variant="danger"
              onClick={handleExecute}
              disabled={!canAct || isPending || isConfirming}
              loading={isPending || isConfirming}
              className="flex-1"
            >
              Execute — Remove Adapter
            </Button>
          ) : (
            <Button
              variant="danger"
              onClick={handleSubmit}
              disabled={!canAct || isPending || isConfirming}
              loading={isPending || isConfirming}
              className="flex-1"
            >
              Submit — Remove Adapter
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Timelock state banners (PR 10) */}
        {timelockState.step === 'pending' && (
          <div className="bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-text-primary">
            <strong>Submitted to timelock.</strong> Executable at{' '}
            <span className="font-mono">
              {new Date(Number(timelockState.executableAt) * 1000).toUTCString()}
            </span>.
          </div>
        )}
        {timelockState.step === 'executable' && (
          <div className="bg-success/10 border border-success/20 px-3 py-2 text-xs text-text-primary">
            <strong>Ready to execute.</strong> The timelock has elapsed — click{' '}
            <span className="font-mono">Execute</span> to finish removing this adapter.
          </div>
        )}

        <h4 className="text-xs font-medium text-text-primary">Prerequisites</h4>
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-xs">
            <span className={hasAllocation ? 'text-danger' : 'text-success'}>
              {hasAllocation ? '✗' : '✓'}
            </span>
            <div>
              <span className="text-text-primary">
                Allocation is {hasAllocation ? 'not ' : ''}0 {assetSymbol}
              </span>
              {hasAllocation ? (
                <p className="text-text-tertiary mt-0.5">
                  Current: {formatTokenAmount(adapter.realAssets, decimals)} {assetSymbol} — must deallocate first.
                </p>
              ) : (
                <p className="text-text-tertiary mt-0.5">Ready to remove.</p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-bg-hover px-3 py-2 text-xs text-text-secondary">
          This action requires a timelock of {timelockDays.toFixed(1)} days.
        </div>

        {/* Decoded write / preflight-revert error (PR 8 pattern) */}
        {(simulateError || error) && (
          <div role="alert" className="bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
            {simulateError?.message ?? (error instanceof Error ? error.message : 'Transaction failed.')}
          </div>
        )}
      </div>
    </Drawer>
  );
}
