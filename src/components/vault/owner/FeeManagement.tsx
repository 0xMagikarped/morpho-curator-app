import { useState, useEffect } from 'react';
import { parseUnits } from 'viem';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { metaMorphoV1Abi } from '../../../lib/contracts/abis';

interface FeeManagementProps {
  chainId: number;
  vaultAddress: Address;
  currentFee: bigint;
  currentTimelock: bigint;
  feeRecipient: Address;
  pendingFee: { value: bigint; validAt: bigint } | null;
  onSuccess: () => void;
}

const ZERO = '0x0000000000000000000000000000000000000000';

export function FeeManagement({
  chainId,
  vaultAddress,
  currentFee,
  currentTimelock,
  feeRecipient,
  pendingFee,
  onSuccess,
}: FeeManagementProps) {
  const [feeInput, setFeeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { writeContract, data: hash, isPending, error: txError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      setFeeInput('');
      setError(null);
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  const currentFeePercent = Number(currentFee) / 1e16;
  const noFeeRecipient = feeRecipient === ZERO;

  const handleSubmit = () => {
    setError(null);
    const pct = parseFloat(feeInput);
    if (isNaN(pct) || pct < 0) {
      setError('Fee must be a positive number');
      return;
    }
    if (pct > 50) {
      setError('Max fee is 50%');
      return;
    }
    if (pct > 0 && noFeeRecipient) {
      setError('Set a fee recipient first — fee > 0 requires feeRecipient != address(0)');
      return;
    }

    // Convert percent to WAD: e.g. 15% → 0.15 → parseUnits("0.15", 18)
    const feeWad = parseUnits(String(pct / 100), 18);

    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: currentTimelock > 0n ? 'submitFee' : 'setFee',
      args: [feeWad],
      chainId,
    });
  };

  const isBusy = isPending || isConfirming;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fee Management</CardTitle>
        <Badge>{currentFeePercent.toFixed(2)}%</Badge>
      </CardHeader>
      <div className="space-y-3">
        {/* Current fee display */}
        <div className="text-xs text-text-tertiary">
          Current performance fee: <span className="font-mono text-text-primary">{currentFeePercent.toFixed(2)}%</span>
        </div>

        {/* Fee recipient warning */}
        {noFeeRecipient && (
          <div className="bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
            No fee recipient set. You must set a fee recipient before setting a fee &gt; 0%.
          </div>
        )}

        {/* Submit new fee */}
        <div>
          <span className="text-xs text-text-secondary font-medium">Set New Fee</span>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="number"
              step="0.01"
              min="0"
              max="50"
              value={feeInput}
              onChange={(e) => setFeeInput(e.target.value)}
              placeholder="e.g. 15"
              className="w-24 bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-text-primary font-mono placeholder-text-tertiary focus:outline-none focus:border-border-focus"
            />
            <span className="text-xs text-text-tertiary">%</span>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!feeInput || isBusy}
              loading={isBusy}
            >
              {isPending ? 'Confirm...' : isConfirming ? 'Confirming...' : currentTimelock > 0n ? 'Submit Fee' : 'Set Fee'}
            </Button>
          </div>
          <p className="text-[10px] text-text-tertiary mt-1">
            Max: 50%{currentTimelock > 0n ? ' · Subject to timelock — requires acceptance' : ''}
          </p>
        </div>

        {/* Pending fee */}
        {pendingFee && (
          <div className="bg-blue-muted border border-blue-primary/20 px-3 py-2">
            <span className="text-xs text-text-secondary">
              Pending fee: <span className="font-mono">{(Number(pendingFee.value) / 1e16).toFixed(2)}%</span>
            </span>
          </div>
        )}

        {error && <p className="text-[10px] text-danger">{error}</p>}
        {txError && <p className="text-[10px] text-danger">{(txError as Error).message?.slice(0, 120)}</p>}
      </div>
    </Card>
  );
}
