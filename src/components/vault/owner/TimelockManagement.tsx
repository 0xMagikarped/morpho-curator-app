import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { metaMorphoV1Abi } from '../../../lib/contracts/abis';

interface TimelockManagementProps {
  chainId: number;
  vaultAddress: Address;
  currentTimelock: bigint;
  pendingTimelock: { value: bigint; validAt: bigint } | null;
  onSuccess: () => void;
}

export function TimelockManagement({
  chainId,
  vaultAddress,
  currentTimelock,
  pendingTimelock,
  onSuccess,
}: TimelockManagementProps) {
  const [daysInput, setDaysInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { writeContract, data: hash, isPending, error: txError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      setDaysInput('');
      setError(null);
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  const currentSeconds = Number(currentTimelock);
  const currentDays = currentSeconds / 86400;

  const handleSubmit = () => {
    setError(null);
    const days = parseFloat(daysInput);
    if (isNaN(days) || days <= 0) {
      setError('Enter a positive number of days');
      return;
    }
    const newSeconds = BigInt(Math.round(days * 86400));
    if (newSeconds <= currentTimelock) {
      setError(`New timelock must be greater than current (${formatTimelockDisplay(currentSeconds)}). Timelock can only be increased.`);
      return;
    }

    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'submitTimelock',
      args: [newSeconds],
      chainId,
    });
  };

  const isBusy = isPending || isConfirming;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timelock Management</CardTitle>
        <Badge>{formatTimelockDisplay(currentSeconds)}</Badge>
      </CardHeader>
      <div className="space-y-3">
        {/* Current timelock */}
        <div className="text-xs text-text-tertiary">
          Current timelock: <span className="font-mono text-text-primary">{formatTimelockDisplay(currentSeconds)}</span>
          {currentSeconds > 0 && (
            <span className="text-text-tertiary"> ({currentSeconds.toLocaleString()}s)</span>
          )}
        </div>

        {/* Submit new timelock */}
        <div>
          <span className="text-xs text-text-secondary font-medium">Increase Timelock</span>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="number"
              step="0.5"
              min="0"
              value={daysInput}
              onChange={(e) => setDaysInput(e.target.value)}
              placeholder={currentDays > 0 ? `> ${currentDays}` : 'e.g. 3'}
              className="w-24 bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-text-primary font-mono placeholder-text-tertiary focus:outline-none focus:border-border-focus"
            />
            <span className="text-xs text-text-tertiary">days</span>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!daysInput || isBusy}
              loading={isBusy}
            >
              {isPending ? 'Confirm...' : isConfirming ? 'Confirming...' : 'Submit'}
            </Button>
          </div>
          <p className="text-[10px] text-warning mt-1">
            Timelock can only be increased, never decreased. Subject to current timelock delay.
          </p>
        </div>

        {/* Pending timelock */}
        {pendingTimelock && (
          <div className="bg-blue-muted border border-blue-primary/20 px-3 py-2">
            <span className="text-xs text-text-secondary">
              Pending timelock: <span className="font-mono">{formatTimelockDisplay(Number(pendingTimelock.value))}</span>
            </span>
          </div>
        )}

        {error && <p className="text-[10px] text-danger">{error}</p>}
        {txError && <p className="text-[10px] text-danger">{(txError as Error).message?.slice(0, 120)}</p>}
      </div>
    </Card>
  );
}

function formatTimelockDisplay(seconds: number): string {
  if (seconds === 0) return 'None (0s)';
  const days = seconds / 86400;
  if (days >= 1 && seconds % 86400 === 0) return `${days} day${days > 1 ? 's' : ''}`;
  const hours = seconds / 3600;
  if (hours >= 1 && seconds % 3600 === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  return `${seconds.toLocaleString()}s`;
}
