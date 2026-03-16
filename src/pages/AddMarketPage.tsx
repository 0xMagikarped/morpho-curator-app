/**
 * Page for the Add Market wizard — reached from V2 vault's Adapters tab.
 * Route: /vault/:chainId/:address/add-market
 *
 * Detects existing Market V1 Adapter on the vault. If one exists, the wizard
 * skips the deploy step and goes straight to market selection + cap configuration.
 */
import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Address } from 'viem';
import { Lock } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { AddMarketWizard } from '../components/vault/adapters/AddMarketWizard';
import { useVaultInfo, useVaultRole, useVaultMarketsFromApi } from '../lib/hooks/useVault';
import { useV2AdapterOverview } from '../lib/hooks/useV2Adapters';

export function AddMarketPage() {
  const { chainId: chainIdParam, address } = useParams<{ chainId: string; address: string }>();
  const navigate = useNavigate();
  const chainId = Number(chainIdParam);
  const vaultAddress = address as Address;

  const { data: vault, isLoading } = useVaultInfo(chainId, vaultAddress);
  const role = useVaultRole(chainId, vaultAddress);
  const { data: markets } = useVaultMarketsFromApi(chainId, vaultAddress);
  const { data: overview } = useV2AdapterOverview(chainId, vaultAddress, vault?.totalAssets);

  const canAddMarket = role.isCurator || role.isOwner;

  const existingMarketIds = useMemo(() => {
    if (!markets) return new Set<string>();
    return new Set(markets.map((m) => m.id));
  }, [markets]);

  // Find existing market adapter — the first adapter of type market-v1
  // In the "one adapter per vault" model, there should be at most one.
  const existingMarketAdapter = useMemo(() => {
    if (!overview?.adapters) return null;
    // Look for a market adapter (has MORPHO() view function → detected as market-v1)
    // For now, return the first adapter — the overview enrichment already fetches adapters
    // A more robust approach would check adapter type, but adapters on V2 are typically
    // all market adapters unless explicitly a vault adapter.
    // TODO: Filter by detected adapter type once AdapterDetailView detection is integrated
    return overview.adapters.length > 0 ? overview.adapters[0].address : null;
  }, [overview]);

  if (!chainId || !vaultAddress) {
    return (
      <div className="text-center py-12">
        <p className="text-text-tertiary">Invalid vault URL.</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate('/')}>Back to Dashboard</Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto mt-8 space-y-4">
        <div className="animate-shimmer h-8 bg-bg-hover" />
        <div className="animate-shimmer h-64 bg-bg-hover" />
      </div>
    );
  }

  if (vault?.version !== 'v2') {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <Card>
          <div className="p-6 text-center space-y-3">
            <p className="text-sm text-text-tertiary">Market adapters are only available for V2 vaults.</p>
            <Button variant="ghost" onClick={() => navigate(`/vault/${chainId}/${vaultAddress}`)}>
              Return to Vault
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!canAddMarket) {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <Card>
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-text-tertiary" />
              <h1 className="text-lg font-bold text-text-primary">Add Market</h1>
            </div>
            <p className="text-sm text-text-tertiary">
              Only the vault curator or owner can add market adapters.
            </p>
            <Button variant="ghost" className="w-full" onClick={() => navigate(`/vault/${chainId}/${vaultAddress}?tab=adapters`)}>
              Return to Adapters
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto mt-8">
      <AddMarketWizard
        chainId={chainId}
        vaultAddress={vaultAddress}
        vaultAsset={vault.asset}
        assetSymbol={vault.assetInfo.symbol}
        assetDecimals={vault.assetInfo.decimals}
        idle={overview?.idle ?? 0n}
        existingAdapter={existingMarketAdapter}
        existingMarketIds={existingMarketIds}
        onComplete={() => navigate(`/vault/${chainId}/${vaultAddress}?tab=adapters`)}
        onBack={() => navigate(`/vault/${chainId}/${vaultAddress}?tab=adapters`)}
      />
    </div>
  );
}
