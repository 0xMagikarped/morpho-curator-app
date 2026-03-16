/**
 * Detailed view for a single adapter showing type info, caps at all three levels,
 * and inline editing for caps.
 */
import type { Address } from 'viem';
import { useQuery } from '@tanstack/react-query';
import { Shield, Layers, Database } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { InlineCapEditor } from './InlineCapEditor';
import { formatTokenAmount, formatWadPercent } from '../../../lib/utils/format';
import { isUnlimitedCap } from '../../../lib/v2/adapterCapUtils';
import { useAdapterCaps, type CapReading } from '../../../hooks/useAdapterCaps';
import { detectAdapterTypeViaFactory, type AdapterDetectionResult } from '../../../lib/v2/adapterUtils';
import { getPublicClient } from '../../../lib/data/rpcClient';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';
import type { MarketParams } from '../../../types';

interface AdapterDetailViewProps {
  adapter: V2AdapterFull;
  chainId: number;
  vaultAddress: Address;
  decimals: number;
  assetSymbol: string;
  canSetCaps: boolean;
  marketParams?: MarketParams;
}

export function AdapterDetailView({
  adapter,
  chainId,
  vaultAddress,
  decimals,
  assetSymbol,
  canSetCaps,
  marketParams,
}: AdapterDetailViewProps) {
  // Detect adapter type via factory
  const { data: adapterType } = useQuery<AdapterDetectionResult>({
    queryKey: ['adapter-type', chainId, adapter.address],
    queryFn: async () => {
      const client = getPublicClient(chainId);
      return detectAdapterTypeViaFactory(adapter.address, chainId, client);
    },
    staleTime: Infinity,
  });

  // Read caps at all three levels
  const { data: caps, isLoading: capsLoading } = useAdapterCaps(
    chainId,
    vaultAddress,
    adapter.address,
    marketParams,
  );

  const typeLabel = adapterType?.type === 'market-v1'
    ? 'Market V1 Adapter'
    : adapterType?.type === 'vault-v1'
      ? 'Vault V1 Adapter'
      : 'Unknown Adapter';

  const typeBadgeVariant = adapterType?.type === 'market-v1' ? 'info' : adapterType?.type === 'vault-v1' ? 'purple' : 'default';

  return (
    <Card className="space-y-4">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>{adapter.name ?? 'Adapter'}</CardTitle>
          <Badge variant={typeBadgeVariant as 'info' | 'purple' | 'default'}>{typeLabel}</Badge>
          {adapter.isLiquidityAdapter && <Badge variant="purple">Liquidity</Badge>}
        </div>
      </CardHeader>

      {/* Adapter info */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-text-tertiary">Address</span>
          <div className="mt-0.5">
            <AddressDisplay address={adapter.address} chainId={chainId} />
          </div>
        </div>
        <div>
          <span className="text-text-tertiary">Allocated</span>
          <p className="font-mono text-text-primary mt-0.5">
            {formatTokenAmount(adapter.realAssets, decimals)} {assetSymbol}
          </p>
        </div>
        {adapterType?.type === 'vault-v1' && adapterType.targetVault && (
          <div>
            <span className="text-text-tertiary">Target Vault</span>
            <div className="mt-0.5 flex items-center gap-1.5">
              <AddressDisplay address={adapterType.targetVault} chainId={chainId} />
              {adapterType.targetVaultName && (
                <span className="text-text-secondary text-[10px]">{adapterType.targetVaultName}</span>
              )}
            </div>
          </div>
        )}
        {adapterType?.type === 'market-v1' && adapterType.morphoBlue && (
          <div>
            <span className="text-text-tertiary">Morpho Blue</span>
            <div className="mt-0.5">
              <AddressDisplay address={adapterType.morphoBlue} chainId={chainId} />
            </div>
          </div>
        )}
      </div>

      {/* Three-level caps */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5" />
          Caps
        </h3>

        {capsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-shimmer h-12 bg-bg-hover" />
            ))}
          </div>
        ) : caps && caps.length > 0 ? (
          <div className="space-y-1.5">
            {caps.map((cap) => (
              <CapLevelRow
                key={cap.id}
                cap={cap}
                vaultAddress={vaultAddress}
                decimals={decimals}
                assetSymbol={assetSymbol}

                canEdit={canSetCaps}
              />
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-text-tertiary">No cap data available.</p>
        )}
      </div>
    </Card>
  );
}

function CapLevelRow({
  cap,
  vaultAddress,
  decimals,
  assetSymbol,
  canEdit,
}: {
  cap: CapReading;
  vaultAddress: Address;
  decimals: number;
  assetSymbol: string;
  canEdit: boolean;
}) {
  const levelIcon = cap.level === 'adapter'
    ? <Database className="w-3 h-3 text-info" />
    : cap.level === 'collateral'
      ? <Layers className="w-3 h-3 text-warning" />
      : <Shield className="w-3 h-3 text-accent-primary" />;

  const utilizationPct = cap.absoluteCap > 0n && !isUnlimitedCap(cap.absoluteCap)
    ? (Number(cap.allocation) / Number(cap.absoluteCap) * 100)
    : 0;

  return (
    <div className="p-2.5 bg-bg-hover border border-border-subtle">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          {levelIcon}
          <span className="text-xs font-medium text-text-primary">{cap.label}</span>
        </div>
        <span className="text-[10px] font-mono text-text-tertiary">
          Alloc: {formatTokenAmount(cap.allocation, decimals)} {assetSymbol}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-[10px]">
        <div>
          <span className="text-text-tertiary">Absolute Cap</span>
          <div className="mt-0.5">
            {canEdit ? (
              <InlineCapEditor
                vaultAddress={vaultAddress}
                idData={cap.id}
                currentValue={cap.absoluteCap}
                type="absolute"
                decimals={decimals}
                assetSymbol={assetSymbol}
              />
            ) : (
              <span className="font-mono text-text-primary">
                {isUnlimitedCap(cap.absoluteCap)
                  ? 'Unlimited'
                  : `${formatTokenAmount(cap.absoluteCap, decimals)} ${assetSymbol}`}
              </span>
            )}
          </div>
        </div>
        <div>
          <span className="text-text-tertiary">Relative Cap</span>
          <div className="mt-0.5">
            {canEdit ? (
              <InlineCapEditor
                vaultAddress={vaultAddress}
                idData={cap.id}
                currentValue={cap.relativeCap}
                type="relative"
                decimals={decimals}
                assetSymbol={assetSymbol}
              />
            ) : (
              <span className="font-mono text-text-primary">
                {formatWadPercent(cap.relativeCap)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Utilization bar for absolute cap */}
      {!isUnlimitedCap(cap.absoluteCap) && cap.absoluteCap > 0n && (
        <div className="mt-2">
          <div className="h-1 bg-bg-active overflow-hidden">
            <div
              className="h-full bg-accent-primary transition-all"
              style={{ width: `${Math.min(utilizationPct, 100)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-text-tertiary">{utilizationPct.toFixed(1)}% used</span>
        </div>
      )}
    </div>
  );
}
