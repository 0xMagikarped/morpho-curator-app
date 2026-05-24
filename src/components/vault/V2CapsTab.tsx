/**
 * V2 caps management view (Morpho-curator-style three-table layout).
 *
 * PR 21 — first cut: adapter-level table.
 * PR 22 — added nested collateral + market sub-rows under each adapter.
 *         Required the adapter to have allocations to populate.
 * PR 23 — rewritten to match Morpho's curator UI shape: three SEPARATE
 *         tables (Adapter Caps / Collateral Token Caps / Market Caps)
 *         populated by scanning `Increase*Cap` events on the vault — so
 *         entries show up even before any allocation lands. Caps set
 *         from the AddMarketWizard, from direct multicalls, or from any
 *         other path are visible here.
 *
 * Edit affordances per row open the shared `CapEditDrawer` (PR 22) with
 * the matching `idData`.
 */
import { useState } from 'react';
import type { Address } from 'viem';
import { useVaultInfo } from '../../lib/hooks/useVault';
import { useV2AdapterOverview, type V2AdapterFull } from '../../lib/hooks/useV2Adapters';
import {
  useV2VaultCapEntries,
  type AdapterCapEntry,
  type CollateralCapEntry,
  type MarketCapEntry,
} from '../../hooks/useV2VaultCapEntries';
import { useVaultPermissions } from '../../hooks/useVaultPermissions';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { AddressDisplay } from '../ui/AddressDisplay';
import { ProgressBar } from '../ui/ProgressBar';
import { CapEditDrawer } from './adapters/CapEditDrawer';
import { AddCollateralCapDrawer } from './caps/AddCollateralCapDrawer';
import { AddMarketCapDrawer } from './caps/AddMarketCapDrawer';
import { adapterIdData } from '../../lib/v2/adapterCapUtils';
import { formatTokenAmount, formatWadPercent, formatCapDisplay } from '../../lib/utils/format';

interface V2CapsTabProps {
  chainId: number;
  vaultAddress: Address;
}

type EditingCap =
  | { kind: 'adapter-overview'; adapter: V2AdapterFull }
  | { kind: 'adapter-entry'; entry: AdapterCapEntry }
  | { kind: 'collateral'; entry: CollateralCapEntry }
  | { kind: 'market'; entry: MarketCapEntry };

export function V2CapsTab({ chainId, vaultAddress }: V2CapsTabProps) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const overview = useV2AdapterOverview(chainId, vaultAddress, vault?.totalAssets);
  const entries = useV2VaultCapEntries(chainId, vaultAddress);
  const permissions = useVaultPermissions(chainId, vaultAddress);
  const [editing, setEditing] = useState<EditingCap | null>(null);
  const [adding, setAdding] = useState<'collateral' | 'market' | null>(null);

  const adapters = overview.data?.adapters ?? [];
  const decimals = vault?.assetInfo.decimals ?? 18;
  const assetSymbol = vault?.assetInfo.symbol ?? '???';
  const canSetCaps = permissions.canCurate || permissions.isAdmin;
  const timelockSeconds = vault?.timelock ?? 0n;
  const totalAssets = vault?.totalAssets ?? 0n;

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
        <p className="text-danger text-xs">Failed to load caps.</p>
        <p className="text-text-tertiary text-[10px] mt-1">
          {overview.error instanceof Error ? overview.error.message : 'Unknown error'}
        </p>
      </Card>
    );
  }

  // Build the adapter-level table from BOTH sources:
  //   1. `useV2AdapterOverview` → every currently-enabled adapter on the
  //      vault, even if its cap is 0n. (Source of truth for "what adapters
  //      exist".)
  //   2. `useV2VaultCapEntries` → adapter-level events from the cap-map.
  //      Captures cap data even for adapters that were later removed.
  // Merge by adapter address.
  const adapterRowsByAddr = new Map<string, AdapterRow>();
  for (const a of adapters) {
    adapterRowsByAddr.set(a.address.toLowerCase(), {
      key: a.address.toLowerCase(),
      adapter: a,
      entry: null,
      absoluteCap: a.absoluteCap,
      relativeCap: a.relativeCap,
      allocation: a.realAssets,
    });
  }
  for (const e of entries.data?.adapterCaps ?? []) {
    const key = e.adapter.toLowerCase();
    const existing = adapterRowsByAddr.get(key);
    if (existing) {
      // Trust event-side allocation if non-zero, fall back to overview.
      existing.entry = e;
      existing.absoluteCap = e.absoluteCap || existing.absoluteCap;
      existing.relativeCap = e.relativeCap || existing.relativeCap;
      existing.allocation = e.allocation || existing.allocation;
    } else {
      adapterRowsByAddr.set(key, {
        key,
        adapter: null,
        entry: e,
        absoluteCap: e.absoluteCap,
        relativeCap: e.relativeCap,
        allocation: e.allocation,
      });
    }
  }
  const adapterRows = Array.from(adapterRowsByAddr.values());

  const collateralEntries = entries.data?.collateralCaps ?? [];
  const marketEntries = entries.data?.marketCaps ?? [];

  // Resolve the open-drawer props from `editing` state.
  const drawerProps = editing ? resolveDrawerProps(editing) : null;

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <Card>
        <div className="grid grid-cols-4 gap-3 p-3">
          <SummaryCell label="Adapters" value={String(adapterRows.length)} />
          <SummaryCell label="Collaterals w/ Caps" value={String(collateralEntries.length)} />
          <SummaryCell label="Markets w/ Caps" value={String(marketEntries.length)} />
          <SummaryCell
            label="Total Allocated"
            value={`${formatTokenAmount(
              adapters.reduce((s, a) => s + a.realAssets, 0n),
              decimals,
            )} ${assetSymbol}`}
          />
        </div>
      </Card>

      {/* Adapter Caps */}
      <Card>
        <CardHeader>
          <CardTitle>Adapter Caps</CardTitle>
          <Badge variant="info">V2</Badge>
        </CardHeader>
        <p className="text-[10px] text-text-tertiary mb-3">
          Limit the amount of assets that can be allocated to positions using specific
          adapters.
        </p>
        <CapTable
          rows={adapterRows.map((r) => ({
            key: r.key,
            target: (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-text-primary font-medium truncate">
                  {r.adapter?.name ?? `Adapter ${r.adapter?.address.slice(0, 10) ?? r.key.slice(0, 10)}`}
                </span>
                {r.adapter?.type === 'market-v1' && <Badge variant="success">MKT</Badge>}
                {r.adapter?.type === 'vault-v1' && <Badge variant="info">V1</Badge>}
                {r.adapter?.isLiquidityAdapter && <Badge variant="purple">Liq</Badge>}
                {!r.adapter && <Badge variant="warning">Removed</Badge>}
              </div>
            ),
            subTarget: (
              <AddressDisplay
                address={(r.adapter?.address ?? r.entry?.adapter ?? '0x0') as Address}
                chainId={chainId}
              />
            ),
            allocation: r.allocation,
            absoluteCap: r.absoluteCap,
            relativeCap: r.relativeCap,
            totalAssets,
            decimals,
            assetSymbol,
            canEdit: canSetCaps && !!r.adapter,
            onEdit: () => {
              if (r.adapter) setEditing({ kind: 'adapter-overview', adapter: r.adapter });
              else if (r.entry) setEditing({ kind: 'adapter-entry', entry: r.entry });
            },
          }))}
          isLoading={entries.isLoading}
          emptyHint="No adapters."
        />
      </Card>

      {/* Collateral Token Caps */}
      <Card>
        <CardHeader>
          <CardTitle>Collateral Token Caps</CardTitle>
          <Badge variant="info">V2</Badge>
          {/* PR 25 — quick-add a cap entry without going through the full
              AddMarket wizard. Curator-gated. */}
          {canSetCaps && (
            <Button size="sm" variant="secondary" onClick={() => setAdding('collateral')} className="ml-auto">
              + Add Collateral
            </Button>
          )}
        </CardHeader>
        <p className="text-[10px] text-text-tertiary mb-3">
          Limit the amount of assets that can be allocated to positions using specific
          collateral tokens.
        </p>
        <CapTable
          rows={collateralEntries.map((e) => ({
            key: e.id.toLowerCase(),
            target: <span className="text-text-primary">{e.collateralToken.symbol}</span>,
            subTarget: (
              <AddressDisplay address={e.collateralToken.address} chainId={chainId} />
            ),
            allocation: e.allocation,
            absoluteCap: e.absoluteCap,
            relativeCap: e.relativeCap,
            totalAssets,
            decimals,
            assetSymbol,
            canEdit: canSetCaps,
            onEdit: () => setEditing({ kind: 'collateral', entry: e }),
          }))}
          isLoading={entries.isLoading}
          emptyHint={
            entries.error
              ? `Could not load events: ${
                  entries.error instanceof Error ? entries.error.message : 'unknown error'
                }`
              : 'No collateral-level caps set on this vault yet. Use the Add Market wizard to register a market with caps.'
          }
        />
      </Card>

      {/* Market Caps */}
      <Card>
        <CardHeader>
          <CardTitle>Market Caps</CardTitle>
          <Badge variant="info">V2</Badge>
          {canSetCaps && (
            <Button size="sm" variant="secondary" onClick={() => setAdding('market')} className="ml-auto">
              + Add Market
            </Button>
          )}
        </CardHeader>
        <p className="text-[10px] text-text-tertiary mb-3">
          Limit the amount of assets that can be allocated to specific Morpho Blue markets.
        </p>
        <CapTable
          rows={marketEntries.map((e) => {
            const lltvPct = (Number(e.params.lltv) / 1e18) * 100;
            return {
              key: e.id.toLowerCase(),
              target: (
                <span className="text-text-primary">
                  {e.collateralToken?.symbol ?? '???'} / {assetSymbol}{' '}
                  <span className="text-text-tertiary">@ {lltvPct.toFixed(1)}%</span>
                </span>
              ),
              subTarget: (
                <span className="font-mono text-[10px] text-text-tertiary">
                  {e.id.slice(0, 10)}…{e.id.slice(-4)}
                </span>
              ),
              allocation: e.allocation,
              absoluteCap: e.absoluteCap,
              relativeCap: e.relativeCap,
              totalAssets,
              decimals,
              assetSymbol,
              canEdit: canSetCaps,
              onEdit: () => setEditing({ kind: 'market', entry: e }),
            };
          })}
          isLoading={entries.isLoading}
          emptyHint={
            entries.error
              ? `Could not load events: ${
                  entries.error instanceof Error ? entries.error.message : 'unknown error'
                }`
              : 'No market-level caps set on this vault yet. Use the Add Market wizard.'
          }
        />
      </Card>

      {drawerProps && (
        <CapEditDrawer
          open
          onClose={() => setEditing(null)}
          label={drawerProps.label}
          idData={drawerProps.idData}
          currentAbs={drawerProps.currentAbs}
          currentRel={drawerProps.currentRel}
          vaultAddress={vaultAddress}
          chainId={chainId}
          timelockSeconds={timelockSeconds}
          decimals={decimals}
          assetSymbol={assetSymbol}
        />
      )}

      {/* PR 25 — quick-add drawers for collateral + market levels */}
      {adding === 'collateral' && (
        <AddCollateralCapDrawer
          open
          onClose={() => setAdding(null)}
          vaultAddress={vaultAddress}
          chainId={chainId}
          timelockSeconds={timelockSeconds}
          decimals={decimals}
          assetSymbol={assetSymbol}
        />
      )}
      {adding === 'market' && (
        <AddMarketCapDrawer
          open
          onClose={() => setAdding(null)}
          vaultAddress={vaultAddress}
          chainId={chainId}
          timelockSeconds={timelockSeconds}
          decimals={decimals}
          assetSymbol={assetSymbol}
        />
      )}
    </div>
  );
}

interface AdapterRow {
  key: string;
  adapter: V2AdapterFull | null;
  entry: AdapterCapEntry | null;
  absoluteCap: bigint;
  relativeCap: bigint;
  allocation: bigint;
}

function resolveDrawerProps(editing: EditingCap): {
  label: string;
  idData: `0x${string}`;
  currentAbs: bigint;
  currentRel: bigint;
} {
  if (editing.kind === 'adapter-overview') {
    return {
      label: `Adapter caps: ${editing.adapter.name ?? editing.adapter.address.slice(0, 10)}`,
      idData: adapterIdData(editing.adapter.address),
      currentAbs: editing.adapter.absoluteCap,
      currentRel: editing.adapter.relativeCap,
    };
  }
  if (editing.kind === 'adapter-entry') {
    return {
      label: `Adapter caps: ${editing.entry.adapter.slice(0, 10)}`,
      idData: editing.entry.idData,
      currentAbs: editing.entry.absoluteCap,
      currentRel: editing.entry.relativeCap,
    };
  }
  if (editing.kind === 'collateral') {
    return {
      label: `Collateral caps: ${editing.entry.collateralToken.symbol}`,
      idData: editing.entry.idData,
      currentAbs: editing.entry.absoluteCap,
      currentRel: editing.entry.relativeCap,
    };
  }
  const lltvPct = (Number(editing.entry.params.lltv) / 1e18) * 100;
  return {
    label: `Market caps: ${editing.entry.collateralToken?.symbol ?? '???'} @ ${lltvPct.toFixed(1)}% LLTV`,
    idData: editing.entry.idData,
    currentAbs: editing.entry.absoluteCap,
    currentRel: editing.entry.relativeCap,
  };
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] text-text-tertiary uppercase">{label}</span>
      <p className="font-mono text-sm text-text-primary mt-0.5">{value}</p>
    </div>
  );
}

interface CapTableRowData {
  key: string;
  target: React.ReactNode;
  subTarget: React.ReactNode;
  allocation: bigint;
  absoluteCap: bigint;
  relativeCap: bigint;
  totalAssets: bigint;
  decimals: number;
  assetSymbol: string;
  canEdit: boolean;
  onEdit: () => void;
}

function CapTable({
  rows,
  isLoading,
  emptyHint,
}: {
  rows: CapTableRowData[];
  isLoading: boolean;
  emptyHint: string;
}) {
  if (isLoading) {
    return <div className="h-16 animate-shimmer bg-bg-hover" />;
  }
  if (rows.length === 0) {
    return <p className="text-[10px] text-text-tertiary italic py-2">{emptyHint}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
            <th className="text-left py-2 px-2">Target</th>
            <th className="text-right py-2 px-2">Allocation</th>
            <th className="text-right py-2 px-2">Absolute Cap</th>
            <th className="text-right py-2 px-2">Relative Cap</th>
            <th className="text-right py-2 px-2 w-32">Usage</th>
            <th className="text-right py-2 px-2 w-16">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const absPct =
              r.absoluteCap > 0n ? (Number(r.allocation) / Number(r.absoluteCap)) * 100 : 0;
            const relPct =
              r.relativeCap > 0n && r.totalAssets > 0n
                ? ((Number(r.allocation) / Number(r.totalAssets)) /
                    (Number(r.relativeCap) / 1e18)) *
                  100
                : 0;
            const usagePct = Math.max(absPct, relPct);
            const showUsage = (r.absoluteCap > 0n || r.relativeCap > 0n) && r.allocation > 0n;

            return (
              <tr
                key={r.key}
                className="border-b border-border-subtle/50 hover:bg-bg-hover/30 last:border-0"
              >
                <td className="py-2 px-2 align-top">
                  <div className="flex flex-col gap-0.5">
                    {r.target}
                    <div className="text-[10px] text-text-tertiary">{r.subTarget}</div>
                  </div>
                </td>
                <td className="text-right py-2 px-2 font-mono text-text-primary align-top">
                  {r.allocation > 0n
                    ? `${formatTokenAmount(r.allocation, r.decimals)} ${r.assetSymbol}`
                    : `0 ${r.assetSymbol}`}
                </td>
                <td className="text-right py-2 px-2 font-mono text-text-primary align-top">
                  {r.absoluteCap > 0n
                    ? formatCapDisplay(r.absoluteCap, r.decimals, r.assetSymbol)
                    : '—'}
                </td>
                <td className="text-right py-2 px-2 font-mono text-text-primary align-top">
                  {r.relativeCap > 0n ? formatWadPercent(r.relativeCap) : '—'}
                </td>
                <td className="py-2 px-2 align-middle">
                  {showUsage ? (
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
                  <Button size="sm" variant="ghost" disabled={!r.canEdit} onClick={r.onEdit}>
                    Edit
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
