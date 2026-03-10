import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import type { Address } from 'viem';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { truncateAddress } from '../../../lib/utils/format';
import { metaMorphoV1Abi } from '../../../lib/contracts/abis';
import type { VaultPendingState } from './useVaultPendingState';

interface PendingActionsBannerProps {
  chainId: number;
  vaultAddress: Address;
  pending: VaultPendingState;
  isOwner: boolean;
  onSuccess: () => void;
}

export function PendingActionsBanner({ chainId, vaultAddress, pending, isOwner, onSuccess }: PendingActionsBannerProps) {
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    const interval = setInterval(() => setNowSeconds(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isSuccess) onSuccess();
  }, [isSuccess, onSuccess]);

  const hasPending = pending.pendingFee || pending.pendingTimelock || pending.pendingGuardian;
  if (!hasPending) return null;

  const formatCountdown = (validAt: bigint) => {
    const diff = Number(validAt - nowSeconds);
    if (diff <= 0) return null; // ready
    const d = Math.floor(diff / 86400);
    const h = Math.floor((diff % 86400) / 3600);
    const m = Math.floor((diff % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const isReady = (validAt: bigint) => validAt <= nowSeconds;
  const isBusy = isPending || isConfirming;

  return (
    <Card className="border-warning/30 bg-warning/5">
      <div className="flex items-center gap-2 mb-3">
        <Clock size={14} className="text-warning" />
        <span className="text-xs font-medium text-warning uppercase tracking-wider">Pending Actions</span>
      </div>
      <div className="space-y-2">
        {pending.pendingFee && (
          <PendingItem
            label={`New fee: ${(Number(pending.pendingFee.value) / 1e16).toFixed(2)}%`}
            validAt={pending.pendingFee.validAt}
            isReady={isReady(pending.pendingFee.validAt)}
            countdown={formatCountdown(pending.pendingFee.validAt)}
            canAccept={isOwner}
            isBusy={isBusy}
            onAccept={() => writeContract({
              address: vaultAddress,
              abi: metaMorphoV1Abi,
              functionName: 'acceptFee',
              chainId,
            })}
          />
        )}
        {pending.pendingTimelock && (
          <PendingItem
            label={`New timelock: ${formatTimelockDisplay(Number(pending.pendingTimelock.value))}`}
            validAt={pending.pendingTimelock.validAt}
            isReady={isReady(pending.pendingTimelock.validAt)}
            countdown={formatCountdown(pending.pendingTimelock.validAt)}
            canAccept={isOwner}
            isBusy={isBusy}
            onAccept={() => writeContract({
              address: vaultAddress,
              abi: metaMorphoV1Abi,
              functionName: 'acceptTimelock',
              chainId,
            })}
          />
        )}
        {pending.pendingGuardian && (
          <PendingItem
            label={`New guardian: ${truncateAddress(pending.pendingGuardian.guardian)}`}
            validAt={pending.pendingGuardian.validAt}
            isReady={isReady(pending.pendingGuardian.validAt)}
            countdown={formatCountdown(pending.pendingGuardian.validAt)}
            canAccept={isOwner}
            isBusy={isBusy}
            onAccept={() => writeContract({
              address: vaultAddress,
              abi: metaMorphoV1Abi,
              functionName: 'acceptGuardian',
              chainId,
            })}
          />
        )}
      </div>
    </Card>
  );
}

function PendingItem({
  label,
  isReady,
  countdown,
  canAccept,
  isBusy,
  onAccept,
}: {
  label: string;
  validAt: bigint;
  isReady: boolean;
  countdown: string | null;
  canAccept: boolean;
  isBusy: boolean;
  onAccept: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-primary">{label}</span>
        {isReady ? (
          <Badge variant="success">Ready</Badge>
        ) : (
          <Badge variant="warning">{countdown}</Badge>
        )}
      </div>
      {canAccept && isReady && (
        <Button size="sm" onClick={onAccept} disabled={isBusy} loading={isBusy}>
          Accept
        </Button>
      )}
    </div>
  );
}

function formatTimelockDisplay(seconds: number): string {
  if (seconds === 0) return 'None';
  const days = seconds / 86400;
  if (days >= 1 && seconds % 86400 === 0) return `${days} day${days > 1 ? 's' : ''}`;
  const hours = seconds / 3600;
  if (hours >= 1 && seconds % 3600 === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  return `${seconds.toLocaleString()}s`;
}
