import { useMemo, useState } from 'react';
import { isAddress, type Address } from 'viem';
import { Shield, Clock, Layers, CheckCircle2, XCircle, Info } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { useVaultSnapshot, type TimelockEntry } from '../../../lib/vault/adapter';
import { useVaultWrite } from '../../../hooks/useVaultWrite';
import { useVaultPermissions } from '../../../hooks/useVaultPermissions';
import { getChainConfig } from '../../../config/chains';

interface RolesMoolahProps {
  chainId: number;
  vaultAddress: Address;
}

/**
 * Roles & timelocks card for Moolah vaults (Lista DAO fork).
 *
 * Moolah diverges from MetaMorpho in ways that matter to curators:
 * - No Ownable owner; `DEFAULT_ADMIN_ROLE` holder is Lista's `vaultAdmin`
 *   Safe, which controls the UUPS implementation — not the deployer.
 * - CURATOR_ROLE + MANAGER_ROLE are held by `TimelockController` contracts,
 *   one per role. All change of state (caps, queues, fees) goes through
 *   propose → wait → execute on those timelocks.
 * - Guardian semantics live on the timelocks as `CANCELLER_ROLE`; never
 *   proposes or executes.
 *
 * This card is read-focused. Writes surface as propose flows via the Stage 5
 * write router (PendingProposalsPanel + useVaultWrite); they hook in here.
 */
export function RolesMoolah({ chainId, vaultAddress }: RolesMoolahProps) {
  const { data: snapshot, isLoading } = useVaultSnapshot(chainId, vaultAddress);

  const chainConfig = getChainConfig(chainId);
  const vaultAdminFallback = chainConfig?.moolah?.vaultAdmin;

  const maxDelay = useMemo(() => {
    if (!snapshot) return 1n;
    return snapshot.timelocks.reduce((m, t) => (t.minDelay > m ? t.minDelay : m), 1n);
  }, [snapshot]);

  if (isLoading || !snapshot) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Roles &amp; Timelocks</CardTitle>
        </CardHeader>
        <div className="h-48 animate-shimmer bg-bg-hover" />
      </Card>
    );
  }

  // `admin` may be null when the vault has no DEFAULT_ADMIN_ROLE member.
  // Fall back to the Lista-published vaultAdmin from chain config so the
  // curator can still see the canonical governance address.
  const admin = snapshot.admin ?? vaultAdminFallback ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            Roles &amp; Timelocks
            <span className="px-1.5 py-0.5 text-[9px] font-mono tracking-wider uppercase bg-[#F0B90B]/10 border border-[#F0B90B]/30 text-[#F0B90B]">
              Moolah · Lista
            </span>
          </span>
        </CardTitle>
        {snapshot.moolahExtras?.isPaused && (
          <span className="px-2 py-0.5 text-[10px] font-mono bg-danger/10 border border-danger/30 text-danger">
            PAUSED
          </span>
        )}
      </CardHeader>

      <div className="space-y-4">
        {/* Protocol admin */}
        <Section
          icon={<Shield size={14} />}
          label="Protocol admin"
          tooltip="Controls the UUPS implementation upgrade. On Lista this is a DAO-controlled Safe, not the vault deployer."
        >
          {admin ? (
            <AddressDisplay address={admin} chainId={chainId} />
          ) : (
            <span className="text-[11px] font-mono text-text-tertiary">Not set</span>
          )}
        </Section>

        {/* Curator role */}
        <RoleSection
          label="Curator role"
          tooltip="The CURATOR role is held by a TimelockController contract. Proposers queue actions, the TimeLock waits minDelay, then any EXECUTOR can fire. A canceller (guardian) can veto."
          members={snapshot.curators}
          timelock={snapshot.timelocks.find(t => t.label === 'Curator')}
          chainId={chainId}
        />

        {/* Manager role */}
        <RoleSection
          label="Manager role"
          tooltip="Manager proposers queue and execute operations on the managerTimeLock. PROPOSER_ROLE on this timelock is the Moolah equivalent of MetaMorpho's allocator list."
          members={snapshot.managers}
          timelock={snapshot.timelocks.find(t => t.label === 'Manager')}
          chainId={chainId}
        />

        {/* Fee recipient */}
        <Section icon={<Layers size={14} />} label="Fee recipient">
          {snapshot.feeRecipient === '0x0000000000000000000000000000000000000000' ? (
            <span className="text-[11px] font-mono text-text-tertiary">Not set</span>
          ) : (
            <AddressDisplay address={snapshot.feeRecipient} chainId={chainId} />
          )}
        </Section>

        {/* Timelock delays */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Clock size={14} className="text-text-tertiary" />
            <span className="text-xs text-text-secondary font-medium">Timelock delays</span>
          </div>
          <div className="space-y-2">
            {snapshot.timelocks.map(tl => (
              <DelayBar key={tl.label} tl={tl} max={maxDelay} />
            ))}
          </div>
          <p className="text-[10px] text-text-tertiary mt-2">
            Both timelocks enforce a 1-day floor (Lista protocol rule).
          </p>
        </div>

        {/* Propose actions — visible to proposers */}
        <MoolahRoleActions chainId={chainId} vaultAddress={vaultAddress} />

        {/* Protocol status */}
        <div className="pt-3 border-t border-border-subtle">
          <div className="flex items-center gap-1.5 mb-1.5">
            {snapshot.moolahExtras?.isPaused ? (
              <XCircle size={12} className="text-danger" />
            ) : (
              <CheckCircle2 size={12} className="text-success" />
            )}
            <span className="text-[11px] text-text-secondary">
              {snapshot.moolahExtras?.isPaused ? 'Protocol paused' : 'Active (not paused)'}
            </span>
          </div>
          {snapshot.moolahExtras?.implementation && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-text-tertiary">Implementation:</span>
              <AddressDisplay address={snapshot.moolahExtras.implementation} chainId={chainId} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function Section({
  icon,
  label,
  tooltip,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1" title={tooltip}>
        {icon && <span className="text-text-tertiary">{icon}</span>}
        <span className="text-xs text-text-secondary font-medium">{label}</span>
        {tooltip && <Info size={10} className="text-text-tertiary/60" />}
      </div>
      <div className="text-[11px]">{children}</div>
    </div>
  );
}

function RoleSection({
  label,
  tooltip,
  members,
  timelock,
  chainId,
}: {
  label: string;
  tooltip: string;
  members: Address[];
  timelock: TimelockEntry | undefined;
  chainId: number;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5" title={tooltip}>
        <span className="text-xs text-text-secondary font-medium">{label}</span>
        <Info size={10} className="text-text-tertiary/60" />
      </div>
      {members.length === 0 ? (
        <span className="text-[11px] font-mono text-text-tertiary">No members</span>
      ) : (
        <div className="space-y-1.5">
          {members.map(m => (
            <div key={m} className="text-[11px]">
              <AddressDisplay address={m} chainId={chainId} />
              <span className="ml-2 text-[10px] text-text-tertiary">(TimeLock)</span>
            </div>
          ))}
          {timelock && (timelock.proposers?.length || timelock.cancellers?.length) ? (
            <div className="ml-3 pl-2 border-l border-border-subtle space-y-1">
              {timelock.proposers && timelock.proposers.length > 0 && (
                <div className="text-[10px] text-text-tertiary">
                  <span className="uppercase tracking-wider">Proposers:</span>{' '}
                  {timelock.proposers.map((p, i) => (
                    <span key={p}>
                      {i > 0 && ', '}
                      <AddressDisplay address={p} chainId={chainId} />
                    </span>
                  ))}
                </div>
              )}
              {timelock.cancellers && timelock.cancellers.length > 0 && (
                <div className="text-[10px] text-text-tertiary">
                  <span className="uppercase tracking-wider">Cancellers:</span>{' '}
                  {timelock.cancellers.map((p, i) => (
                    <span key={p}>
                      {i > 0 && ', '}
                      <AddressDisplay address={p} chainId={chainId} />
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Propose actions — lets Moolah proposers submit allocator / curator changes
 * through the write router (which schedules on the correct TimeLock).
 */
function MoolahRoleActions({
  chainId,
  vaultAddress,
}: {
  chainId: number;
  vaultAddress: Address;
}) {
  const permissions = useVaultPermissions(chainId, vaultAddress);
  const {
    submit, isPending, isConfirming, isSuccess,
    disabled: writeDisabled, disabledTooltip, invalidReason, mode,
  } = useVaultWrite(chainId, vaultAddress);

  const [allocatorAddr, setAllocatorAddr] = useState('');
  const [allocatorGrant, setAllocatorGrant] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMoolah = mode === 'timelocked';

  if (!permissions.canManage && !permissions.canCurate && !permissions.isAdmin) {
    return null;
  }

  const isBusy = isPending || isConfirming;

  const handleAllocator = () => {
    setError(null);
    if (!isAddress(allocatorAddr)) { setError('Invalid address'); return; }
    void submit({ kind: 'setIsAllocator', addr: allocatorAddr as Address, isAllocator: allocatorGrant });
    setAllocatorAddr('');
  };

  return (
    <div className="pt-3 border-t border-border-subtle space-y-3">
      <p className="text-[10px] text-text-tertiary uppercase tracking-wider">Propose changes</p>

      {writeDisabled && disabledTooltip && (
        <div className="px-2 py-1.5 bg-danger/10 border border-danger/30 text-[10px] text-danger">
          {disabledTooltip}
        </div>
      )}

      {/* Set allocator — manager TL proposer */}
      {(permissions.canManage || permissions.isAdmin) && (
        <div>
          <span className="text-xs text-text-secondary font-medium">
            {isMoolah ? 'Propose Allocator' : 'Set Allocator'}
          </span>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="text"
              value={allocatorAddr}
              onChange={(e) => setAllocatorAddr(e.target.value)}
              placeholder="0x… allocator address"
              className="flex-1 min-w-0 bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-text-primary font-mono placeholder-text-tertiary focus:outline-none focus:border-border-focus"
            />
            <Button
              size="sm"
              onClick={() => { setAllocatorGrant(true); handleAllocator(); }}
              disabled={!allocatorAddr || isBusy || writeDisabled}
              loading={isBusy}
              title={writeDisabled ? disabledTooltip ?? undefined : undefined}
            >
              {isMoolah ? 'Propose Grant' : 'Grant'}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => { setAllocatorGrant(false); handleAllocator(); }}
              disabled={!allocatorAddr || isBusy || writeDisabled}
              loading={isBusy}
              title={writeDisabled ? disabledTooltip ?? undefined : undefined}
            >
              {isMoolah ? 'Propose Revoke' : 'Revoke'}
            </Button>
          </div>
          <p className="text-[10px] text-text-tertiary mt-1">
            {isMoolah ? 'Scheduled via managerTimeLock.' : 'Grant or revoke allocator role.'}
          </p>
        </div>
      )}

      {isSuccess && (
        <div className="bg-success/10 border border-success/20 px-2 py-1.5 text-[10px] text-success">
          {isMoolah ? 'Proposal scheduled. Check Pending Proposals.' : 'Role updated.'}
        </div>
      )}

      {error && <p className="text-[10px] text-danger">{error}</p>}
      {invalidReason && <p className="text-[10px] text-danger">{invalidReason}</p>}
    </div>
  );
}

function DelayBar({ tl, max }: { tl: TimelockEntry; max: bigint }) {
  const delaySeconds = Number(tl.minDelay);
  const hours = Math.round(delaySeconds / 3600);
  const pct = max > 0n ? Math.min(100, Math.max(2, Number((tl.minDelay * 100n) / max))) : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-text-secondary">{tl.label} TimeLock</span>
        <span className="font-mono text-text-primary">
          {hours >= 24 ? `${Math.round(hours / 24)}d` : `${hours}h`}
        </span>
      </div>
      <div className="h-1.5 bg-bg-hover relative overflow-hidden">
        <div
          className="absolute left-0 top-0 bottom-0 bg-accent-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
