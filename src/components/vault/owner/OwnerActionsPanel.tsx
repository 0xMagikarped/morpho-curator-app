import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Shield } from 'lucide-react';
import type { Address } from 'viem';
import { useVaultPendingState } from './useVaultPendingState';
import { PendingActionsBanner } from './PendingActionsBanner';
import { RoleManagement } from './RoleManagement';
import { FeeManagement } from './FeeManagement';
import { TimelockManagement } from './TimelockManagement';

interface OwnerActionsPanelProps {
  chainId: number;
  vaultAddress: Address;
  isOwner: boolean;
}

export function OwnerActionsPanel({ chainId, vaultAddress, isOwner }: OwnerActionsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const { data: pending, isLoading, refetch } = useVaultPendingState(chainId, vaultAddress);

  const handleSuccess = useCallback(() => {
    refetch();
  }, [refetch]);

  if (!isOwner || isLoading || !pending) return null;

  return (
    <div className="space-y-4">
      {/* Pending Actions Banner — always visible when there are pending items */}
      <PendingActionsBanner
        chainId={chainId}
        vaultAddress={vaultAddress}
        pending={pending}
        isOwner={isOwner}
        onSuccess={handleSuccess}
      />

      {/* Collapsible Owner Section */}
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-3 py-2 bg-bg-surface border border-border-default text-xs font-medium text-text-secondary hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
        >
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-accent-primary" />
            <span className="font-display">Owner Actions</span>
          </div>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {expanded && (
          <div className="space-y-4 mt-4">
            <RoleManagement
              chainId={chainId}
              vaultAddress={vaultAddress}
              currentCurator={pending.curator}
              currentFeeRecipient={pending.feeRecipient}
              currentGuardian={pending.guardian}
              onSuccess={handleSuccess}
            />

            <FeeManagement
              chainId={chainId}
              vaultAddress={vaultAddress}
              currentFee={pending.fee}
              currentTimelock={pending.timelock}
              feeRecipient={pending.feeRecipient}
              pendingFee={pending.pendingFee}
              onSuccess={handleSuccess}
            />

            <TimelockManagement
              chainId={chainId}
              vaultAddress={vaultAddress}
              currentTimelock={pending.timelock}
              pendingTimelock={pending.pendingTimelock}
              onSuccess={handleSuccess}
            />
          </div>
        )}
      </div>
    </div>
  );
}
