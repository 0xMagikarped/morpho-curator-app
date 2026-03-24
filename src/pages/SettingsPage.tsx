import { useState } from 'react';
import { isAddress, type Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { useAppStore } from '../store/appStore';
import { CHAIN_CONFIGS } from '../config/chains';
import { truncateAddress } from '../lib/utils/format';
import { clearAllMarketData } from '../lib/indexer/indexedDB';
import { fetchVaultPreview } from '../lib/data/rpcClient';

export function SettingsPage() {
  const trackedVaults = useAppStore((s) => s.trackedVaults);
  const addTrackedVault = useAppStore((s) => s.addTrackedVault);
  const removeTrackedVault = useAppStore((s) => s.removeTrackedVault);
  const customRpcUrls = useAppStore((s) => s.customRpcUrls);
  const setCustomRpcUrl = useAppStore((s) => s.setCustomRpcUrl);
  const clearAlerts = useAppStore((s) => s.clearAlerts);

  const [rpcInputs, setRpcInputs] = useState<Record<number, string>>(customRpcUrls);
  const [showAddVault, setShowAddVault] = useState(false);

  const handleSaveRpc = (chainId: number) => {
    const url = rpcInputs[chainId];
    if (url) setCustomRpcUrl(chainId, url);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-lg font-bold text-text-primary">Settings</h1>

      {/* Tracked Vaults */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Tracked Vaults</CardTitle>
            <Badge>{trackedVaults.length}</Badge>
          </div>
          <Button size="sm" onClick={() => setShowAddVault(true)}>
            + Add Vault
          </Button>
        </CardHeader>
        {trackedVaults.length === 0 ? (
          <p className="text-sm text-text-tertiary">No vaults tracked.</p>
        ) : (
          <div className="space-y-2">
            {trackedVaults.map((v) => (
              <div
                key={`${v.chainId}-${v.address}`}
                className="flex items-center justify-between py-2 px-3 bg-bg-hover/30"
              >
                <div>
                  <p className="text-sm text-text-primary">{v.name}</p>
                  <p className="text-xs text-text-tertiary font-mono">
                    {truncateAddress(v.address)} ({v.version.toUpperCase()}, Chain {v.chainId})
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeTrackedVault(v.address, v.chainId)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add Vault Dialog */}
      {showAddVault && (
        <AddVaultDialog
          onAdd={(vault) => {
            addTrackedVault(vault);
            setShowAddVault(false);
          }}
          onClose={() => setShowAddVault(false)}
          existingVaults={trackedVaults}
        />
      )}

      {/* Custom RPC URLs */}
      <Card>
        <CardHeader>
          <CardTitle>RPC Configuration</CardTitle>
        </CardHeader>
        <p className="text-xs text-text-tertiary mb-3">
          Override default RPC endpoints per chain. Useful for private RPC nodes
          or when default endpoints are rate-limited.
        </p>
        <div className="space-y-3">
          {Object.entries(CHAIN_CONFIGS).map(([idStr, config]) => {
            const chainId = parseInt(idStr);
            return (
              <div key={chainId} className="space-y-1">
                <label className="text-xs text-text-secondary">
                  {config.name} (Chain {chainId})
                  {!config.apiSupported && (
                    <span className="text-warning ml-2">RPC-only chain</span>
                  )}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={rpcInputs[chainId] ?? config.rpcUrls[0]}
                    onChange={(e) =>
                      setRpcInputs({ ...rpcInputs, [chainId]: e.target.value })
                    }
                    className="flex-1 bg-bg-hover border border-border-default px-3 py-1.5 text-xs text-text-primary font-mono"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleSaveRpc(chainId)}
                  >
                    Save
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Chain Verification Status */}
      <Card>
        <CardHeader>
          <CardTitle>Chain Verification</CardTitle>
        </CardHeader>
        <div className="space-y-2">
          {Object.entries(CHAIN_CONFIGS).map(([idStr, config]) => (
            <div
              key={idStr}
              className="flex items-center justify-between py-2 px-3 bg-bg-hover/20 text-sm"
            >
              <span className="text-text-primary">{config.name}</span>
              <div className="flex gap-2">
                <Badge variant={config.verified ? 'success' : 'warning'}>
                  {config.verified ? 'Verified' : 'Unverified'}
                </Badge>
                <Badge variant={config.apiSupported ? 'success' : 'default'}>
                  {config.apiSupported ? 'API' : 'RPC'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Clear Data */}
      <Card>
        <CardHeader>
          <CardTitle>Data Management</CardTitle>
        </CardHeader>
        <div className="flex gap-3">
          <Button variant="secondary" size="sm" onClick={clearAlerts}>
            Clear All Alerts
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => clearAllMarketData()}
          >
            Clear Market Cache
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// Add Vault Dialog
// ============================================================

import type { TrackedVault } from '../store/appStore';

function AddVaultDialog({
  onAdd,
  onClose,
  existingVaults,
}: {
  onAdd: (vault: TrackedVault) => void;
  onClose: () => void;
  existingVaults: TrackedVault[];
}) {
  const [address, setAddress] = useState('');
  const [chainId, setChainId] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; version: string } | null>(null);

  const chainOptions = Object.entries(CHAIN_CONFIGS).map(([id, config]) => ({
    id: parseInt(id),
    name: config.name,
  }));

  const handleLookup = async () => {
    setError(null);
    setPreview(null);

    if (!isAddress(address)) {
      setError('Invalid address');
      return;
    }

    const alreadyTracked = existingVaults.some(
      (v) => v.address.toLowerCase() === address.toLowerCase() && v.chainId === chainId,
    );
    if (alreadyTracked) {
      setError('This vault is already tracked');
      return;
    }

    setLoading(true);
    try {
      const result = await fetchVaultPreview(chainId, address as Address);
      setPreview(result);
    } catch (err) {
      setError((err as Error).message || 'Failed to fetch vault info');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    if (!preview) return;
    onAdd({
      address: address as Address,
      chainId,
      name: preview.name,
      version: preview.version as 'v1' | 'v2',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-bg-surface border border-border-default w-full max-w-md p-5 space-y-4">
        <h2 className="text-sm font-display text-text-primary">Add Vault to Track</h2>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Chain</label>
            <select
              value={chainId}
              onChange={(e) => { setChainId(parseInt(e.target.value)); setPreview(null); setError(null); }}
              className="w-full bg-bg-hover border border-border-subtle px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-border-focus"
            >
              {chainOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-text-secondary mb-1 block">Vault Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => { setAddress(e.target.value); setPreview(null); setError(null); }}
              placeholder="0x..."
              className="w-full bg-bg-hover border border-border-subtle px-3 py-2 text-xs text-text-primary font-mono placeholder-text-tertiary focus:outline-none focus:border-border-focus"
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          {preview && (
            <div className="bg-bg-hover/50 border border-border-subtle p-3 space-y-1">
              <p className="text-sm text-text-primary font-medium">{preview.name}</p>
              <p className="text-xs text-text-tertiary font-mono">
                {truncateAddress(address as Address)} &middot; {preview.version.toUpperCase()} &middot; {CHAIN_CONFIGS[chainId]?.name ?? `Chain ${chainId}`}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border-subtle">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          {preview ? (
            <Button size="sm" onClick={handleAdd}>Track Vault</Button>
          ) : (
            <Button size="sm" onClick={handleLookup} disabled={!address || loading} loading={loading}>
              {loading ? 'Looking up...' : 'Look Up'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
