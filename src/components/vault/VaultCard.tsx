import { Component, useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../ui/Card';
import { ChainBadge } from '../ui/ChainBadge';
import { VersionBadge } from '../ui/VersionBadge';
import { RoleBadge } from '../ui/RoleBadge';
import { ProgressBar } from '../ui/ProgressBar';
import { Button } from '../ui/Button';
import { useVaultInfo, useVaultAllocation, useVaultRole, useVaultPendingActions } from '../../lib/hooks/useVault';
import { formatTokenAmount, formatWadPercent, formatDuration, formatCountdown } from '../../lib/utils/format';
import { truncateAddress } from '../../lib/utils/format';
import type { Address } from 'viem';

class VaultCardErrorBoundary extends Component<{ address: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <Card>
          <div className="py-4 text-center space-y-1">
            <p className="text-xs text-danger">Failed to load vault</p>
            <p className="text-[10px] text-text-tertiary font-mono">{truncateAddress(this.props.address)}</p>
            <p className="text-[10px] text-text-tertiary">{this.state.error.message}</p>
          </div>
        </Card>
      );
    }
    return this.props.children;
  }
}

interface VaultCardProps {
  chainId: number;
  vaultAddress: Address;
}

export function VaultCard({ chainId, vaultAddress }: VaultCardProps) {
  return (
    <VaultCardErrorBoundary address={vaultAddress}>
      <VaultCardInner chainId={chainId} vaultAddress={vaultAddress} />
    </VaultCardErrorBoundary>
  );
}

function VaultCardInner({ chainId, vaultAddress }: VaultCardProps) {
  const navigate = useNavigate();
  const { data: vault, isLoading, error } = useVaultInfo(chainId, vaultAddress);
  const { data: allocation } = useVaultAllocation(chainId, vaultAddress);
  const role = useVaultRole(chainId, vaultAddress);
  const { data: pendingActions } = useVaultPendingActions(
    chainId,
    vaultAddress,
    allocation?.supplyQueue,
  );

  // useMemo MUST be before any early return (Rules of Hooks)
  const activePending = useMemo(() => {
    if (!pendingActions) return undefined;
    const now = BigInt(Math.floor(Date.now() / 1000));
    return pendingActions.filter((a) => a.validAt > now);
  }, [pendingActions]);

  if (isLoading) {
    return (
      <Card>
        <div className="h-32 animate-shimmer" />
      </Card>
    );
  }

  if (error || !vault) {
    return (
      <Card>
        <div className="py-4 text-center space-y-1">
          <p className="text-xs text-danger">Failed to load vault</p>
          <p className="text-[10px] text-text-tertiary font-mono">{truncateAddress(vaultAddress)}</p>
          <p className="text-[10px] text-text-tertiary">{error instanceof Error ? error.message : 'Vault data unavailable'}</p>
        </div>
      </Card>
    );
  }

  const roles: { key: string; role: 'owner' | 'curator' | 'allocator' | 'guardian' | 'sentinel' }[] = [];
  if (role.isOwner) roles.push({ key: 'owner', role: 'owner' });
  if (role.isCurator) roles.push({ key: 'curator', role: 'curator' });
  if (role.isAllocator) roles.push({ key: 'allocator', role: 'allocator' });
  if (role.isEmergencyRole) roles.push({
    key: 'emergency',
    role: vault.version === 'v2' ? 'sentinel' : 'guardian',
  });

  const totalAllocated = allocation?.totalAllocated ?? 0n;
  const idleAssets = vault.totalAssets - totalAllocated;
  const idlePct = vault.totalAssets > 0n
    ? Number((idleAssets * 10000n) / vault.totalAssets) / 100
    : 0;
  const utilization = vault.totalAssets > 0n
    ? Number((totalAllocated * 10000n) / vault.totalAssets) / 100
    : 0;

  return (
    <Card
      hover
      onClick={() => navigate(`/vault/${chainId}/${vaultAddress}`)}
      className="space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text-primary">{String(vault.name)}</h3>
          <ChainBadge chainId={chainId} />
          <VersionBadge version={vault.version as 'v1' | 'v2'} />
        </div>
        <div className="flex gap-1">
          {roles.map((r) => (
            <RoleBadge key={r.key} role={r.role} />
          ))}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <div>
          <p className="text-[10px] text-text-tertiary uppercase tracking-wide">TVL</p>
          <p className="text-sm font-mono font-medium text-text-primary">
            {formatTokenAmount(vault.totalAssets, vault.assetInfo.decimals)} {vault.assetInfo.symbol}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Fee</p>
          <p className="text-sm font-mono font-medium text-text-primary">{formatWadPercent(vault.fee)}</p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Timelock</p>
          <p className="text-sm font-mono font-medium text-text-primary">{formatDuration(vault.timelock)}</p>
        </div>
        <div>
          <p className="text-[10px] text-text-tertiary uppercase tracking-wide">Idle</p>
          <p className="text-sm font-mono font-medium text-text-primary">
            {formatTokenAmount(idleAssets, vault.assetInfo.decimals)} ({idlePct.toFixed(1)}%)
          </p>
        </div>
      </div>

      {/* Utilization bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-text-tertiary">
          <span>Utilization</span>
          <span className="font-mono">{utilization.toFixed(1)}%</span>
        </div>
        <ProgressBar value={utilization} height="sm" />
      </div>

      {/* Pending actions */}
      {activePending && activePending.length > 0 && (
        <div className="space-y-1">
          {activePending.map((action, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-warning">
              <span className="w-1.5 h-1.5 bg-warning" />
              <span>{action.description}</span>
              <span className="text-text-tertiary ml-auto font-mono">
                {formatCountdown(action.validAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="secondary">Manage</Button>
        {role.isAllocator && (
          <Button size="sm" variant="secondary">Allocate</Button>
        )}
      </div>
    </Card>
  );
}
