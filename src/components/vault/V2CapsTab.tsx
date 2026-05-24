/**
 * V2 caps management view.
 *
 * PR 21 — Morpho-curator-style adapter-level table replacing the V1
 * CapsTab on V2 vaults.
 *
 * PR 22 — extended to render the three-level hierarchy (adapter →
 * collateral → market). All three levels open the new parameterized
 * `CapEditDrawer` (PR 22) which handles the Submit→Wait→Execute flow
 * via multicall regardless of which level is being edited.
 *
 * Data flow:
 *   - `useV2AdapterOverview` provides adapter-level caps for every adapter.
 *   - For each market-v1 adapter we additionally call `useV2AdapterAllCaps`
 *     to fetch its per-collateral and per-market caps. Empty until the
 *     adapter has positions (its on-chain `marketIds()` populates only
 *     after the first `allocate`).
 */
import { useState } from 'react';
import type { Address } from 'viem';
import { useVaultInfo } from '../../lib/hooks/useVault';
import {
  useV2AdapterOverview,
  type V2AdapterFull,
} from '../../lib/hooks/useV2Adapters';
import {
  useV2AdapterAllCaps,
  type MarketCapEntry,
  type CollateralCapEntry,
} from '../../hooks/useV2AdapterAllCaps';
import { useVaultPermissions } from '../../hooks/useVaultPermissions';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { AddressDisplay } from '../ui/AddressDisplay';
import { ProgressBar } from '../ui/ProgressBar';
import { CapEditDrawer } from './adapters/CapEditDrawer';
import { adapterIdData } from '../../lib/v2/adapterCapUtils';
import { formatTokenAmount, formatWadPercent } from '../../lib/utils/format';

interface V2CapsTabProps {
  chainId: number;
  vaultAddress: Address;
}

/** What the user is currently editing — drives the CapEditDrawer's props. */
type EditingCap =
  | { kind: 'adapter'; adapter: V2AdapterFull }
  | { kind: 'collateral'; entry: CollateralCapEntry }
  | { kind: 'market'; entry: MarketCapEntry };

export function V2CapsTab({ chainId, vaultAddress }: V2CapsTabProps) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const overview = useV2AdapterOverview(chainId, vaultAddress, vault?.totalAssets);
  const permissions = useVaultPermissions(chainId, vaultAddress);
  const [editing, setEditing] = useState<EditingCap | null>(null);

  const adapters = overview.data?.adapters ?? [];
  const decimals = vault?.assetInfo.decimals ?? 18;
  const assetSymbol = vault?.assetInfo.symbol ?? '???';
  const canSetCaps = permissions.canCurate || permissions.isAdmin;
  const timelockSeconds = vault?.timelock ?? 0n;

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

  // Resolve the open-drawer props from `editing` state.
  const drawerProps = editing ? resolveDrawerProps(editing) : null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-3 gap-3 p-3">
          <SummaryCell label="Adapters" value={String(adapters.length)} />
          <SummaryCell
            label="With Caps"
            value={`${adapters.filter((a) => a.absoluteCap > 0n || a.relativeCap > 0n).length}/${adapters.length}`}
          />
          <SummaryCell
            label="Total Allocated"
            value={`${formatTokenAmount(
              adapters.reduce((s, a) => s + a.realAssets, 0n),
              decimals,
            )} ${assetSymbol}`}
          />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Caps</CardTitle>
          <Badge variant="info">V2</Badge>
        </CardHeader>

        <p className="text-[10px] text-text-tertiary mb-3">
          Three-level cap hierarchy: adapter / collateral / market. Each row exposes its own
          Edit drawer — all three levels share the same on-chain
          <span className="font-mono"> increase*Cap </span>/{' '}
          <span className="font-mono">decrease*Cap </span>
          mutators (PR 14 / PR 15). Collateral + market rows appear only after the adapter has
          allocations on those markets.
        </p>

        <div className="space-y-4">
          {adapters.map((a) => (
            <AdapterCapsSection
              key={a.address}
              adapter={a}
              chainId={chainId}
              vaultAddress={vaultAddress}
              decimals={decimals}
              assetSymbol={assetSymbol}
              totalAssets={vault?.totalAssets ?? 0n}
              canSetCaps={canSetCaps}
              onEdit={setEditing}
            />
          ))}
        </div>
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
    </div>
  );
}

function resolveDrawerProps(editing: EditingCap): {
  label: string;
  idData: `0x${string}`;
  currentAbs: bigint;
  currentRel: bigint;
} {
  if (editing.kind === 'adapter') {
    return {
      label: `Adapter caps: ${editing.adapter.name ?? editing.adapter.address.slice(0, 10)}`,
      idData: adapterIdData(editing.adapter.address),
      currentAbs: editing.adapter.absoluteCap,
      currentRel: editing.adapter.relativeCap,
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
    label: `Market caps: ${editing.entry.collateralToken.symbol} @ ${lltvPct.toFixed(1)}% LLTV`,
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

function AdapterCapsSection({
  adapter,
  chainId,
  vaultAddress,
  decimals,
  assetSymbol,
  totalAssets,
  canSetCaps,
  onEdit,
}: {
  adapter: V2AdapterFull;
  chainId: number;
  vaultAddress: Address;
  decimals: number;
  assetSymbol: string;
  totalAssets: bigint;
  canSetCaps: boolean;
  onEdit: (e: EditingCap) => void;
}) {
  const subCaps = useV2AdapterAllCaps(
    chainId,
    vaultAddress,
    adapter.address,
    adapter.morphoBlue,
    adapter.type,
  );
  const marketCaps = subCaps.data?.marketCaps ?? [];
  const collateralCaps = subCaps.data?.collateralCaps ?? [];

  const hasSubRows = marketCaps.length > 0 || collateralCaps.length > 0;

  return (
    <div className="border border-border-subtle">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-text-tertiary uppercase bg-bg-hover/40 border-b border-border-subtle">
            <th className="text-left py-2 px-3">Level</th>
            <th className="text-left py-2 px-3">Target</th>
            <th className="text-right py-2 px-3">Allocated</th>
            <th className="text-right py-2 px-3">Abs. Cap</th>
            <th className="text-right py-2 px-3">Rel. Cap</th>
            <th className="text-right py-2 px-3 w-32">Usage</th>
            <th className="text-right py-2 px-3 w-16">Action</th>
          </tr>
        </thead>
        <tbody>
          {/* Adapter-level row */}
          <CapTableRow
            level="ADAPTER"
            levelVariant="info"
            target={
              <span className="flex items-center gap-2">
                <span className="text-text-primary font-medium">
                  {adapter.name ?? `Adapter ${adapter.address.slice(0, 10)}`}
                </span>
                {adapter.type === 'market-v1' && <Badge variant="success">MKT</Badge>}
                {adapter.type === 'vault-v1' && <Badge variant="info">V1</Badge>}
                {adapter.isLiquidityAdapter && <Badge variant="purple">Liq</Badge>}
              </span>
            }
            subTarget={<AddressDisplay address={adapter.address} chainId={chainId} />}
            allocated={`${formatTokenAmount(adapter.realAssets, decimals)} ${assetSymbol}`}
            absoluteCap={adapter.absoluteCap}
            relativeCap={adapter.relativeCap}
            allocatedRaw={adapter.realAssets}
            totalAssets={totalAssets}
            decimals={decimals}
            assetSymbol={assetSymbol}
            canEdit={canSetCaps}
            onEdit={() => onEdit({ kind: 'adapter', adapter })}
          />

          {/* Collateral-level rows */}
          {collateralCaps.map((c) => (
            <CapTableRow
              key={`c-${c.collateralToken.address.toLowerCase()}`}
              level="COLLATERAL"
              levelVariant="info"
              target={
                <span className="text-text-primary">{c.collateralToken.symbol}</span>
              }
              subTarget={<AddressDisplay address={c.collateralToken.address} chainId={chainId} />}
              allocated="—"
              absoluteCap={c.absoluteCap}
              relativeCap={c.relativeCap}
              allocatedRaw={0n}
              totalAssets={totalAssets}
              decimals={decimals}
              assetSymbol={assetSymbol}
              canEdit={canSetCaps}
              onEdit={() => onEdit({ kind: 'collateral', entry: c })}
            />
          ))}

          {/* Market-level rows */}
          {marketCaps.map((m) => (
            <CapTableRow
              key={`m-${m.marketId.toLowerCase()}`}
              level="MARKET"
              levelVariant="success"
              target={
                <span className="text-text-primary">
                  {m.collateralToken.symbol} @ {((Number(m.params.lltv) / 1e18) * 100).toFixed(1)}%
                </span>
              }
              subTarget={
                <span className="font-mono text-[10px] text-text-tertiary">
                  {m.marketId.slice(0, 10)}…{m.marketId.slice(-4)}
                </span>
              }
              allocated={`${formatTokenAmount(m.loanSupplyAssets, decimals)} ${assetSymbol}`}
              absoluteCap={m.absoluteCap}
              relativeCap={m.relativeCap}
              allocatedRaw={m.loanSupplyAssets}
              totalAssets={totalAssets}
              decimals={decimals}
              assetSymbol={assetSymbol}
              canEdit={canSetCaps}
              onEdit={() => onEdit({ kind: 'market', entry: m })}
            />
          ))}

          {/* Empty-state hint when no positions yet */}
          {!subCaps.isLoading && !hasSubRows && (
            <tr>
              <td colSpan={7} className="py-2 px-3 text-[10px] text-text-tertiary italic">
                No allocations on this adapter yet — collateral and market caps will appear
                here once an <span className="font-mono">allocate</span> lands on a configured
                market.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CapTableRow({
  level,
  levelVariant,
  target,
  subTarget,
  allocated,
  absoluteCap,
  relativeCap,
  allocatedRaw,
  totalAssets,
  decimals,
  assetSymbol,
  canEdit,
  onEdit,
}: {
  level: string;
  levelVariant: 'default' | 'info' | 'success' | 'warning';
  target: React.ReactNode;
  subTarget: React.ReactNode;
  allocated: string;
  absoluteCap: bigint;
  relativeCap: bigint;
  allocatedRaw: bigint;
  totalAssets: bigint;
  decimals: number;
  assetSymbol: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const absPct = absoluteCap > 0n ? (Number(allocatedRaw) / Number(absoluteCap)) * 100 : 0;
  const relUsedPct =
    relativeCap > 0n && totalAssets > 0n
      ? ((Number(allocatedRaw) / Number(totalAssets)) / (Number(relativeCap) / 1e18)) * 100
      : 0;
  const usagePct = Math.max(absPct, relUsedPct);
  const configured = absoluteCap > 0n || relativeCap > 0n;

  return (
    <tr className="border-b border-border-subtle/50 hover:bg-bg-hover/30 last:border-0">
      <td className="py-2 px-3 align-top">
        <Badge variant={levelVariant}>{level}</Badge>
      </td>
      <td className="py-2 px-3 align-top">
        <div className="flex flex-col gap-0.5">
          {target}
          <div className="text-[10px] text-text-tertiary">{subTarget}</div>
        </div>
      </td>
      <td className="text-right py-2 px-3 font-mono text-text-primary align-top">{allocated}</td>
      <td className="text-right py-2 px-3 font-mono text-text-primary align-top">
        {absoluteCap > 0n
          ? `${formatTokenAmount(absoluteCap, decimals)} ${assetSymbol}`
          : '—'}
      </td>
      <td className="text-right py-2 px-3 font-mono text-text-primary align-top">
        {relativeCap > 0n ? formatWadPercent(relativeCap) : '—'}
      </td>
      <td className="py-2 px-3 align-middle">
        {configured && allocatedRaw > 0n ? (
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
      <td className="text-right py-2 px-3 align-top">
        <Button size="sm" variant="ghost" disabled={!canEdit} onClick={onEdit}>
          Edit
        </Button>
      </td>
    </tr>
  );
}
