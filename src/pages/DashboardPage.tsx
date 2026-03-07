import { useState } from 'react';
import { useAccount } from 'wagmi';
import { isAddress } from 'viem';
import { VaultCard } from '../components/vault/VaultCard';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { PortfolioSummary } from '../components/dashboard/PortfolioSummary';
import { AlertsFeed } from '../components/dashboard/AlertsFeed';
import { QuickActions } from '../components/dashboard/QuickActions';
import { PendingActions } from '../components/dashboard/PendingActions';
import { useAppStore } from '../store/appStore';
import { useDashboardVaults, useDashboardPendingActions } from '../lib/hooks/useDashboard';
import { getSupportedChainIds, getChainConfig, SEI_KNOWN_VAULTS } from '../config/chains';

export function DashboardPage() {
  const { address } = useAccount();
  const { trackedVaults, addTrackedVault, alerts, dismissAlert, clearAlerts } = useAppStore();
  const { data: vaultSummaries } = useDashboardVaults();
  const { data: pendingActionsList } = useDashboardPendingActions();
  const [showAddVault, setShowAddVault] = useState(false);
  const [newVaultAddress, setNewVaultAddress] = useState('');
  const [newVaultChainId, setNewVaultChainId] = useState(getSupportedChainIds()[0]);

  const handleAddVault = () => {
    if (!isAddress(newVaultAddress)) return;
    addTrackedVault({
      address: newVaultAddress,
      chainId: newVaultChainId,
      name: `Vault ${newVaultAddress.slice(0, 8)}...`,
      version: 'v1',
    });
    setNewVaultAddress('');
    setShowAddVault(false);
  };

  const handleAddKnownVault = (key: string) => {
    const vault = SEI_KNOWN_VAULTS[key];
    if (!vault) return;
    addTrackedVault({
      address: vault.address,
      chainId: 1329,
      name: vault.name,
      version: 'v1',
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Curator Dashboard</h1>
          <p className="text-sm text-text-tertiary mt-0.5">
            {address
              ? `Connected: ${address.slice(0, 6)}...${address.slice(-4)}`
              : 'Connect wallet to see your vaults'}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowAddVault(!showAddVault)}
        >
          + Track Vault
        </Button>
      </div>

      {/* Portfolio Summary */}
      {vaultSummaries && vaultSummaries.length > 0 && (
        <PortfolioSummary vaults={vaultSummaries} />
      )}

      {/* Quick Actions + Alerts side by side on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <QuickActions onTrackVault={() => setShowAddVault(true)} />
        <AlertsFeed
          alerts={alerts}
          onDismiss={dismissAlert}
          onClearAll={clearAlerts}
        />
      </div>

      {/* Pending Timelocked Actions */}
      <PendingActions actions={pendingActionsList ?? []} />

      {/* Add Vault Form */}
      {showAddVault && (
        <Card>
          <CardHeader>
            <CardTitle>Track a Vault</CardTitle>
          </CardHeader>
          <div className="space-y-3">
            <div className="flex gap-3">
              <select
                value={newVaultChainId}
                onChange={(e) => setNewVaultChainId(Number(e.target.value))}
                className="bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary"
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
                placeholder="Vault address (0x...)"
                value={newVaultAddress}
                onChange={(e) => setNewVaultAddress(e.target.value)}
                className="flex-1 bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary placeholder-text-tertiary"
              />
              <Button size="sm" onClick={handleAddVault}>
                Add
              </Button>
            </div>

            {/* Quick add known vaults */}
            <div>
              <p className="text-xs text-text-tertiary mb-2">Known vaults on SEI:</p>
              <div className="flex gap-2">
                {Object.entries(SEI_KNOWN_VAULTS).map(([key, vault]) => (
                  <Button
                    key={key}
                    variant="ghost"
                    size="sm"
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

      {/* Vault Grid */}
      {trackedVaults.length === 0 ? (
        <Card className="py-12 text-center">
          <p className="text-text-tertiary text-sm">
            No vaults tracked yet. Add a vault address above to get started.
          </p>
          <p className="text-text-tertiary text-xs mt-2">
            Or click "Track Vault" and add the Feather USDC vault on SEI to explore.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {trackedVaults.map((v) => (
            <VaultCard
              key={`${v.chainId}-${v.address}`}
              chainId={v.chainId}
              vaultAddress={v.address}
            />
          ))}
        </div>
      )}
    </div>
  );
}
