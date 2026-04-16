import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Shield } from 'lucide-react';
import type { Address } from 'viem';
import { useVaultPendingState } from './useVaultPendingState';
import { PendingActionsBanner } from './PendingActionsBanner';
import { RoleManagement } from './RoleManagement';
import { FeeManagement } from './FeeManagement';
import { TimelockManagement } from './TimelockManagement';
import { useVaultFlavor } from '../../../lib/vault/flavor';
import { PendingProposalsPanel } from '../moolah/PendingProposalsPanel';

interface OwnerActionsPanelProps {
  chainId: number;
  vaultAddress: Address;
  isOwner: boolean;
}

export function OwnerActionsPanel({ chainId, vaultAddress, isOwner }: OwnerActionsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const { data: pending, isLoading, refetch } = useVaultPendingState(chainId, vaultAddress);
  const { data: flavor } = useVaultFlavor(chainId, vaultAddress);
  const isMoolah = flavor === 'moolahVault';

  const handleSuccess = useCallback(() => {
    refetch();
  }, [refetch]);

  // On MetaMorpho: show only to owner. On Moolah: show to everyone —
  // Pending Proposals + role card are read-useful. Write buttons inside
  // gate on permissions.canPropose individually.
  if (!isMoolah && (!isOwner || isLoading || !pending)) return null;
  if (isMoolah && isLoading) return null;

  return (
    <div className="space-y-4">
      {/* MetaMorpho-only: legacy pending actions (submitCap/acceptCap etc.) */}
      {!isMoolah && pending && (
        <PendingActionsBanner
          chainId={chainId}
          vaultAddress={vaultAddress}
          pending={pending}
          isOwner={isOwner}
          onSuccess={handleSuccess}
        />
      )}

      {/* Moolah-only: TimelockController-scheduled proposals */}
      {isMoolah && (
        <PendingProposalsPanel chainId={chainId} vaultAddress={vaultAddress} />
      )}

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
              currentCurator={pending?.curator ?? '0x0000000000000000000000000000000000000000'}
              currentFeeRecipient={pending?.feeRecipient ?? '0x0000000000000000000000000000000000000000'}
              currentGuardian={pending?.guardian ?? '0x0000000000000000000000000000000000000000'}
              onSuccess={handleSuccess}
            />

            {/* Fee + timelock management are MetaMorpho-native. On Moolah
                these surface through the timelock propose flow — see Stage 5
                write router + the Moolah role card. */}
            {!isMoolah && pending && (
              <>
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
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
