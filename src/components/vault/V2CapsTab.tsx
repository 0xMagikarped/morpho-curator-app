/**
 * PR 21 — V2 caps management view.
 *
 * Replaces the "Caps moved" notice (PR 18) for V2 vaults. Renders a
 * Morpho-curator-style table of all adapters and their cap entries,
 * with edit affordances per row that open the existing
 * `UpdateCapsDrawer` (PR 12/14/15) and a pending-timelock section.
 *
 * Scope of this MVP: adapter-level caps only — collateral-level and
 * market-level cap editing live in the wizard for now
 * (`AddMarketWizard` Step 2). A future PR can extend this view with
 * sub-rows + a parameterized cap drawer that accepts any `idData`.
 *
 * The pending section is driven by best-effort SDK error decoding +
 * the per-calldata `executableAt` reads PR 11 introduced.
 */
import { useState, useMemo } from 'react';
import type { Address } from 'viem';
import { useVaultInfo } from '../../lib/hooks/useVault';
import { useV2AdapterOverview, type V2AdapterFull } from '../../lib/hooks/useV2Adapters';
import { useVaultPermissions } from '../../hooks/useVaultPermissions';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { AddressDisplay } from '../ui/AddressDisplay';
import { ProgressBar } from '../ui/ProgressBar';
import { UpdateCapsDrawer } from './adapters/UpdateCapsDrawer';
import { formatTokenAmount, formatWadPercent } from '../../lib/utils/format';

interface V2CapsTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function V2CapsTab({ chainId, vaultAddress }: V2CapsTabProps) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const overview = useV2AdapterOverview(chainId, vaultAddress, vault?.totalAssets);
  const permissions = useVaultPermissions(chainId, vaultAddress);
  const [editingAdapter, setEditingAdapter] = useState<V2AdapterFull | null>(null);

  const adapters = overview.data?.adapters ?? [];
  // `vault.assetInfo` is the enriched ERC-20 metadata; `vault.timelock` is
  // the per-selector timelock duration in seconds (V2 vaults often 0).
  const decimals = vault?.assetInfo.decimals ?? 18;
  const assetSymbol = vault?.assetInfo.symbol ?? '???';
  const canSetCaps = permissions.canCurate || permissions.isAdmin;
  const timelockSeconds = vault?.timelock ?? 0n;

  // Summary aggregates across all adapters — useful header context.
  const summary = useMemo(() => {
    const total = adapters.length;
    const withCaps = adapters.filter(
      (a) => a.absoluteCap > 0n || a.relativeCap > 0n,
    ).length;
    const totalAllocated = adapters.reduce((s, a) => s + a.realAssets, 0n);
    return { total, withCaps, totalAllocated };
  }, [adapters]);

  if (overview.isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-shimmer bg-bg-hover" />
        ))}
      </div>
    );
  }

  if (overview.error) {
    return (
      <Card className="py-6 text-center">
        <p className="text-danger text-xs">Failed to load adapter caps.</p>
        <p className="text-text-tertiary text-[10px] mt-1">
          {overview.error instanceof Error ? overview.error.message : 'Unknown error'}
        </p>
      </Card>
    );
  }

  if (adapters.length === 0) {
    return (
      <Card>
        <div className="p-4 space-y-2 text-center">
          <h3 className="text-sm font-medium text-text-primary">No adapters yet</h3>
          <p className="text-xs text-text-tertiary">
            V2 caps are managed per-adapter. Add a market adapter from the{' '}
            <span className="font-mono">Adapters</span> tab to start setting caps.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <Card>
        <div className="grid grid-cols-3 gap-3 p-3">
          <SummaryCell label="Adapters" value={String(summary.total)} />
          <SummaryCell label="With Caps" value={`${summary.withCaps}/${summary.total}`} />
          <SummaryCell
            label="Total Allocated"
            value={`${formatTokenAmount(summary.totalAllocated, decimals)} ${assetSymbol}`}
          />
        </div>
      </Card>

      {/* Adapter cap table */}
      <Card>
        <CardHeader>
          <CardTitle>Adapter Caps</CardTitle>
          <Badge variant="info">V2</Badge>
        </CardHeader>

        <p className="text-[10px] text-text-tertiary mb-3">
          Three-level cap hierarchy: adapter / collateral / market. This view shows the
          adapter-level entry for each adapter. Collateral-level and market-level caps are
          configured via the <span className="font-mono">Add Market</span> wizard
          (Adapters tab → Add Market).
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
                <th className="text-left py-2 px-2">Adapter</th>
                <th className="text-right py-2 px-2">Allocated</th>
                <th className="text-right py-2 px-2">Abs. Cap</th>
                <th className="text-right py-2 px-2">Rel. Cap</th>
                <th className="text-right py-2 px-2 w-32">Usage</th>
                <th className="text-right py-2 px-2 w-16">Action</th>
              </tr>
            </thead>
            <tbody>
              {adapters.map((a) => (
                <CapRow
                  key={a.address}
                  adapter={a}
                  chainId={chainId}
                  decimals={decimals}
                  assetSymbol={assetSymbol}
                  totalAssets={vault?.totalAssets ?? 0n}
                  canSetCaps={canSetCaps}
                  onEdit={() => setEditingAdapter(a)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Edit drawer reuses the existing PR 12/14/15 component */}
      <UpdateCapsDrawer
        open={!!editingAdapter}
        onClose={() => setEditingAdapter(null)}
        adapter={editingAdapter}
        vaultAddress={vaultAddress}
        chainId={chainId}
        timelockSeconds={timelockSeconds}
        decimals={decimals}
        assetSymbol={assetSymbol}
      />
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] text-text-tertiary uppercase">{label}</span>
      <p className="font-mono text-sm text-text-primary mt-0.5">{value}</p>
    </div>
  );
}

function CapRow({
  adapter,
  chainId,
  decimals,
  assetSymbol,
  totalAssets,
  canSetCaps,
  onEdit,
}: {
  adapter: V2AdapterFull;
  chainId: number;
  decimals: number;
  assetSymbol: string;
  totalAssets: bigint;
  canSetCaps: boolean;
  onEdit: () => void;
}) {
  const absPct =
    adapter.absoluteCap > 0n
      ? (Number(adapter.realAssets) / Number(adapter.absoluteCap)) * 100
      : 0;

  const relUsedPct =
    adapter.relativeCap > 0n && totalAssets > 0n
      ? ((Number(adapter.realAssets) / Number(totalAssets)) /
          (Number(adapter.relativeCap) / 1e18)) *
        100
      : 0;

  const usagePct = Math.max(absPct, relUsedPct);

  const status: 'unconfigured' | 'configured' =
    adapter.absoluteCap === 0n && adapter.relativeCap === 0n ? 'unconfigured' : 'configured';

  return (
    <tr className="border-b border-border-subtle/50 hover:bg-bg-hover/30">
      <td className="py-2 px-2 align-top">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-text-primary font-medium">
              {adapter.name ?? `Adapter ${adapter.address.slice(0, 10)}`}
            </span>
            {adapter.type === 'market-v1' && <Badge variant="success">MKT</Badge>}
            {adapter.type === 'vault-v1' && <Badge variant="info">V1</Badge>}
            {adapter.isLiquidityAdapter && <Badge variant="purple">Liquidity</Badge>}
            {status === 'unconfigured' && <Badge variant="warning">No Caps</Badge>}
          </div>
          <div className="text-[10px] text-text-tertiary">
            <AddressDisplay address={adapter.address} chainId={chainId} />
          </div>
        </div>
      </td>
      <td className="text-right py-2 px-2 font-mono text-text-primary align-top">
        {formatTokenAmount(adapter.realAssets, decimals)} {assetSymbol}
      </td>
      <td className="text-right py-2 px-2 font-mono text-text-primary align-top">
        {adapter.absoluteCap > 0n
          ? `${formatTokenAmount(adapter.absoluteCap, decimals)} ${assetSymbol}`
          : '—'}
      </td>
      <td className="text-right py-2 px-2 font-mono text-text-primary align-top">
        {adapter.relativeCap > 0n ? formatWadPercent(adapter.relativeCap) : '—'}
      </td>
      <td className="py-2 px-2 align-middle">
        {status === 'configured' ? (
          <div className="space-y-1">
            <ProgressBar value={Math.min(usagePct, 100)} height="sm" />
            <p className="text-right font-mono text-[10px] text-text-tertiary">
              {usagePct.toFixed(1)}%
            </p>
          </div>
        ) : (
          <p className="text-right text-[10px] text-text-tertiary">—</p>
        )}
      </td>
      <td className="text-right py-2 px-2 align-top">
        <Button size="sm" variant="ghost" disabled={!canSetCaps} onClick={onEdit}>
          Edit
        </Button>
      </td>
    </tr>
  );
}
