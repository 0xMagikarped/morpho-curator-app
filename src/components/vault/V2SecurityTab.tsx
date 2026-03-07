import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { SectionHeader } from '../ui/SectionHeader';
import { AddressDisplay } from '../ui/AddressDisplay';
import { useVaultInfo, useVaultRole, useVaultPendingActions } from '../../lib/hooks/useVault';
import { metaMorphoV2Abi } from '../../lib/contracts/metaMorphoV2Abi';
import { formatCountdown, parseTokenAmount } from '../../lib/utils/format';
import { getEmergencyRole } from '../../types';
import { useChainGuard } from '../../lib/hooks/useChainGuard';

interface V2SecurityTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function V2SecurityTab({ chainId, vaultAddress }: V2SecurityTabProps) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const { isMismatch, requestSwitch } = useChainGuard(chainId);
  const role = useVaultRole(chainId, vaultAddress);
  const { data: pendingActions } = useVaultPendingActions(chainId, vaultAddress, undefined);
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const [deallocateMarketId, setDeallocateMarketId] = useState('');
  const [deallocateAmount, setDeallocateAmount] = useState('');
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const interval = setInterval(() => {
      setNowSeconds(BigInt(Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!vault) {
    return <div className="h-32 animate-shimmer rounded-lg" />;
  }

  const emergencyRoleAddr = getEmergencyRole(vault);
  const sentinel = vault.version === 'v2' ? vault.sentinel : null;
  const canEmergency = role.isEmergencyRole || role.isOwner;

  const handleForceDeallocate = () => {
    if (!deallocateMarketId || !deallocateAmount) return;
    const decimals = vault?.assetInfo.decimals ?? 18;
    const assets = parseTokenAmount(deallocateAmount, decimals);

    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'forceDeallocate',
      args: [deallocateMarketId as `0x${string}`, assets],
    });
  };

  return (
    <div className="space-y-4">
      {/* Roles */}
      <Card>
        <CardHeader>
          <CardTitle>
            <SectionHeader>Security Roles</SectionHeader>
          </CardTitle>
          <Badge variant="purple">V2</Badge>
        </CardHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RoleItem label="Guardian / Emergency" address={emergencyRoleAddr} chainId={chainId} />
          {sentinel && <RoleItem label="Sentinel" address={sentinel} chainId={chainId} />}
        </div>
      </Card>

      {isMismatch && (
        <div className="flex items-center justify-between bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
          <span className="text-xs text-warning">Wallet is on the wrong network. Switch to continue.</span>
          <Button size="sm" variant="secondary" onClick={requestSwitch}>Switch Network</Button>
        </div>
      )}

      {/* Emergency Actions */}
      {canEmergency && (
        <Card className="border-danger/20">
          <CardHeader>
            <SectionHeader>Emergency: Force Deallocate</SectionHeader>
            <Badge variant="danger">Sentinel / Guardian</Badge>
          </CardHeader>
          <p className="text-xs text-text-tertiary mb-3">
            Force-withdraw assets from a market. This is an emergency action that bypasses normal allocation flow.
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Market ID (0x...)"
              value={deallocateMarketId}
              onChange={(e) => setDeallocateMarketId(e.target.value)}
              className="flex-1 bg-bg-elevated border border-border-default rounded-md px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
            />
            <input
              type="number"
              placeholder="Amount"
              value={deallocateAmount}
              onChange={(e) => setDeallocateAmount(e.target.value)}
              className="w-32 bg-bg-elevated border border-border-default rounded-md px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
            />
            <Button
              variant="danger"
              onClick={handleForceDeallocate}
              disabled={!deallocateMarketId || !deallocateAmount || isMismatch}
              loading={isPending || isConfirming}
            >
              Force Deallocate
            </Button>
          </div>
        </Card>
      )}

      {/* Pending Actions */}
      <Card>
        <CardHeader>
          <SectionHeader>Pending Timelocked Actions</SectionHeader>
          {pendingActions && pendingActions.length > 0 && (
            <Badge variant="warning">{pendingActions.length}</Badge>
          )}
        </CardHeader>
        {pendingActions && pendingActions.length > 0 ? (
          <div className="space-y-2">
            {pendingActions.map((action, i) => {
              const isReady = action.validAt > 0n && action.validAt <= nowSeconds;

              return (
                <div key={i} className="flex items-center justify-between py-2 px-3 bg-bg-hover/50 rounded-md text-xs">
                  <div>
                    <Badge variant={isReady ? 'success' : 'warning'}>{action.type}</Badge>
                    <span className="text-text-primary ml-2">{action.description}</span>
                  </div>
                  <span className="text-text-tertiary font-mono">
                    {isReady ? 'Ready' : formatCountdown(action.validAt)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-text-tertiary text-sm">No pending actions.</p>
        )}
      </Card>
    </div>
  );
}

function RoleItem({ label, address, chainId }: { label: string; address: string; chainId: number }) {
  const isZero = address === '0x0000000000000000000000000000000000000000' || address === '0x0';
  return (
    <div>
      <span className="text-xs text-text-tertiary">{label}</span>
      {isZero ? (
        <p className="text-sm text-text-tertiary mt-0.5">Not assigned</p>
      ) : (
        <div className="mt-0.5">
          <AddressDisplay address={address} chainId={chainId} />
        </div>
      )}
    </div>
  );
}
