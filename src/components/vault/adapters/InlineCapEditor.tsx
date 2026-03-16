/**
 * Inline editor for a single cap value (absolute or relative).
 * Automatically routes to increase/decrease based on direction of change.
 */
import { useState } from 'react';
import type { Address } from 'viem';
import { Loader2, Check } from 'lucide-react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Button } from '../../ui/Button';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import { isUnlimitedCap, MAX_UINT128, formatWadPercent } from '../../../lib/v2/adapterCapUtils';

interface InlineCapEditorProps {
  vaultAddress: Address;
  idData: `0x${string}`;
  currentValue: bigint;
  type: 'absolute' | 'relative';
  decimals: number;
  assetSymbol: string;
}

export function InlineCapEditor({
  vaultAddress,
  idData,
  currentValue,
  type,
  decimals,
  assetSymbol,
}: InlineCapEditorProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handleSave = () => {
    let newValue: bigint;

    if (type === 'absolute') {
      if (inputValue.toLowerCase() === 'unlimited' || inputValue === '') {
        newValue = MAX_UINT128;
      } else {
        newValue = BigInt(Math.round(parseFloat(inputValue) * 10 ** decimals));
      }
    } else {
      const pct = parseFloat(inputValue);
      if (isNaN(pct) || pct < 0 || pct > 100) return;
      newValue = BigInt(Math.round(pct * 1e16));
    }

    const isIncrease = newValue > currentValue;

    if (type === 'absolute') {
      writeContract({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: isIncrease ? 'increaseAbsoluteCap' : 'decreaseAbsoluteCap',
        args: [idData, newValue],
      });
    } else {
      writeContract({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: isIncrease ? 'increaseRelativeCap' : 'decreaseRelativeCap',
        args: [idData, newValue],
      });
    }
  };

  const displayValue = type === 'absolute'
    ? isUnlimitedCap(currentValue)
      ? 'Unlimited'
      : `${(Number(currentValue) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${assetSymbol}`
    : formatWadPercent(currentValue);

  if (isSuccess) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-success">
        <Check className="w-3 h-3" />
        Updated
      </div>
    );
  }

  if (isPending || isConfirming) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
        <Loader2 className="w-3 h-3 animate-spin" />
        {isPending ? 'Confirm...' : 'Confirming...'}
      </div>
    );
  }

  if (!editing) {
    return (
      <button
        onClick={() => {
          setEditing(true);
          if (type === 'absolute') {
            setInputValue(isUnlimitedCap(currentValue) ? 'unlimited' : (Number(currentValue) / 10 ** decimals).toString());
          } else {
            setInputValue((Number(currentValue) / 1e16).toString());
          }
        }}
        className="text-xs font-mono text-text-primary hover:text-accent-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
        aria-label={`Edit ${type} cap`}
      >
        {displayValue}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        className="w-24 px-1.5 py-0.5 text-xs font-mono bg-bg-root border border-border-subtle text-text-primary focus:outline-none focus:border-accent-primary"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <Button size="sm" onClick={handleSave} aria-label="Save cap">
        <Check className="w-3 h-3" />
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancel edit">
        ×
      </Button>
    </div>
  );
}
