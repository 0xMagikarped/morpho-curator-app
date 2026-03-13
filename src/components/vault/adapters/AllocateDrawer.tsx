import { useState, useMemo } from 'react';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { formatTokenAmount, parseTokenAmount } from '../../../lib/utils/format';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

interface AllocateDrawerProps {
  open: boolean;
  onClose: () => void;
  adapter: V2AdapterFull | null;
  vaultAddress: Address;
  idle: bigint;
  decimals: number;
  assetSymbol: string;
  totalAssets: bigint;
}

export function AllocateDrawer({
  open,
  onClose,
  adapter,
  vaultAddress,
  idle,
  decimals,
  assetSymbol,
  totalAssets,
}: AllocateDrawerProps) {
  const [amount, setAmount] = useState('');
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const parsedAmount = useMemo(() => parseTokenAmount(amount, decimals), [amount, decimals]);

  if (!adapter) return null;

  // Max allocatable = min(idle, cap headroom)
  const capHeadroom = adapter.absoluteCap > 0n
    ? adapter.absoluteCap - adapter.realAssets
    : idle;
  const maxAllocatable = capHeadroom < idle ? capHeadroom : idle;

  const afterAllocation = adapter.realAssets + parsedAmount;
  const afterIdle = idle - parsedAmount;
  const afterCapPct = adapter.absoluteCap > 0n
    ? (Number(afterAllocation) / Number(adapter.absoluteCap)) * 100
    : 0;

  const handleAllocate = () => {
    if (parsedAmount <= 0n) return;
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'allocate',
      args: [adapter.address, parsedAmount, '0x' as `0x${string}`],
    });
  };

  const handleMax = () => {
    if (maxAllocatable > 0n) {
      const formatted = Number(maxAllocatable) / 10 ** decimals;
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
      title={`Allocate to ${adapter.name ?? 'Adapter'}`}
      footer={
        !isSuccess ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={handleAllocate}
              disabled={parsedAmount <= 0n || parsedAmount > idle || isPending || isConfirming}
              loading={isPending || isConfirming}
              className="flex-1"
            >
              Allocate
            </Button>
          </div>
        ) : undefined
      }
    >
      {isSuccess ? (
        <div className="text-center py-8">
          <Badge variant="success" className="mb-2">Allocated</Badge>
          <p className="text-sm text-text-primary">
            {formatTokenAmount(parsedAmount, decimals)} {assetSymbol} allocated.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Current state */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-text-tertiary">Available Idle</span>
              <p className="font-mono text-text-primary mt-0.5">
                {formatTokenAmount(idle, decimals)} {assetSymbol}
              </p>
            </div>
            <div>
              <span className="text-text-tertiary">Current Allocation</span>
              <p className="font-mono text-text-primary mt-0.5">
                {formatTokenAmount(adapter.realAssets, decimals)} {assetSymbol}
              </p>
            </div>
            {adapter.absoluteCap > 0n && (
              <div>
                <span className="text-text-tertiary">Absolute Cap</span>
                <p className="font-mono text-text-primary mt-0.5">
                  {formatTokenAmount(adapter.absoluteCap, decimals)} {assetSymbol}
                </p>
              </div>
            )}
            <div>
              <span className="text-text-tertiary">Max Allocatable</span>
              <p className="font-mono text-text-primary mt-0.5">
                {formatTokenAmount(maxAllocatable, decimals)} {assetSymbol}
              </p>
            </div>
          </div>

          {/* Input */}
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

          {/* After allocation preview */}
          {parsedAmount > 0n && (
            <div className="bg-bg-hover px-3 py-2 space-y-1 text-xs">
              <p className="text-text-tertiary uppercase text-[10px] tracking-wider mb-1">After Allocation</p>
              <div className="flex justify-between">
                <span className="text-text-secondary">Idle</span>
                <span className="font-mono text-text-primary">
                  {afterIdle >= 0n ? formatTokenAmount(afterIdle, decimals) : '(insufficient)'} {assetSymbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Adapter</span>
                <span className="font-mono text-text-primary">
                  {formatTokenAmount(afterAllocation, decimals)} {assetSymbol}
                </span>
              </div>
              {adapter.absoluteCap > 0n && (
                <div className="flex justify-between">
                  <span className="text-text-secondary">Cap usage</span>
                  <span className="font-mono text-text-primary">{afterCapPct.toFixed(1)}%</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
