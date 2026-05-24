import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useGuardedWriteContract } from '../../hooks/useGuardedWriteContract';
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
import { V2SetterDrawer } from './params/V2SetterDrawer';

interface V2SecurityTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function V2SecurityTab({ chainId, vaultAddress }: V2SecurityTabProps) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const { isMismatch, requestSwitch } = useChainGuard(chainId);
  const role = useVaultRole(chainId, vaultAddress);
  const { data: pendingActions } = useVaultPendingActions(chainId, vaultAddress, undefined);
  const { writeContract, data: txHash, isPending } = useGuardedWriteContract();
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
    return <div className="h-32 animate-shimmer" />;
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

      {/* PR 28 — Morpho-curator-style emergency playbooks. Five preset
          actions with descriptions; each opens its own drawer. Close
          Deposits + Allocator Compromised are implemented as single-call
          flows. The three complex playbooks (Hard / Safe Market Removal,
          Sentinel Lockdown) are stubbed with disabled Start buttons —
          they need multi-call orchestration that's tracked as PR 29. */}
      {canEmergency && (
        <EmergencyPlaybooks chainId={chainId} vaultAddress={vaultAddress} />
      )}

      {isMismatch && (
        <div className="flex items-center justify-between bg-warning/10 border border-warning/20 px-3 py-2">
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
              className="flex-1 bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
            />
            <input
              type="number"
              placeholder="Amount"
              value={deallocateAmount}
              onChange={(e) => setDeallocateAmount(e.target.value)}
              className="w-32 bg-bg-elevated border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none"
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
                <div key={i} className="flex items-center justify-between py-2 px-3 bg-bg-hover/50 text-xs">
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

/**
 * PR 28 — Morpho-curator-style emergency playbooks card.
 *
 * Five preset emergency actions matching Morpho's curator app:
 *   1. Close Deposits        — IMPLEMENTED (single immediate call)
 *   2. Hard Market Removal   — TODO (PR 29 — complex multi-call playbook)
 *   3. Safe Market Removal   — TODO (PR 29)
 *   4. Sentinel Lockdown     — TODO (PR 29 — needs `abdicate` flow)
 *   5. Allocator Compromised — IMPLEMENTED (delegates to V2SetterDrawer)
 */
function EmergencyPlaybooks({
  chainId,
  vaultAddress,
}: {
  chainId: number;
  vaultAddress: Address;
}) {
  const [open, setOpen] = useState<'close-deposits' | 'allocator-compromised' | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <SectionHeader>Emergency Actions</SectionHeader>
        </CardTitle>
        <Badge variant="danger">Privileged</Badge>
      </CardHeader>

      <div className="divide-y divide-border-subtle">
        <PlaybookRow
          title="Close Deposits"
          description="Block new deposits by disabling the active liquidity adapter — either zeroing its caps or redirecting it to an idle market. Requires a curator, sentinel, or allocator role."
          actionLabel="Start"
          onAction={() => setOpen('close-deposits')}
        />
        <PlaybookRow
          title="Hard Market Removal"
          description="Accept permanent loss of stuck capital. Revokes pending cap increases, zeros caps, and burns the adapter's shares for a reverting market. Requires the curator role."
          actionLabel="Start"
          disabled
          disabledHint="PR 29 — multi-call playbook needs orchestration"
        />
        <PlaybookRow
          title="Safe Market Removal"
          description="Revoke pending cap increases for a market, zero its caps, and safely deallocate any withdrawable funds. Requires the sentinel role."
          actionLabel="Start"
          disabled
          disabledHint="PR 29 — multi-call playbook needs orchestration"
        />
        <PlaybookRow
          title="Sentinel Lockdown"
          description="Execute a full lockdown of the vault, activating all sentinel capabilities. Requires the sentinel role."
          actionLabel="Start"
          disabled
          disabledHint="PR 29 — needs the abdicate flow"
        />
        <PlaybookRow
          title="Allocator Compromised"
          description="Remove a compromised allocator and zero all adapter caps to reduce vault exposure. Requires the curator role."
          actionLabel="Start"
          onAction={() => setOpen('allocator-compromised')}
        />
      </div>

      {open === 'close-deposits' && (
        <CloseDepositsConfirmDialog
          vaultAddress={vaultAddress}
          chainId={chainId}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'allocator-compromised' && (
        <V2SetterDrawer
          open
          onClose={() => setOpen(null)}
          intent={{ kind: 'setIsAllocator', defaultGrant: false }}
          vaultAddress={vaultAddress}
          chainId={chainId}
          timelockSeconds={0n}
        />
      )}
    </Card>
  );
}

function PlaybookRow({
  title,
  description,
  actionLabel,
  onAction,
  disabled,
  disabledHint,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction?: () => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        <p className="text-[10px] text-text-tertiary mt-0.5">{description}</p>
      </div>
      <div className="shrink-0">
        {disabled ? (
          <Button size="sm" variant="ghost" disabled title={disabledHint}>
            Coming soon
          </Button>
        ) : (
          <Button size="sm" variant="danger" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Close Deposits — calls `setLiquidityAdapterAndData(0x0, 0x)` so new
 * deposits sit idle instead of auto-flowing to the active liquidity
 * adapter. Immediate (not timelocked).
 */
function CloseDepositsConfirmDialog({
  vaultAddress,
  chainId,
  onClose,
}: {
  vaultAddress: Address;
  chainId: number;
  onClose: () => void;
}) {
  const { writeContract, isPending, error, simulateError } = useGuardedWriteContract();
  const handleConfirm = () => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'setLiquidityAdapterAndData',
      args: ['0x0000000000000000000000000000000000000000', '0x'],
      chainId,
    });
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-bg-surface border border-border-default w-full max-w-md p-5 space-y-3">
        <h2 className="text-sm font-medium text-text-primary">Close Deposits — Confirm</h2>
        <p className="text-xs text-text-tertiary">
          This will clear the active liquidity adapter. New deposits will sit idle on the vault
          (no auto-allocation to any adapter) until you set a new liquidity adapter.
        </p>
        <p className="text-xs text-text-tertiary">
          Immediate (not timelocked). Requires curator / sentinel / allocator role.
        </p>
        {(simulateError || error) && (
          <div role="alert" className="bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
            {simulateError?.message ?? (error instanceof Error ? error.message : 'Transaction failed.')}
          </div>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="danger" onClick={handleConfirm} disabled={isPending} loading={isPending}>
            Confirm
          </Button>
        </div>
      </div>
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
