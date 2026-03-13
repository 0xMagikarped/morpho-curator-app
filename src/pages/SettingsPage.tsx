import { useState } from 'react';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { useAppStore } from '../store/appStore';
import { CHAIN_CONFIGS } from '../config/chains';
import { truncateAddress } from '../lib/utils/format';
import { clearAllMarketData } from '../lib/indexer/indexedDB';

export function SettingsPage() {
  const trackedVaults = useAppStore((s) => s.trackedVaults);
  const removeTrackedVault = useAppStore((s) => s.removeTrackedVault);
  const customRpcUrls = useAppStore((s) => s.customRpcUrls);
  const setCustomRpcUrl = useAppStore((s) => s.setCustomRpcUrl);
  const clearAlerts = useAppStore((s) => s.clearAlerts);

  const [rpcInputs, setRpcInputs] = useState<Record<number, string>>(customRpcUrls);

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
          <CardTitle>Tracked Vaults</CardTitle>
          <Badge>{trackedVaults.length}</Badge>
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
