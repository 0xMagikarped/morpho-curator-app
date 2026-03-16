import { useState, useMemo } from 'react';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { formatTokenAmount, parseTokenAmount } from '../../../lib/utils/format';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

interface DeallocateDrawerProps {
  open: boolean;
  onClose: () => void;
  adapter: V2AdapterFull | null;
  vaultAddress: Address;
  idle: bigint;
  decimals: number;
  assetSymbol: string;
}

export function DeallocateDrawer({
  open,
  onClose,
  adapter,
  vaultAddress,
  idle,
  decimals,
  assetSymbol,
}: DeallocateDrawerProps) {
  const [amount, setAmount] = useState('');
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const parsedAmount = useMemo(() => parseTokenAmount(amount, decimals), [amount, decimals]);

  if (!adapter) return null;

  const afterDeallocate = adapter.realAssets > parsedAmount ? adapter.realAssets - parsedAmount : 0n;
  const afterIdle = idle + parsedAmount;

  const handleDeallocate = () => {
    if (parsedAmount <= 0n) return;
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'deallocate',
      args: [adapter.address, '0x' as `0x${string}`, parsedAmount],
    });
  };

  const handleMax = () => {
    if (adapter.realAssets > 0n) {
      const formatted = Number(adapter.realAssets) / 10 ** decimals;
      setAmount(formatted.toString());
    }
  };

  const handleClose = () => {
    setAmount('');
    onClose();
  };

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={`Deallocate from ${adapter.name ?? 'Adapter'}`}
      footer={
        !isSuccess ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDeallocate}
              disabled={parsedAmount <= 0n || parsedAmount > adapter.realAssets || isPending || isConfirming}
              loading={isPending || isConfirming}
              className="flex-1"
            >
              Deallocate
            </Button>
          </div>
        ) : undefined
      }
    >
      {isSuccess ? (
        <div className="text-center py-8">
          <Badge variant="success" className="mb-2">Deallocated</Badge>
          <p className="text-sm text-text-primary">
            {formatTokenAmount(parsedAmount, decimals)} {assetSymbol} pulled back to idle.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-text-tertiary">Current Allocation</span>
              <p className="font-mono text-text-primary mt-0.5">
                {formatTokenAmount(adapter.realAssets, decimals)} {assetSymbol}
              </p>
            </div>
            <div>
              <span className="text-text-tertiary">Current Idle</span>
              <p className="font-mono text-text-primary mt-0.5">
                {formatTokenAmount(idle, decimals)} {assetSymbol}
              </p>
            </div>
          </div>

          <div>
            <label className="text-xs text-text-tertiary block mb-1">Amount ({assetSymbol})</label>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="flex-1 bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
              />
              <Button size="sm" variant="ghost" onClick={handleMax}>
                MAX
              </Button>
            </div>
          </div>

          {parsedAmount > 0n && (
            <div className="bg-bg-hover px-3 py-2 space-y-1 text-xs">
              <p className="text-text-tertiary uppercase text-[10px] tracking-wider mb-1">After Deallocate</p>
              <div className="flex justify-between">
                <span className="text-text-secondary">Adapter</span>
                <span className="font-mono text-text-primary">
                  {formatTokenAmount(afterDeallocate, decimals)} {assetSymbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Idle</span>
                <span className="font-mono text-text-primary">
                  {formatTokenAmount(afterIdle, decimals)} {assetSymbol}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
