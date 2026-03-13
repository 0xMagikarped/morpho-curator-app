import { useState } from 'react';
import type { Address } from 'viem';
import { Plus } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { SectionHeader } from '../ui/SectionHeader';
import { useVaultInfo, useVaultRole } from '../../lib/hooks/useVault';
import { useV2AdapterOverview, type V2AdapterFull } from '../../lib/hooks/useV2Adapters';
import { useChainGuard } from '../../lib/hooks/useChainGuard';
import { CapitalDistribution } from './adapters/CapitalDistribution';
import { LiquidityAdapterBanner } from './adapters/LiquidityAdapterBanner';
import { AdapterCard } from './adapters/AdapterCard';
import { AddAdapterDrawer } from './adapters/AddAdapterDrawer';
import { AllocateDrawer } from './adapters/AllocateDrawer';
import { DeallocateDrawer } from './adapters/DeallocateDrawer';
import { SetLiquidityDrawer } from './adapters/SetLiquidityDrawer';
import { UpdateCapsDrawer } from './adapters/UpdateCapsDrawer';
import { RemoveAdapterDrawer } from './adapters/RemoveAdapterDrawer';
import { SkimRewardsDrawer } from './adapters/SkimRewardsDrawer';

interface V2AdaptersTabProps {
  chainId: number;
  vaultAddress: Address;
}

type DrawerType = 'add' | 'allocate' | 'deallocate' | 'liquidity' | 'caps' | 'remove' | 'skim' | null;

export function V2AdaptersTab({ chainId, vaultAddress }: V2AdaptersTabProps) {
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const role = useVaultRole(chainId, vaultAddress);
  const { isMismatch, requestSwitch } = useChainGuard(chainId);

  const decimals = vault?.assetInfo.decimals ?? 18;
  const assetSymbol = vault?.assetInfo.symbol ?? '';
  const totalAssets = vault?.totalAssets ?? 0n;
  const timelockSeconds = vault?.timelock ?? 0n;

  const {
    data: overview,
    isLoading,
    error,
  } = useV2AdapterOverview(chainId, vaultAddress, totalAssets);

  // Drawer state
  const [activeDrawer, setActiveDrawer] = useState<DrawerType>(null);
  const [selectedAdapter, setSelectedAdapter] = useState<V2AdapterFull | null>(null);

  const openDrawer = (type: DrawerType, adapter?: V2AdapterFull) => {
    setActiveDrawer(type);
    setSelectedAdapter(adapter ?? null);
  };

  const closeDrawer = () => {
    setActiveDrawer(null);
    setSelectedAdapter(null);
  };

  // Role checks
  const canAllocate = role.isAllocator || role.isOwner;
  const canSetCaps = role.isCurator || role.isOwner;
  const canRemove = role.isCurator || role.isOwner;
  const canAddAdapter = role.isCurator || role.isOwner;
  const canSetLiquidity = role.isAllocator || role.isOwner;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-shimmer h-32 bg-bg-hover" />
        <div className="animate-shimmer h-24 bg-bg-hover" />
        <div className="animate-shimmer h-48 bg-bg-hover" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="py-8 text-center">
        <p className="text-danger text-sm">Failed to load adapters</p>
        <p className="text-text-tertiary text-xs mt-1">
          {error instanceof Error ? error.message : 'Data fetch failed.'}
        </p>
      </Card>
    );
  }

  const adapters = overview?.adapters ?? [];
  const idle = overview?.idle ?? 0n;
  const liquidityAdapter = overview?.liquidityAdapter ?? null;

  return (
    <div className="space-y-4">
      {/* Network mismatch warning */}
      {isMismatch && (
        <div className="flex items-center justify-between bg-warning/10 border border-warning/20 px-3 py-2">
          <span className="text-xs text-warning">Wallet is on the wrong network. Switch to continue.</span>
          <Button size="sm" variant="secondary" onClick={requestSwitch}>Switch Network</Button>
        </div>
      )}

      {/* Header with Add button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SectionHeader>Adapters</SectionHeader>
          <Badge variant="info">V2</Badge>
          <Badge>{adapters.length} adapter{adapters.length !== 1 ? 's' : ''}</Badge>
        </div>
        {canAddAdapter && (
          <Button size="sm" variant="secondary" onClick={() => openDrawer('add')}>
            <Plus size={14} className="mr-1" />
            Add Adapter
          </Button>
        )}
      </div>

      {/* Liquidity Adapter Banner */}
      <LiquidityAdapterBanner
        liquidityAdapter={liquidityAdapter}
        adapters={adapters}
        chainId={chainId}
        canSetLiquidity={canSetLiquidity}
        onSetLiquidity={() => openDrawer('liquidity')}
      />

      {/* Capital Distribution */}
      {adapters.length > 0 && (
        <CapitalDistribution
          adapters={adapters}
          idle={idle}
          totalAssets={totalAssets}
          decimals={decimals}
          assetSymbol={assetSymbol}
        />
      )}

      {/* Adapter Cards */}
      {adapters.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {adapters.map((adapter) => (
            <AdapterCard
              key={adapter.address}
              adapter={adapter}
              chainId={chainId}
              decimals={decimals}
              assetSymbol={assetSymbol}
              totalAssets={totalAssets}
              canAllocate={canAllocate}
              canSetCaps={canSetCaps}
              canRemove={canRemove}
              onAllocate={(a) => openDrawer('allocate', a)}
              onDeallocate={(a) => openDrawer('deallocate', a)}
              onUpdateCaps={(a) => openDrawer('caps', a)}
              onRemove={(a) => openDrawer('remove', a)}
              onSkim={canAllocate ? (a) => openDrawer('skim', a) : undefined}
            />
          ))}
        </div>
      ) : (
        <Card className="py-8 text-center">
          <p className="text-text-tertiary text-sm">No adapters configured.</p>
          <p className="text-text-tertiary text-xs mt-1">
            V2 vaults allocate through adapter contracts. Add an adapter to begin allocating capital.
          </p>
        </Card>
      )}

      {/* Idle liquidity warning */}
      {idle > 0n && totalAssets > 0n && adapters.length > 0 && (
        (() => {
          const idlePct = (Number(idle) / Number(totalAssets)) * 100;
          if (idlePct < 5) return null;
          return (
            <Card className="!p-3 border-warning/20">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-warning">Idle capital:</span>
                <span className="font-mono text-text-primary">
                  {((Number(idle) / 10 ** decimals)).toLocaleString('en-US', { maximumFractionDigits: 0 })} {assetSymbol} ({idlePct.toFixed(1)}%)
                </span>
                <span className="text-text-tertiary">— consider allocating to earn yield</span>
              </div>
            </Card>
          );
        })()
      )}

      {/* ── Drawers ── */}
      <AddAdapterDrawer
        open={activeDrawer === 'add'}
        onClose={closeDrawer}
        chainId={chainId}
        vaultAddress={vaultAddress}
        vaultAsset={vault?.asset ?? ('0x0' as Address)}
        timelockSeconds={timelockSeconds}
      />

      <AllocateDrawer
        open={activeDrawer === 'allocate'}
        onClose={closeDrawer}
        adapter={selectedAdapter}
        vaultAddress={vaultAddress}
        idle={idle}
        decimals={decimals}
        assetSymbol={assetSymbol}
      />

      <DeallocateDrawer
        open={activeDrawer === 'deallocate'}
        onClose={closeDrawer}
        adapter={selectedAdapter}
        vaultAddress={vaultAddress}
        idle={idle}
        decimals={decimals}
        assetSymbol={assetSymbol}
      />

      <SetLiquidityDrawer
        open={activeDrawer === 'liquidity'}
        onClose={closeDrawer}
        adapters={adapters}
        currentLiquidityAdapter={liquidityAdapter}
        vaultAddress={vaultAddress}
        chainId={chainId}
        decimals={decimals}
        assetSymbol={assetSymbol}
      />

      <UpdateCapsDrawer
        open={activeDrawer === 'caps'}
        onClose={closeDrawer}
        adapter={selectedAdapter}
        vaultAddress={vaultAddress}
        timelockSeconds={timelockSeconds}
        decimals={decimals}
        assetSymbol={assetSymbol}
      />

      <RemoveAdapterDrawer
        open={activeDrawer === 'remove'}
        onClose={closeDrawer}
        adapter={selectedAdapter}
        vaultAddress={vaultAddress}
        timelockSeconds={timelockSeconds}
        decimals={decimals}
        assetSymbol={assetSymbol}
      />

      <SkimRewardsDrawer
        open={activeDrawer === 'skim'}
        onClose={closeDrawer}
        adapter={selectedAdapter}
        chainId={chainId}
      />
    </div>
  );
}
