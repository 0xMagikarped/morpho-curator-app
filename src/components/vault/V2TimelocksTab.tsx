/**
 * PR 29 — V2 timelocks overview.
 *
 * V2 vaults have per-selector timelock durations: every config-changing
 * function is gated by `timelock(bytes4 selector)` (in seconds, may be 0)
 * + an `abdicated(bytes4) → bool` flag that, when true, permanently
 * disables the selector. This page surfaces both for every selector we
 * route through the UI.
 *
 * Read-only for the MVP. A future PR can add `increaseTimelock(selector,
 * newTimelock)` + `abdicate(selector)` edit affordances; both are
 * owner-only on-chain.
 */
import type { Address } from 'viem';
import { toFunctionSelector } from 'viem';
import { useReadContracts } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { vaultV2RegistryAbi } from '../../lib/contracts/vaultV2RegistryAbi';

interface V2TimelocksTabProps {
  chainId: number;
  vaultAddress: Address;
}

interface SelectorRow {
  group: string;
  label: string;
  signature: string;
}

/**
 * Canonical list of V2 selectors exposed through the curator UI. Grouped
 * for display. Signatures must match the on-chain shape (PR 13/15/17/29
 * SDK alignment work).
 */
const SELECTOR_ROWS: SelectorRow[] = [
  // Registry / adapter management
  { group: 'Registry', label: 'Set Adapter Registry', signature: 'setAdapterRegistry(address)' },
  { group: 'Registry', label: 'Abdicate', signature: 'abdicate(bytes4)' },
  { group: 'Adapters', label: 'Add Adapter', signature: 'addAdapter(address)' },
  { group: 'Adapters', label: 'Remove Adapter', signature: 'removeAdapter(address)' },

  // Cap mutators
  { group: 'Caps', label: 'Increase Absolute Cap', signature: 'increaseAbsoluteCap(bytes,uint256)' },
  { group: 'Caps', label: 'Increase Relative Cap', signature: 'increaseRelativeCap(bytes,uint256)' },
  { group: 'Caps', label: 'Decrease Absolute Cap', signature: 'decreaseAbsoluteCap(bytes,uint256)' },
  { group: 'Caps', label: 'Decrease Relative Cap', signature: 'decreaseRelativeCap(bytes,uint256)' },

  // Roles
  { group: 'Roles', label: 'Set Curator', signature: 'setCurator(address)' },
  { group: 'Roles', label: 'Set Is Allocator', signature: 'setIsAllocator(address,bool)' },
  { group: 'Roles', label: 'Set Is Sentinel', signature: 'setIsSentinel(address,bool)' },

  // Fees
  { group: 'Fees', label: 'Set Performance Fee', signature: 'setPerformanceFee(uint256)' },
  { group: 'Fees', label: 'Set Performance Fee Recipient', signature: 'setPerformanceFeeRecipient(address)' },
  { group: 'Fees', label: 'Set Management Fee', signature: 'setManagementFee(uint256)' },
  { group: 'Fees', label: 'Set Management Fee Recipient', signature: 'setManagementFeeRecipient(address)' },

  // Identity + risk knobs
  { group: 'Identity', label: 'Set Name', signature: 'setName(string)' },
  { group: 'Identity', label: 'Set Symbol', signature: 'setSymbol(string)' },
  { group: 'Risk', label: 'Set Max Rate', signature: 'setMaxRate(uint256)' },
  { group: 'Risk', label: 'Set Force Deallocate Penalty', signature: 'setForceDeallocatePenalty(address,uint256)' },

  // Liquidity adapter
  { group: 'Liquidity', label: 'Set Liquidity Adapter And Data', signature: 'setLiquidityAdapterAndData(address,bytes)' },
];

function selectorOf(sig: string): `0x${string}` {
  // `toFunctionSelector` accepts the full signature; output is the 4-byte selector.
  return toFunctionSelector(sig);
}

function fmtDuration(secs: bigint): string {
  if (secs === 0n) return 'Instant';
  const s = Number(secs);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

export function V2TimelocksTab({ chainId, vaultAddress }: V2TimelocksTabProps) {
  const selectors = SELECTOR_ROWS.map((r) => ({ row: r, selector: selectorOf(r.signature) }));

  // Read both timelock(selector) and abdicated(selector) for every selector
  // in parallel via wagmi's useReadContracts (auto-batched through the
  // multicall transport at the viem layer).
  const contracts = selectors.flatMap(({ selector }) => [
    {
      address: vaultAddress,
      abi: vaultV2RegistryAbi,
      functionName: 'timelock',
      args: [selector],
      chainId,
    } as const,
    {
      address: vaultAddress,
      abi: vaultV2RegistryAbi,
      functionName: 'abdicated',
      args: [selector],
      chainId,
    } as const,
  ]);
  const { data: reads, isLoading, error } = useReadContracts({
    contracts,
    query: { staleTime: 5 * 60_000 },
  });

  // Group rows by `row.group` for table sections.
  const grouped = selectors.reduce<Record<string, Array<{ row: SelectorRow; selector: `0x${string}`; timelock: bigint | undefined; abdicated: boolean | undefined }>>>((acc, { row, selector }, i) => {
    const tl = reads?.[i * 2]?.result as bigint | undefined;
    const ab = reads?.[i * 2 + 1]?.result as boolean | undefined;
    if (!acc[row.group]) acc[row.group] = [];
    acc[row.group].push({ row, selector, timelock: tl, abdicated: ab });
    return acc;
  }, {});

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
        </CardHeader>
        <p className="text-[10px] text-text-tertiary mb-3">
          Per-selector timelock duration + abdication state. Every config change on a V2 vault
          is gated by{' '}
          <span className="font-mono">timelock(bytes4)</span> (the delay between
          <span className="font-mono"> submit </span>and the target call) and
          <span className="font-mono"> abdicated(bytes4) </span>(when true, the selector is
          permanently disabled). Increases are owner-gated on-chain.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
                <th className="text-left py-2 px-2">Group / Action</th>
                <th className="text-left py-2 px-2">Selector</th>
                <th className="text-left py-2 px-2">Signature</th>
                <th className="text-right py-2 px-2">Timelock</th>
                <th className="text-right py-2 px-2">Abdicated</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(grouped).map(([group, rows]) =>
                rows.map((r, idx) => (
                  <tr
                    key={`${group}-${r.selector}`}
                    className="border-b border-border-subtle/50 hover:bg-bg-hover/30"
                  >
                    <td className="py-2 px-2 align-top">
                      {idx === 0 && (
                        <Badge variant="info" className="mb-1">{group}</Badge>
                      )}
                      <p className="text-text-primary">{r.row.label}</p>
                    </td>
                    <td className="py-2 px-2 align-top font-mono text-[10px] text-text-tertiary">
                      {r.selector}
                    </td>
                    <td className="py-2 px-2 align-top font-mono text-[10px] text-text-tertiary">
                      {r.row.signature}
                    </td>
                    <td className="text-right py-2 px-2 align-top font-mono text-text-primary">
                      {isLoading
                        ? '…'
                        : r.timelock !== undefined
                          ? fmtDuration(r.timelock)
                          : '—'}
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
                )),
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-text-tertiary mt-3 italic">
          Read-only for now. A future PR will add owner-gated{' '}
          <span className="font-mono">increaseTimelock(selector, newTimelock)</span> +{' '}
          <span className="font-mono">abdicate(selector)</span> edit affordances.
        </p>
      </Card>
    </div>
  );
}
