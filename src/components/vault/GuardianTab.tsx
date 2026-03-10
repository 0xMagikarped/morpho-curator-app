import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useVaultRole, useVaultPendingActions, useVaultAllocation, useVaultInfo } from '../../lib/hooks/useVault';
import { metaMorphoV1Abi } from '../../lib/contracts/abis';
import { formatCountdown } from '../../lib/utils/format';
import { getEmergencyRoleLabel } from '../../types';
import { useChainGuard } from '../../lib/hooks/useChainGuard';

interface GuardianTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function GuardianTab({ chainId, vaultAddress }: GuardianTabProps) {
  const role = useVaultRole(chainId, vaultAddress);
  const { isMismatch, requestSwitch } = useChainGuard(chainId);
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const { data: allocation } = useVaultAllocation(chainId, vaultAddress);
  const marketIds = allocation
    ? [...new Set([...allocation.supplyQueue, ...allocation.withdrawQueue])]
    : undefined;
  const { data: pendingActions } = useVaultPendingActions(chainId, vaultAddress, marketIds);
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const interval = setInterval(() => {
      setNowSeconds(BigInt(Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const isV2 = vault?.version === 'v2';
  const roleLabel = vault ? getEmergencyRoleLabel(vault.version) : 'Guardian';

  const handleRevokeTimelock = () => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'revokePendingTimelock',
    });
  };

  const handleRevokeGuardian = () => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'revokePendingGuardian',
    });
  };

  const handleRevokeCap = (marketId: `0x${string}`) => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'revokePendingCap',
      args: [marketId],
    });
  };

  const handleRevokeMarketRemoval = (marketId: `0x${string}`) => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'revokePendingMarketRemoval',
      args: [marketId],
    });
  };

  if (!role.isEmergencyRole && !role.isOwner) {
    return (
      <Card className="py-8 text-center">
        <p className="text-text-tertiary text-sm">
          You need the {roleLabel} or Owner role to access this panel.
        </p>
      </Card>
    );
  }

  const hasPending = pendingActions && pendingActions.length > 0;

  return (
    <div className="space-y-4">
      {isMismatch && (
        <div className="flex items-center justify-between bg-warning/10 border border-warning/20 px-3 py-2">
          <span className="text-xs text-warning">Wallet is on the wrong network. Switch to continue.</span>
          <Button size="sm" variant="secondary" onClick={requestSwitch}>Switch Network</Button>
        </div>
      )}

      {/* Emergency Controls */}
      <Card className="border-danger/20">
        <CardHeader>
          <CardTitle>{roleLabel} Dashboard — Emergency Actions</CardTitle>
          <Badge variant="danger">{roleLabel}</Badge>
        </CardHeader>
        <p className="text-xs text-text-tertiary mb-4">
          {isV2
            ? 'The Sentinel can revoke pending actions, deallocate from adapters, and decrease caps.'
            : 'The Guardian can revoke any pending timelocked action.'}
        </p>

        <div className="flex gap-3">
          <Button
            variant="danger"
            size="sm"
            onClick={handleRevokeTimelock}
            loading={isPending || isConfirming}
            disabled={isMismatch}
          >
            Revoke Pending Timelock
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleRevokeGuardian}
            loading={isPending || isConfirming}
            disabled={isMismatch}
          >
            Revoke Pending {roleLabel}
          </Button>
        </div>
      </Card>

      {/* Pending Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Pending Actions (Revocable)</CardTitle>
          {hasPending && <Badge variant="warning">{pendingActions!.length}</Badge>}
        </CardHeader>
        {hasPending ? (
          <div className="space-y-2">
            {pendingActions!.map((action, i) => {
              const isReady = action.validAt <= nowSeconds;

              return (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 px-3 bg-bg-hover/30"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isReady ? 'success' : 'warning'}>
                        {action.type}
                      </Badge>
                      <span className="text-sm text-text-primary">
                        {action.description}
                      </span>
                    </div>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {isReady
                        ? 'Executable now — anyone can trigger'
                        : `Available in ${formatCountdown(action.validAt)}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {action.type === 'cap' && action.marketId && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleRevokeCap(action.marketId!)}
                        loading={isPending}
                      >
                        Revoke
                      </Button>
                    )}
                    {action.type === 'marketRemoval' && action.marketId && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => handleRevokeMarketRemoval(action.marketId!)}
                        loading={isPending}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-text-tertiary text-sm">No pending actions to revoke.</p>
        )}
      </Card>
    </div>
  );
}
