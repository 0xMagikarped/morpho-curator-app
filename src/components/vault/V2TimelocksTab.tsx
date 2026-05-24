/**
 * V2 timelocks overview + batch edit.
 *
 * PR 29 — read-only table of per-selector `timelock(bytes4)` +
 *         `abdicated(bytes4)`.
 * PR 31 — single Edit mode that lets the curator change *every*
 *         row at once, applied in ONE multicall tx (per direction).
 *
 * On-chain primitives:
 *   - increaseTimelock(selector, newDuration) — security tightens, IMMEDIATE
 *   - decreaseTimelock(selector, newDuration) — security loosens, TIMELOCKED
 *     (goes through submit→wait→execute like every other config change)
 *
 * UX:
 *   - "Edit" button at the top toggles edit mode.
 *   - Each row's Timelock cell becomes an input. Accepts `0` / `Instant` /
 *     `30s` / `5m` / `2h` / `1d` (lib/utils/duration parser).
 *   - "Save Changes" splits the changed rows into two batches:
 *       1. Increases → single `vault.multicall([increaseTimelock(...)...])`
 *          tx. Lands immediately.
 *       2. Decreases → still need submit→wait→execute. Surfaced as a
 *          secondary action; flagged as PR-32-quality (one-tx submit
 *          multicall + one-tx execute multicall after the wait).
 *
 * Abdication (per-row, irreversible) is still per-row and deferred to a
 * follow-up — too easy to fat-finger inside a batch.
 */
import { useMemo, useState } from 'react';
import type { Address } from 'viem';
import { encodeFunctionData, toFunctionSelector } from 'viem';
import { useReadContracts, useWaitForTransactionReceipt } from 'wagmi';
import { useGuardedWriteContract } from '../../hooks/useGuardedWriteContract';
import { useVaultPermissions } from '../../hooks/useVaultPermissions';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { vaultV2RegistryAbi } from '../../lib/contracts/vaultV2RegistryAbi';
import { metaMorphoV2Abi } from '../../lib/contracts/metaMorphoV2Abi';
import {
  parseDurationSeconds,
  formatDurationDays,
} from '../../lib/utils/duration';

interface V2TimelocksTabProps {
  chainId: number;
  vaultAddress: Address;
}

interface SelectorRow {
  group: string;
  label: string;
  signature: string;
}

const SELECTOR_ROWS: SelectorRow[] = [
  { group: 'Registry', label: 'Set Adapter Registry', signature: 'setAdapterRegistry(address)' },
  { group: 'Registry', label: 'Abdicate', signature: 'abdicate(bytes4)' },
  { group: 'Adapters', label: 'Add Adapter', signature: 'addAdapter(address)' },
  { group: 'Adapters', label: 'Remove Adapter', signature: 'removeAdapter(address)' },
  { group: 'Caps', label: 'Increase Absolute Cap', signature: 'increaseAbsoluteCap(bytes,uint256)' },
  { group: 'Caps', label: 'Increase Relative Cap', signature: 'increaseRelativeCap(bytes,uint256)' },
  { group: 'Caps', label: 'Decrease Absolute Cap', signature: 'decreaseAbsoluteCap(bytes,uint256)' },
  { group: 'Caps', label: 'Decrease Relative Cap', signature: 'decreaseRelativeCap(bytes,uint256)' },
  { group: 'Roles', label: 'Set Curator', signature: 'setCurator(address)' },
  { group: 'Roles', label: 'Set Is Allocator', signature: 'setIsAllocator(address,bool)' },
  { group: 'Roles', label: 'Set Is Sentinel', signature: 'setIsSentinel(address,bool)' },
  { group: 'Fees', label: 'Set Performance Fee', signature: 'setPerformanceFee(uint256)' },
  { group: 'Fees', label: 'Set Performance Fee Recipient', signature: 'setPerformanceFeeRecipient(address)' },
  { group: 'Fees', label: 'Set Management Fee', signature: 'setManagementFee(uint256)' },
  { group: 'Fees', label: 'Set Management Fee Recipient', signature: 'setManagementFeeRecipient(address)' },
  { group: 'Identity', label: 'Set Name', signature: 'setName(string)' },
  { group: 'Identity', label: 'Set Symbol', signature: 'setSymbol(string)' },
  { group: 'Risk', label: 'Set Max Rate', signature: 'setMaxRate(uint256)' },
  { group: 'Risk', label: 'Set Force Deallocate Penalty', signature: 'setForceDeallocatePenalty(address,uint256)' },
  { group: 'Liquidity', label: 'Set Liquidity Adapter And Data', signature: 'setLiquidityAdapterAndData(address,bytes)' },
];

interface RowState {
  row: SelectorRow;
  selector: `0x${string}`;
  timelock: bigint | undefined;
  abdicated: boolean | undefined;
  /** User input in edit mode. */
  draft: string;
  /** Parsed draft → seconds. `null` while invalid. */
  draftSecs: bigint | null;
}

export function V2TimelocksTab({ chainId, vaultAddress }: V2TimelocksTabProps) {
  const permissions = useVaultPermissions(chainId, vaultAddress);
  const canEdit = permissions.canCurate || permissions.canManage || permissions.isAdmin;

  // Pre-compute every selector once.
  const selectors = useMemo(
    () => SELECTOR_ROWS.map((r) => ({ row: r, selector: toFunctionSelector(r.signature) })),
    [],
  );

  // Read both `timelock(selector)` and `abdicated(selector)` for every row
  // in parallel — single multicall round-trip via wagmi.
  const contracts = useMemo(
    () =>
      selectors.flatMap(({ selector }) => [
        { address: vaultAddress, abi: vaultV2RegistryAbi, functionName: 'timelock', args: [selector], chainId } as const,
        { address: vaultAddress, abi: vaultV2RegistryAbi, functionName: 'abdicated', args: [selector], chainId } as const,
      ]),
    [selectors, vaultAddress, chainId],
  );
  const { data: reads, isLoading, error, refetch } = useReadContracts({
    contracts,
    query: { staleTime: 5 * 60_000 },
  });

  // Edit state — `drafts` keyed by selector. Reset when leaving edit mode.
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Build the per-row hydrated state. Default draft text = current value.
  const rows: RowState[] = useMemo(
    () =>
      selectors.map(({ row, selector }, i) => {
        const timelock = reads?.[i * 2]?.result as bigint | undefined;
        const abdicated = reads?.[i * 2 + 1]?.result as boolean | undefined;
        const draft =
          drafts[selector] ??
          (timelock !== undefined ? formatDurationDays(timelock) : '');
        return {
          row,
          selector,
          timelock,
          abdicated,
          draft,
          draftSecs: parseDurationSeconds(draft),
        };
      }),
    [selectors, reads, drafts],
  );

  // Compute pending changes: rows where draft parsed AND differs from current.
  const changes = useMemo(() => {
    const out: { selector: `0x${string}`; current: bigint; next: bigint; label: string }[] = [];
    for (const r of rows) {
      if (r.timelock === undefined || r.draftSecs === null) continue;
      if (r.abdicated) continue; // can't change an abdicated selector
      if (r.draftSecs !== r.timelock) {
        out.push({ selector: r.selector, current: r.timelock, next: r.draftSecs, label: r.row.label });
      }
    }
    return out;
  }, [rows]);

  const increases = changes.filter((c) => c.next > c.current);
  const decreases = changes.filter((c) => c.next < c.current);

  // ------- batched submit (one tx, immediate side) -----------------------
  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    simulateError,
  } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const saveIncreases = () => {
    if (increases.length === 0) return;
    const calldatas = increases.map((c) =>
      encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'increaseTimelock',
        args: [c.selector, c.next],
      }),
    );
    if (calldatas.length === 1) {
      writeContract({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: 'increaseTimelock',
        args: [increases[0].selector, increases[0].next],
        chainId,
      });
    } else {
      writeContract({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: 'multicall',
        args: [calldatas],
        chainId,
      });
    }
  };

  // After a confirmed tx, drop edit mode + clear drafts + force a refetch.
  if (isSuccess && (editing || Object.keys(drafts).length > 0)) {
    setEditing(false);
    setDrafts({});
    void refetch();
  }

  if (error) {
    return (
      <Card className="py-6 text-center">
        <p className="text-danger text-xs">Failed to load timelocks.</p>
        <p className="text-text-tertiary text-[10px] mt-1">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>V2 Timelocks</CardTitle>
          <Badge variant="info">V2</Badge>
          <div className="ml-auto flex items-center gap-2">
            {editing ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDrafts({}); }}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={increases.length === 0 || isPending || isConfirming}
                  loading={isPending || isConfirming}
                  onClick={saveIncreases}
                >
                  {increases.length === 0
                    ? 'No increases to apply'
                    : increases.length === 1
                      ? 'Apply 1 increase'
                      : `Apply ${increases.length} increases (1 tx)`}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setEditing(true)} disabled={!canEdit}>
                Edit
              </Button>
            )}
          </div>
        </CardHeader>

        <p className="text-[10px] text-text-tertiary mb-3">
          Per-selector timelock duration + abdication state. Increases apply immediately via{' '}
          <span className="font-mono">vault.multicall([increaseTimelock(…), …])</span> (one tx,
          one signature). Decreases are themselves timelocked — handled by a follow-up
          submit→wait→execute flow.
        </p>

        {/* Error surfacing from the write guard */}
        {(simulateError || writeError) && (
          <div role="alert" className="bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger mb-3">
            {simulateError?.message ??
              (writeError instanceof Error ? writeError.message : 'Transaction failed.')}
          </div>
        )}

        {/* Pending-changes summary in edit mode */}
        {editing && (changes.length > 0) && (
          <div className="bg-bg-hover border border-border-subtle px-3 py-2 text-[10px] text-text-secondary mb-3">
            <strong>{changes.length} pending change{changes.length !== 1 ? 's' : ''}</strong>
            {increases.length > 0 && ` · ${increases.length} increase${increases.length !== 1 ? 's' : ''} (immediate)`}
            {decreases.length > 0 && ` · ${decreases.length} decrease${decreases.length !== 1 ? 's' : ''} (timelocked, requires submit→wait→execute — coming in PR 32)`}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
                <th className="text-left py-2 px-2">Group / Action</th>
                <th className="text-left py-2 px-2">Selector</th>
                <th className="text-left py-2 px-2">Signature</th>
                <th className="text-right py-2 px-2 w-40">Timelock</th>
                <th className="text-right py-2 px-2">Abdicated</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(
                rows.reduce<Record<string, RowState[]>>((acc, r) => {
                  if (!acc[r.row.group]) acc[r.row.group] = [];
                  acc[r.row.group].push(r);
                  return acc;
                }, {}),
              ).map(([group, gRows]) =>
                gRows.map((r, idx) => {
                  const changed = r.timelock !== undefined && r.draftSecs !== null && r.draftSecs !== r.timelock;
                  const direction = !changed
                    ? null
                    : (r.draftSecs ?? 0n) > (r.timelock ?? 0n)
                      ? 'increase'
                      : 'decrease';
                  return (
                    <tr
                      key={`${group}-${r.selector}`}
                      className={
                        'border-b border-border-subtle/50 hover:bg-bg-hover/30 ' +
                        (changed ? 'bg-accent-primary/5' : '')
                      }
                    >
                      <td className="py-2 px-2 align-top">
                        {idx === 0 && <Badge variant="info" className="mb-1">{group}</Badge>}
                        <p className="text-text-primary">{r.row.label}</p>
                      </td>
                      <td className="py-2 px-2 align-top font-mono text-[10px] text-text-tertiary">
                        {r.selector}
                      </td>
                      <td className="py-2 px-2 align-top font-mono text-[10px] text-text-tertiary">
                        {r.row.signature}
                      </td>
                      <td className="text-right py-2 px-2 align-top">
                        {editing && !r.abdicated ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <input
                              type="text"
                              value={r.draft}
                              onChange={(e) =>
                                setDrafts((d) => ({ ...d, [r.selector]: e.target.value }))
                              }
                              placeholder="0 / 30s / 5m / 2h / 1d"
                              className="w-32 bg-bg-elevated border border-border-default px-2 py-1 text-xs text-text-primary placeholder-text-tertiary font-mono focus:border-border-focus focus:outline-none text-right"
                            />
                            {r.draftSecs === null && (
                              <span className="text-[10px] text-warning">Bad format</span>
                            )}
                            {direction === 'increase' && (
                              <span className="text-[10px] text-accent-primary">↑ immediate</span>
                            )}
                            {direction === 'decrease' && (
                              <span className="text-[10px] text-warning">↓ timelocked</span>
                            )}
                          </div>
                        ) : (
                          <span className="font-mono text-text-primary">
                            {isLoading
                              ? '…'
                              : r.timelock !== undefined
                                ? formatDurationDays(r.timelock)
                                : '—'}
                          </span>
                        )}
                      </td>
                      <td className="text-right py-2 px-2 align-top">
                        {isLoading ? (
                          <span className="text-text-tertiary">…</span>
                        ) : r.abdicated === true ? (
                          <Badge variant="danger">Abdicated</Badge>
                        ) : (
                          <span className="text-text-tertiary text-[10px]">no</span>
                        )}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-text-tertiary mt-3 italic">
          {editing ? (
            <>Increases (↑) batch into one immediate tx. Decreases (↓) need a separate submit→wait→execute flow — coming in PR 32. Abdication is per-row and irreversible — also deferred.</>
          ) : (
            <>Read-only view. Click <span className="font-mono">Edit</span> to change durations in bulk — one tx applies all increases at once.</>
          )}
        </p>
      </Card>
    </div>
  );
}
