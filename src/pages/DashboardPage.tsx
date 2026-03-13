import { useState, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { isAddress, formatUnits } from 'viem';
import { Plus, Vault } from 'lucide-react';
import { VaultCard } from '../components/vault/VaultCard';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ChainBadge } from '../components/ui/ChainBadge';
import { StatCard } from '../components/dashboard/StatCard';
import { AllocationBar } from '../components/dashboard/AllocationBar';
import { ActivityFeed, type ActivityEvent } from '../components/dashboard/ActivityFeed';
import { PendingActions } from '../components/dashboard/PendingActions';
import { RiskAlertBanner } from '../components/risk/RiskAlertBanner';
import { ManagedVaultsBanner } from '../components/dashboard/ManagedVaultsBanner';
import { useAppStore } from '../store/appStore';
import { useDashboardVaults, useDashboardPendingActions } from '../lib/hooks/useDashboard';
import { getSupportedChainIds, getChainConfig, SEI_KNOWN_VAULTS } from '../config/chains';
import { formatUsd } from '../lib/utils/format';
import type { RiskAlert } from '../lib/risk/riskTypes';

export function DashboardPage() {
  const { address } = useAccount();
  const trackedVaults = useAppStore((s) => s.trackedVaults);
  const addTrackedVault = useAppStore((s) => s.addTrackedVault);
  const persistToEdgeConfig = useAppStore((s) => s.persistToEdgeConfig);
  const { data: vaultSummaries, isLoading: vaultsLoading } = useDashboardVaults();
  const { data: pendingActionsList } = useDashboardPendingActions();
  const [showAddVault, setShowAddVault] = useState(false);
  const [newVaultAddress, setNewVaultAddress] = useState('');
  const [newVaultChainId, setNewVaultChainId] = useState(getSupportedChainIds()[0]);

  // Compute aggregate stats
  const stats = useMemo(() => {
    if (!vaultSummaries || vaultSummaries.length === 0) {
      return { tvl: 0, vaultCount: 0, marketCount: 0, pendingCount: 0 };
    }
    // Approximate TVL in USD — for tokens with 6 decimals (USDC/USDT) or 18 decimals (ETH-like)
    let tvlUsd = 0;
    for (const v of vaultSummaries) {
      // Heuristic: if TVL raw is > 1e15, it's likely 18-decimal (ETH scale)
      // Otherwise assume 6-decimal (USDC scale)
      const tvlFloat = v.tvl > 10n ** 15n
        ? Number(formatUnits(v.tvl, 18))
        : Number(formatUnits(v.tvl, 6));
      tvlUsd += tvlFloat;
    }
    return {
      tvl: tvlUsd,
      vaultCount: vaultSummaries.length,
      marketCount: vaultSummaries.reduce((s, v) => s + v.supplyQueueLength, 0),
      pendingCount: pendingActionsList?.length ?? 0,
    };
  }, [vaultSummaries, pendingActionsList]);

  // Build risk alerts from vault data
  const riskAlerts = useMemo<RiskAlert[]>(() => {
    if (!vaultSummaries) return [];
    const now = Date.now();
    const out: RiskAlert[] = [];
    for (const v of vaultSummaries) {
      // Flag vaults with high idle ratio (>50% idle)
      if (v.tvl > 0n && v.supplyQueueLength === 0) {
        out.push({
          id: `no-queue-${v.address}`,
          severity: 'warning',
          type: 'utilization_high',
          title: `${v.name} has no supply queue`,
          description: 'Vault may not be allocating',
          chainId: v.chainId,
          timestamp: now,
        });
      }
    }
    return out;
  }, [vaultSummaries]);

  // Allocation segments for the bar
  const allocationSegments = useMemo(() => {
    if (!vaultSummaries || vaultSummaries.length === 0) return [];
    const total = vaultSummaries.reduce((s, v) => {
      const f = v.tvl > 10n ** 15n
        ? Number(formatUnits(v.tvl, 18))
        : Number(formatUnits(v.tvl, 6));
      return s + f;
    }, 0);
    if (total === 0) return [];
    return vaultSummaries.map((v) => {
      const value = v.tvl > 10n ** 15n
        ? Number(formatUnits(v.tvl, 18))
        : Number(formatUnits(v.tvl, 6));
      return {
        name: v.name,
        value,
        percentage: (value / total) * 100,
        formattedValue: formatUsd(value),
      };
    });
  }, [vaultSummaries]);

  // Placeholder activity events (real implementation would fetch from indexer)
  const activityEvents: ActivityEvent[] = [];

  const handleAddVault = () => {
    if (!isAddress(newVaultAddress)) return;
    const vault = {
      address: newVaultAddress,
      chainId: newVaultChainId,
      name: `Vault ${newVaultAddress.slice(0, 8)}...`,
      version: 'v1' as const,
    };
    addTrackedVault(vault);
    if (address) persistToEdgeConfig(address);
    setNewVaultAddress('');
    setShowAddVault(false);
  };

  const handleAddKnownVault = (key: string) => {
    const vault = SEI_KNOWN_VAULTS[key];
    if (!vault) return;
    const tracked = {
      address: vault.address,
      chainId: 1329,
      name: vault.name,
      version: 'v1' as const,
    };
    addTrackedVault(tracked);
    if (address) persistToEdgeConfig(address);
  };

  const isLoadingStats = vaultsLoading && trackedVaults.length > 0;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-text-primary">Curator Dashboard</h1>
          {address && (
            <span className="text-xs font-mono text-text-tertiary">
              {address.slice(0, 6)}...{address.slice(-4)}
            </span>
          )}
          {trackedVaults.length > 0 && (
            <div className="flex gap-1">
              {[...new Set(trackedVaults.map((v) => v.chainId))].map((id) => (
                <ChainBadge key={id} chainId={id} />
              ))}
            </div>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowAddVault(!showAddVault)}
        >
          <Plus size={14} className="mr-1" />
          Track Vault
        </Button>
      </div>

      {/* ── STATS BAR ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <StatCard
          label="Total TVL"
          value={formatUsd(stats.tvl)}
          loading={isLoadingStats}
        />
        <StatCard
          label="Active Vaults"
          value={stats.vaultCount.toString()}
          loading={isLoadingStats}
        />
        <StatCard
          label="Total Markets"
          value={stats.marketCount.toString()}
          loading={isLoadingStats}
        />
        <StatCard
          label="Pending Actions"
          value={stats.pendingCount.toString()}
          loading={isLoadingStats}
        />
      </div>

      {/* Hatch divider */}
      <div className="hatch h-6 w-full border-y border-border-default my-4" />

      {/* ── AUTO-DETECT MANAGED VAULTS ── */}
      <ManagedVaultsBanner />

      {/* ── RISK ALERTS ── */}
      <RiskAlertBanner alerts={riskAlerts} />

      {/* ── ADD VAULT FORM ── */}
      {showAddVault && (
        <Card className="!p-3">
          <CardHeader className="!mb-2">
            <CardTitle>Track a Vault</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            <div className="flex gap-2">
              <select
                value={newVaultChainId}
                onChange={(e) => setNewVaultChainId(Number(e.target.value))}
                className="bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-text-primary font-mono"
              >
                {getSupportedChainIds().map((id) => {
                  const cfg = getChainConfig(id);
                  return (
                    <option key={id} value={id}>
                      {cfg?.name ?? `Chain ${id}`}
                    </option>
                  );
                })}
              </select>
              <input
                type="text"
                placeholder="0x..."
                value={newVaultAddress}
                onChange={(e) => setNewVaultAddress(e.target.value)}
                className="flex-1 bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-text-primary font-mono placeholder-text-tertiary min-w-0"
              />
              <Button size="sm" onClick={handleAddVault}>
                Add
              </Button>
            </div>
            <div>
              <p className="text-[10px] text-text-tertiary mb-1">Quick add:</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(SEI_KNOWN_VAULTS).map(([key, vault]) => (
                  <Button
                    key={key}
                    variant="ghost"
                    size="sm"
                    className="text-[11px]"
                    onClick={() => handleAddKnownVault(key)}
                  >
                    + {vault.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── EMPTY STATE ── */}
      {trackedVaults.length === 0 ? (
        <Card className="py-12 text-center">
          <div className="flex flex-col items-center gap-3">
            <Vault size={32} className="text-text-tertiary" />
            <div>
              <p className="text-text-secondary text-sm">No vaults tracked yet</p>
              <p className="text-text-tertiary text-xs mt-1">
                Add a vault address above or click "Track Vault" to get started.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowAddVault(true)}
            >
              <Plus size={14} className="mr-1" />
              Track Your First Vault
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {/* ── MAIN CONTENT GRID ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left column: Allocation + Vault Cards */}
            <div className="lg:col-span-2 space-y-4">
              {/* Allocation Bar */}
              {allocationSegments.length > 0 && (
                <Card className="!p-3">
                  <CardHeader className="!mb-2">
                    <CardTitle>Capital Allocation</CardTitle>
                    <Badge>{trackedVaults.length} vault{trackedVaults.length !== 1 ? 's' : ''}</Badge>
                  </CardHeader>
                  <AllocationBar segments={allocationSegments} />
                </Card>
              )}

              {/* Vault Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {trackedVaults.map((v) => (
                  <VaultCard
                    key={`${v.chainId}-${v.address}`}
                    chainId={v.chainId}
                    vaultAddress={v.address}
                  />
                ))}
              </div>
            </div>

            {/* Right column: Pending + Activity */}
            <div className="space-y-4">
              <PendingActions actions={pendingActionsList ?? []} />
              <ActivityFeed events={activityEvents} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
