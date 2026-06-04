import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useReadContracts } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ProgressBar } from '../../ui/ProgressBar';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { UtilizationBar } from '../../risk/UtilizationBar';
import { formatTokenAmount, formatPercent, formatWadPercent, formatCapDisplay } from '../../../lib/utils/format';
import { useAdapterMarketPositions, type V2AdapterFull } from '../../../lib/hooks/useV2Adapters';
import { useV2VaultCapEntries } from '../../../hooks/useV2VaultCapEntries';
import { morphoBlueAbi } from '../../../lib/contracts/abis';
import type { AdapterMarketPosition, MarketId, MarketState } from '../../../types';
import type { Address } from 'viem';

interface AdapterCardProps {
  adapter: V2AdapterFull;
  chainId: number;
  vaultAddress: Address;
  decimals: number;
  assetSymbol: string;
  totalAssets: bigint;
  // Role flags
  canAllocate: boolean;
  canSetCaps: boolean;
  canRemove: boolean;
  // Actions
  onAllocate: (adapter: V2AdapterFull) => void;
  onDeallocate: (adapter: V2AdapterFull) => void;
  onUpdateCaps: (adapter: V2AdapterFull) => void;
  onRemove: (adapter: V2AdapterFull) => void;
  onSkim?: (adapter: V2AdapterFull) => void;
}

export function AdapterCard({
  adapter,
  chainId,
  vaultAddress,
  decimals,
  assetSymbol,
  totalAssets,
  canAllocate,
  canSetCaps,
  canRemove,
  onAllocate,
  onDeallocate,
  onUpdateCaps,
  onRemove,
  onSkim,
}: AdapterCardProps) {
  const [marketsExpanded, setMarketsExpanded] = useState(false);

  const { data: positions, isLoading: positionsLoading } = useAdapterMarketPositions(
    chainId,
    adapter.address,
    adapter.morphoBlue,
    adapter.type,
  );

  // PR 24 — include cap-only markets from the event-discovered set
  // (PR 23) so the Markets breakdown lists every market the adapter is
  // configured for, not just those with a non-zero allocation.
  const { data: capEntries } = useV2VaultCapEntries(chainId, vaultAddress);
  const baseMergedPositions = useMergedPositions(adapter.address, positions, capEntries?.marketCaps);
  // Cap-only entries arrive with marketState=null, which made the Util
  // column read 0% even when the underlying market was at 90% — the
  // bar should reflect MARKET utilization (borrow/supply) regardless of
  // whether the vault has supplied into it. Fetch the missing states
  // straight from Morpho Blue and splice them back in.
  const mergedPositions = useCapOnlyMarketStates(
    chainId,
    adapter.morphoBlue,
    baseMergedPositions,
  );

  const typeBadge = adapter.type === 'vault-v1'
    ? <Badge variant="info">V1 Vault Adapter</Badge>
    : adapter.type === 'market-v1'
      ? <Badge variant="success">V1 Market Adapter</Badge>
      : <Badge>Unknown</Badge>;

  // Cap utilization
  const absCapPct = adapter.absoluteCap > 0n
    ? (Number(adapter.realAssets) / Number(adapter.absoluteCap)) * 100
    : 0;

  const relCapPct = adapter.relativeCap > 0n && totalAssets > 0n
    ? ((Number(adapter.realAssets) / Number(totalAssets)) / (Number(adapter.relativeCap) / 1e18)) * 100
    : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 min-w-0">
          <CardTitle className="truncate">
            {adapter.name ?? `Adapter ${adapter.address.slice(0, 10)}`}
          </CardTitle>
          {typeBadge}
          {adapter.isLiquidityAdapter && (
            <Badge variant="purple">Liquidity</Badge>
          )}
        </div>
      </CardHeader>

      {/* Target info */}
      <div className="mb-3">
        {adapter.underlyingVault && (
          <div className="flex items-center gap-1 text-xs text-text-tertiary">
            <span>Target:</span>
            <AddressDisplay address={adapter.underlyingVault} chainId={chainId} />
          </div>
        )}
        {adapter.morphoBlue && !adapter.underlyingVault && (
          <div className="flex items-center gap-1 text-xs text-text-tertiary">
            <span>Morpho Blue:</span>
            <AddressDisplay address={adapter.morphoBlue} chainId={chainId} />
          </div>
        )}
        <div className="flex items-center gap-1 text-xs text-text-tertiary mt-0.5">
          <span>Adapter:</span>
          <AddressDisplay address={adapter.address} chainId={chainId} />
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3">
        <MetricRow
          label="Allocated"
          value={`${formatTokenAmount(adapter.realAssets, decimals)} ${assetSymbol}`}
        />
        {adapter.absoluteCap > 0n && (
          <MetricRow
            label="Abs. Cap"
            value={formatCapDisplay(adapter.absoluteCap, decimals, assetSymbol)}
          />
        )}
        {adapter.relativeCap > 0n && (
          <MetricRow
            label="Rel. Cap"
            value={formatWadPercent(adapter.relativeCap)}
          />
        )}
      </div>

      {/* Cap bars */}
      {adapter.absoluteCap > 0n && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[10px] text-text-tertiary mb-0.5">
            <span>Abs. Cap Usage</span>
            <span className="font-mono">{absCapPct.toFixed(1)}%</span>
          </div>
          <ProgressBar value={absCapPct} height="sm" />
        </div>
      )}
      {adapter.relativeCap > 0n && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] text-text-tertiary mb-0.5">
            <span>Rel. Cap Usage</span>
            <span className="font-mono">{relCapPct.toFixed(1)}%</span>
          </div>
          <ProgressBar value={relCapPct} height="sm" />
        </div>
      )}

      {/* Market Breakdown (market-v1 adapters only) */}
      {adapter.type === 'market-v1' && (
        <div className="mb-3">
          <button
            onClick={() => setMarketsExpanded(!marketsExpanded)}
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
            aria-label={marketsExpanded ? 'Collapse market breakdown' : 'Expand market breakdown'}
          >
            {marketsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="font-medium">Markets</span>
            {mergedPositions && <Badge>{mergedPositions.length}</Badge>}
          </button>
          {marketsExpanded && (
            <div className="mt-2 space-y-1.5">
              {positionsLoading ? (
                <div className="h-8 bg-bg-hover animate-shimmer" />
              ) : mergedPositions?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
                        <th className="text-left py-1 px-1.5">Collateral</th>
                        <th className="text-right py-1 px-1.5">LLTV</th>
                        <th className="text-right py-1 px-1.5">Allocated</th>
                        <th className="text-right py-1 px-1.5">Util</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mergedPositions.map((pos) => (
                        <MarketPositionRow
                          key={pos.marketId}
                          position={pos}
                          decimals={decimals}
                          assetSymbol={assetSymbol}
                          adapterTotal={adapter.realAssets}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                // PR 24 — even cap-only markets appear here now (PR 23
                // event discovery). If we still get nothing, the adapter
                // genuinely has no markets configured nor allocated.
                <p className="text-text-tertiary text-[10px]">
                  No markets configured for this adapter. Use{' '}
                  <span className="font-mono">Add Market</span> to register one with caps.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border-subtle">
        {canAllocate && (
          <>
            <Button size="sm" variant="secondary" onClick={() => onAllocate(adapter)}>
              Allocate
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onDeallocate(adapter)}>
              Deallocate
            </Button>
          </>
        )}
        {onSkim && adapter.type === 'vault-v1' && (
          <Button size="sm" variant="ghost" onClick={() => onSkim(adapter)}>
            Skim
          </Button>
        )}
        {canSetCaps && (
          <Button size="sm" variant="ghost" onClick={() => onUpdateCaps(adapter)}>
            Caps
          </Button>
        )}
        {canRemove && (
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => onRemove(adapter)}>
            Remove
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Merge live adapter positions with event-discovered market cap entries.
 * Allocated markets (from `useAdapterMarketPositions`) keep their `marketState`,
 * `loanToken`, `supplyAssets`, etc. Cap-only markets (from the event set, filtered
 * to THIS adapter) appear as zero-allocation rows with `params` + `collateralToken`
 * populated. Dedupe by `marketId`.
 */
function useMergedPositions(
  adapterAddress: Address,
  positions: AdapterMarketPosition[] | undefined,
  capEntries:
    | Array<{
        marketId: `0x${string}`;
        adapter: Address;
        params: { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint };
        collateralToken: { address: Address; symbol: string; decimals: number; name?: string } | null;
      }>
    | undefined,
): AdapterMarketPosition[] | undefined {
  return useMemo(() => {
    if (!positions && !capEntries) return undefined;
    const merged = new Map<string, AdapterMarketPosition>();
    for (const p of positions ?? []) merged.set(p.marketId.toLowerCase(), p);
    for (const e of capEntries ?? []) {
      if (e.adapter.toLowerCase() !== adapterAddress.toLowerCase()) continue;
      const k = e.marketId.toLowerCase();
      if (merged.has(k)) continue;
      merged.set(k, {
        marketId: e.marketId as MarketId,
        supplyAssets: 0n,
        supplyShares: 0n,
        params: e.params,
        marketState: null,
        loanToken: null,
        collateralToken: e.collateralToken,
      });
    }
    return Array.from(merged.values());
  }, [adapterAddress, positions, capEntries]);
}

/**
 * Backfill `marketState` on cap-only positions by reading
 * `morphoBlue.market(id)` for every missing id. The merge is by
 * marketId so the row order stays stable; nothing is touched when
 * every position already has a state.
 */
function useCapOnlyMarketStates(
  chainId: number,
  morphoBlue: Address | null,
  positions: AdapterMarketPosition[] | undefined,
): AdapterMarketPosition[] | undefined {
  const missingIds = useMemo(
    () => (positions ?? []).filter((p) => !p.marketState).map((p) => p.marketId),
    [positions],
  );
  const { data: states } = useReadContracts({
    contracts: missingIds.map((id) => ({
      address: morphoBlue ?? undefined,
      abi: morphoBlueAbi,
      functionName: 'market',
      args: [id],
      chainId,
    })),
    query: {
      enabled: !!morphoBlue && missingIds.length > 0,
      staleTime: 30_000,
      refetchInterval: 60_000,
    },
  });
  return useMemo(() => {
    if (!positions) return positions;
    if (!states || missingIds.length === 0) return positions;
    const stateById = new Map<string, MarketState>();
    states.forEach((res, i) => {
      if (res.status !== 'success' || !res.result) return;
      // Morpho Blue market(id) tuple → MarketState shape we already use
      // elsewhere (rpcClient.fetchMarketState).
      const r = res.result as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
      stateById.set(missingIds[i].toLowerCase(), {
        totalSupplyAssets: r[0],
        totalSupplyShares: r[1],
        totalBorrowAssets: r[2],
        totalBorrowShares: r[3],
        lastUpdate: r[4],
        fee: r[5],
      });
    });
    return positions.map((p) => {
      if (p.marketState) return p;
      const s = stateById.get(p.marketId.toLowerCase());
      return s ? { ...p, marketState: s } : p;
    });
  }, [positions, states, missingIds]);
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] text-text-tertiary uppercase">{label}</span>
      <p className="font-mono text-xs text-text-primary">{value}</p>
    </div>
  );
}

function MarketPositionRow({ position, decimals, assetSymbol, adapterTotal }: {
  position: AdapterMarketPosition;
  decimals: number;
  assetSymbol: string;
  adapterTotal: bigint;
}) {
  const pctOfAdapter = adapterTotal > 0n
    ? Number((position.supplyAssets * 10000n) / adapterTotal) / 100
    : 0;

  const utilization = position.marketState && position.marketState.totalSupplyAssets > 0n
    ? Number((position.marketState.totalBorrowAssets * 10000n) / position.marketState.totalSupplyAssets) / 100
    : 0;

  const collateralSymbol = position.collateralToken?.symbol ?? '???';
  const lltv = position.params ? Number(position.params.lltv) / 1e18 : 0;

  return (
    <tr className="border-b border-border-subtle/50 hover:bg-bg-hover/30">
      <td className="py-1.5 px-1.5">
        <span className="text-text-primary font-medium">{collateralSymbol}</span>
        <span className="text-text-tertiary"> / {assetSymbol}</span>
      </td>
      <td className="text-right py-1.5 px-1.5 font-mono text-text-primary">
        {formatPercent(lltv)}
      </td>
      <td className="text-right py-1.5 px-1.5">
        <span className="font-mono text-text-primary">{formatTokenAmount(position.supplyAssets, decimals)}</span>
        <span className="text-text-tertiary ml-1">({pctOfAdapter.toFixed(0)}%)</span>
      </td>
      <td className="text-right py-1.5 px-1.5 w-16">
        <UtilizationBar utilization={utilization} compact />
      </td>
    </tr>
  );
}
