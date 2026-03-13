// viem types used transitively via V2AdapterFull
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { ProgressBar } from '../../ui/ProgressBar';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { formatTokenAmount, formatWadPercent } from '../../../lib/utils/format';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

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
