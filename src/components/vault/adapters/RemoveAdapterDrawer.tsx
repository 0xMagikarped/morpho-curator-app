import type { Address } from 'viem';
import { encodeFunctionData } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { formatTokenAmount } from '../../../lib/utils/format';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

interface RemoveAdapterDrawerProps {
  open: boolean;
  onClose: () => void;
  adapter: V2AdapterFull | null;
  vaultAddress: Address;
  timelockSeconds: bigint;
  decimals: number;
  assetSymbol: string;
}

export function RemoveAdapterDrawer({
  open,
  onClose,
  adapter,
  vaultAddress,
  timelockSeconds,
  decimals,
  assetSymbol,
}: RemoveAdapterDrawerProps) {
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  if (!adapter) return null;

  const hasAllocation = adapter.realAssets > 0n;
  const timelockDays = Number(timelockSeconds) / 86400;

  const handleSubmitRemove = () => {
    const innerData = encodeFunctionData({
      abi: metaMorphoV2Abi,
      functionName: 'removeAdapter',
      args: [adapter.address],
    });
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'submit',
      args: [innerData],
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Remove: ${adapter.name ?? 'Adapter'}`}
      footer={
        !isSuccess ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleSubmitRemove}
              disabled={hasAllocation || isPending || isConfirming}
              loading={isPending || isConfirming}
              className="flex-1"
            >
              Submit — Remove Adapter
            </Button>
          </div>
        ) : undefined
      }
    >
      {isSuccess ? (
        <div className="text-center py-8">
          <Badge variant="success" className="mb-2">Submitted</Badge>
          <p className="text-sm text-text-primary">Adapter removal submitted to timelock.</p>
          <p className="text-xs text-text-tertiary mt-1">
            Executable in {timelockDays.toFixed(1)} days.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <h4 className="text-xs font-medium text-text-primary">Prerequisites</h4>

          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs">
              <span className={hasAllocation ? 'text-danger' : 'text-success'}>
                {hasAllocation ? '\u2717' : '\u2713'}
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
        </div>
      )}
    </Drawer>
  );
}
