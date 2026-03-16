import { useState, useMemo } from 'react';
import type { Address } from 'viem';
import { encodeFunctionData } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { formatTokenAmount, parseTokenAmount, formatWadPercent } from '../../../lib/utils/format';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

interface UpdateCapsDrawerProps {
  open: boolean;
  onClose: () => void;
  adapter: V2AdapterFull | null;
  vaultAddress: Address;
  timelockSeconds: bigint;
  decimals: number;
  assetSymbol: string;
}

export function UpdateCapsDrawer({
  open,
  onClose,
  adapter,
  vaultAddress,
  timelockSeconds,
  decimals,
  assetSymbol,
}: UpdateCapsDrawerProps) {
  const [newAbsCap, setNewAbsCap] = useState('');
  const [newRelCap, setNewRelCap] = useState('');
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const parsedAbsCap = useMemo(() => parseTokenAmount(newAbsCap, decimals), [newAbsCap, decimals]);

  if (!adapter) return null;

  const isAbsIncrease = parsedAbsCap > adapter.absoluteCap;
  const timelockDays = Number(timelockSeconds) / 86400;

  const handleUpdateAbsCap = () => {
    if (parsedAbsCap <= 0n) return;

    if (isAbsIncrease) {
      // Increase = timelocked → submit()
      const innerData = encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'increaseAbsoluteCap',
        args: [adapter.adapterId, parsedAbsCap],
      });
      writeContract({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: 'submit',
        args: [innerData],
      });
    } else {
      // Decrease = immediate
      writeContract({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: 'decreaseAbsoluteCap',
        args: [adapter.adapterId, parsedAbsCap],
      });
    }
  };

  const handleUpdateRelCap = () => {
    const pct = parseFloat(newRelCap);
    if (isNaN(pct) || pct < 0 || pct > 100) return;
    // Convert percentage to WAD (1e18 = 100%)
    const wadValue = BigInt(Math.floor(pct * 1e16));

    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'increaseRelativeCap',
      args: [adapter.adapterId, wadValue],
    });
  };

  const handleClose = () => {
    setNewAbsCap('');
    setNewRelCap('');
    onClose();
  };

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={`Update Caps: ${adapter.name ?? 'Adapter'}`}
    >
      {isSuccess ? (
        <div className="text-center py-8">
          <Badge variant="success" className="mb-2">Submitted</Badge>
          <p className="text-sm text-text-primary">Cap update submitted.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Absolute Cap */}
          <div className="space-y-2">
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
            <Button
              size="sm"
              onClick={handleUpdateAbsCap}
              disabled={parsedAbsCap <= 0n || isPending || isConfirming}
              loading={isPending || isConfirming}
            >
              Update Abs. Cap
            </Button>
          </div>

          <div className="border-t border-border-subtle" />

          {/* Relative Cap */}
          <div className="space-y-2">
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
            <Button
              size="sm"
              onClick={handleUpdateRelCap}
              disabled={!newRelCap || isPending || isConfirming}
              loading={isPending || isConfirming}
            >
              Update Rel. Cap
            </Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}
