/**
 * PR 26 — V2 vault parameters page.
 *
 * Lists every governable parameter on the V2 vault and exposes an Edit
 * affordance per row. Edits go through the generic `V2SetterDrawer`
 * (PR 26) which implements the Submit→Wait→Execute timelock pattern
 * for any single-call setter. Permission-gated via
 * `useVaultPermissions` — typically only the owner (and sometimes the
 * curator) can edit; non-privileged viewers see disabled buttons.
 *
 * Three sections:
 *   - Identity       — name / symbol
 *   - Fees           — performance fee + recipient, management fee + recipient
 *   - Roles          — curator, allocators (list + add/remove), sentinels (add/remove)
 */
import { useState } from 'react';
import type { Address } from 'viem';
import { useReadContract } from 'wagmi';
import { useVaultInfo } from '../../lib/hooks/useVault';
import { useV2AdapterOverview } from '../../lib/hooks/useV2Adapters';
import { useVaultPermissions } from '../../hooks/useVaultPermissions';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { AddressDisplay } from '../ui/AddressDisplay';
import { V2SetterDrawer, type V2SetterIntent } from './params/V2SetterDrawer';
import { metaMorphoV2Abi } from '../../lib/contracts/metaMorphoV2Abi';

interface V2ParamsTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function V2ParamsTab({ chainId, vaultAddress }: V2ParamsTabProps) {
  const { data: vault, isLoading } = useVaultInfo(chainId, vaultAddress);
  const permissions = useVaultPermissions(chainId, vaultAddress);
  const [editing, setEditing] = useState<V2SetterIntent | null>(null);

  if (isLoading || !vault) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-shimmer bg-bg-hover" />
        ))}
      </div>
    );
  }

  if (vault.version !== 'v2') {
    return (
      <Card className="py-6 text-center">
        <p className="text-text-tertiary text-xs">This page is V2-only.</p>
      </Card>
    );
  }

  // V2 only exposes owner-vs-not. Most setters are owner-gated on-chain;
  // we surface "Edit" universally and let the simulation guard catch
  // unauthorized callers (the drawer's error banner shows the revert
  // reason — typically a `NotAuthorized` decoded via the PR 1 error
  // fragments).
  const canEdit = permissions.canCurate || permissions.canManage || permissions.isAdmin;
  const timelockSeconds = vault.timelock;
  const allocators: Address[] = vault.allocators ?? [];

  // PR 28 — read vault-wide maxRate (uint64 WAD/sec scaled) and the
  // per-adapter forceDeallocatePenalty. The penalty getter is per
  // adapter, so we fetch the active liquidity adapter's value as the
  // first-class display. The Edit drawer takes an explicit adapter so
  // the curator can target any adapter.
  const { data: maxRate } = useReadContract({
    address: vaultAddress,
    abi: metaMorphoV2Abi,
    functionName: 'maxRate',
    chainId,
  });

  return (
    <div className="space-y-4">
      {/* Identity */}
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <Badge variant="info">V2</Badge>
        </CardHeader>
        <Row label="Name" value={vault.name || '(unset)'}
             onEdit={() => setEditing({ kind: 'setName', current: vault.name })} canEdit={canEdit} />
        <Row label="Symbol" value={vault.symbol || '(unset)'}
             onEdit={() => setEditing({ kind: 'setSymbol', current: vault.symbol })} canEdit={canEdit} />
      </Card>

      {/* Fees */}
      <Card>
        <CardHeader>
          <CardTitle>Fees</CardTitle>
          <Badge variant="info">V2</Badge>
        </CardHeader>
        <Row
          label="Performance Fee"
          value={`${(Number(vault.fee) / 1e16).toFixed(2)}%`}
          onEdit={() => setEditing({ kind: 'setPerformanceFee', currentWad: vault.fee })}
          canEdit={canEdit}
        />
        <Row
          label="Performance Fee Recipient"
          valueNode={vault.feeRecipient ? <AddressDisplay address={vault.feeRecipient} chainId={chainId} /> : 'Not set'}
          onEdit={() => setEditing({ kind: 'setPerformanceFeeRecipient', current: vault.feeRecipient })}
          canEdit={canEdit}
        />
        <Row
          label="Management Fee"
          value={`${(Number(vault.managementFee) / 1e16).toFixed(2)}%`}
          onEdit={() => setEditing({ kind: 'setManagementFee', currentWad: vault.managementFee })}
          canEdit={canEdit}
        />
        <Row
          label="Management Fee Recipient"
          valueNode={vault.managementFeeRecipient ? <AddressDisplay address={vault.managementFeeRecipient} chainId={chainId} /> : 'Not set'}
          onEdit={() => setEditing({ kind: 'setManagementFeeRecipient', current: vault.managementFeeRecipient })}
          canEdit={canEdit}
        />
        {/* PR 28 — Max Rate (vault-wide yield cap). Owner-only typically. */}
        <Row
          label="Max Rate"
          value={maxRate !== undefined ? `${(Number(maxRate as bigint) / 1e16).toFixed(2)}%` : '—'}
          onEdit={() =>
            setEditing({
              kind: 'setMaxRate',
              currentWad: (maxRate as bigint | undefined) ?? 0n,
            })
          }
          canEdit={canEdit && maxRate !== undefined}
        />
      </Card>

      {/* PR 28 — Force Deallocate Penalty (per-adapter) */}
      <ForceDeallocatePenaltyCard
        chainId={chainId}
        vaultAddress={vaultAddress}
        canEdit={canEdit}
        onEdit={(adapter, current) => setEditing({ kind: 'setForceDeallocatePenalty', adapter, current })}
      />

      {/* Roles */}
      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
          <Badge variant="info">V2</Badge>
        </CardHeader>

        <Row
          label="Owner"
          valueNode={<AddressDisplay address={vault.owner} chainId={chainId} />}
          // Owner change isn't via setOwner — V2 uses transferOwnership +
          // acceptOwnership (two-step). Out of scope for this drawer.
          // Display only.
          hideAction
        />

        <Row
          label="Curator"
          valueNode={
            vault.curator && vault.curator !== '0x0000000000000000000000000000000000000000' ? (
              <AddressDisplay address={vault.curator} chainId={chainId} />
            ) : (
              'Not set'
            )
          }
          onEdit={() => setEditing({ kind: 'setCurator', current: vault.curator })}
          canEdit={canEdit}
        />

        {/* Allocators — list + manage */}
        <div className="p-3 border-t border-border-subtle">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-tertiary">Allocators ({allocators.length})</span>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing({ kind: 'setIsAllocator', defaultGrant: true })}
              >
                + Add / Revoke
              </Button>
            )}
          </div>
          {allocators.length === 0 ? (
            <p className="text-[10px] text-text-tertiary italic">No allocators configured.</p>
          ) : (
            <div className="space-y-1">
              {allocators.map((a) => (
                <div key={a} className="flex items-center justify-between text-xs">
                  <AddressDisplay address={a} chainId={chainId} />
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      onClick={() =>
                        setEditing({ kind: 'setIsAllocator', defaultAddress: a, defaultGrant: false })
                      }
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sentinels — V2 has no enumerable list (per-address mapping).
            Just expose add/remove. */}
        <div className="p-3 border-t border-border-subtle">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-tertiary">Sentinels</span>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing({ kind: 'setIsSentinel', defaultGrant: true })}
              >
                + Add / Revoke
              </Button>
            )}
          </div>
          <p className="text-[10px] text-text-tertiary italic">
            V2 sentinels are stored in a per-address mapping with no on-chain enumeration.
            Use the drawer to grant or revoke a specific address.
          </p>
        </div>
      </Card>

      {editing && (
        <V2SetterDrawer
          open
          onClose={() => setEditing(null)}
          intent={editing}
          vaultAddress={vaultAddress}
          chainId={chainId}
          timelockSeconds={timelockSeconds}
        />
      )}
    </div>
  );
}

/**
 * Per-adapter force-deallocate penalty card. One row per adapter on the
 * vault, with current penalty (read from `forceDeallocatePenalty(adapter)`)
 * and an Edit button that opens `V2SetterDrawer` with the adapter address
 * baked into the intent.
 */
function ForceDeallocatePenaltyCard({
  chainId,
  vaultAddress,
  canEdit,
  onEdit,
}: {
  chainId: number;
  vaultAddress: Address;
  canEdit: boolean;
  onEdit: (adapter: Address, current: bigint) => void;
}) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const { data: overview } = useV2AdapterOverview(chainId, vaultAddress, vault?.totalAssets);
  const adapters = overview?.adapters ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Force Deallocate Penalty</CardTitle>
        <Badge variant="info">V2</Badge>
      </CardHeader>
      <p className="text-[10px] text-text-tertiary px-3 pb-2">
        Per-adapter penalty applied when an allocator force-deallocates this adapter (WAD).
      </p>
      {adapters.length === 0 ? (
        <p className="text-[10px] text-text-tertiary italic p-3">
          No adapters configured. Add one from the Adapters tab.
        </p>
      ) : (
        adapters.map((a) => (
          <ForceDeallocatePenaltyRow
            key={a.address}
            chainId={chainId}
            vaultAddress={vaultAddress}
            adapter={a.address}
            adapterName={a.name ?? `Adapter ${a.address.slice(0, 10)}`}
            canEdit={canEdit}
            onEdit={onEdit}
          />
        ))
      )}
    </Card>
  );
}

function ForceDeallocatePenaltyRow({
  chainId,
  vaultAddress,
  adapter,
  adapterName,
  canEdit,
  onEdit,
}: {
  chainId: number;
  vaultAddress: Address;
  adapter: Address;
  adapterName: string;
  canEdit: boolean;
  onEdit: (adapter: Address, current: bigint) => void;
}) {
  const { data: penalty } = useReadContract({
    address: vaultAddress,
    abi: metaMorphoV2Abi,
    functionName: 'forceDeallocatePenalty',
    args: [adapter],
    chainId,
  });
  const current = (penalty as bigint | undefined) ?? 0n;
  return (
    <Row
      label={adapterName}
      value={current > 0n ? `${(Number(current) / 1e16).toFixed(2)}%` : 'Not set'}
      onEdit={() => onEdit(adapter, current)}
      canEdit={canEdit}
    />
  );
}

function Row({
  label,
  value,
  valueNode,
  onEdit,
  canEdit,
  hideAction,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  onEdit?: () => void;
  canEdit?: boolean;
  hideAction?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-3 border-t border-border-subtle text-xs first:border-t-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-text-tertiary">{label}</span>
        <div className="font-mono text-text-primary">
          {value ?? valueNode}
        </div>
      </div>
      {!hideAction && (
        <Button size="sm" variant="ghost" disabled={!canEdit} onClick={onEdit}>
          Edit
        </Button>
      )}
    </div>
  );
}
