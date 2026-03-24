import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ProgressBar } from '../../ui/ProgressBar';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { UtilizationBar } from '../../risk/UtilizationBar';
import { formatTokenAmount, formatPercent, formatWadPercent } from '../../../lib/utils/format';
import { useAdapterMarketPositions, type V2AdapterFull } from '../../../lib/hooks/useV2Adapters';
import type { AdapterMarketPosition } from '../../../types';

interface AdapterCardProps {
  adapter: V2AdapterFull;
  chainId: number;
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
            value={`${formatTokenAmount(adapter.absoluteCap, decimals)} ${assetSymbol}`}
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
            {positions && <Badge>{positions.length}</Badge>}
          </button>
          {marketsExpanded && (
            <div className="mt-2 space-y-1.5">
              {positionsLoading ? (
                <div className="h-8 bg-bg-hover animate-shimmer" />
              ) : positions?.length ? (
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
                      {positions.map((pos) => (
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
                <p className="text-text-tertiary text-[10px]">No markets found</p>
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
