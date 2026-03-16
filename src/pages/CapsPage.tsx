/**
 * Caps Management Page — dedicated view for managing all three levels of V2 caps.
 * Route: /vault/:chainId/:address/caps
 *
 * Shows three sections:
 * 1. Adapter-level caps
 * 2. Collateral-level caps (grouped by collateral token)
 * 3. Market-level caps (per adapter × market combination)
 */
import { useParams, useNavigate } from 'react-router-dom';
import type { Address } from 'viem';
import { ArrowLeft, Database } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { AddressDisplay } from '../components/ui/AddressDisplay';
import { SectionHeader } from '../components/ui/SectionHeader';
import { InlineCapEditor } from '../components/vault/adapters/InlineCapEditor';
import { useVaultInfo, useVaultRole } from '../lib/hooks/useVault';
import { useV2AdapterOverview } from '../lib/hooks/useV2Adapters';
import { formatTokenAmount, formatWadPercent } from '../lib/utils/format';
import { isUnlimitedCap } from '../lib/v2/adapterCapUtils';

export function CapsPage() {
  const { chainId: chainIdParam, address } = useParams<{ chainId: string; address: string }>();
  const navigate = useNavigate();
  const chainId = Number(chainIdParam);
  const vaultAddress = address as Address;

  const { data: vault, isLoading } = useVaultInfo(chainId, vaultAddress);
  const role = useVaultRole(chainId, vaultAddress);
  const { data: overview } = useV2AdapterOverview(chainId, vaultAddress, vault?.totalAssets);

  const canSetCaps = role.isCurator || role.isOwner;
  const decimals = vault?.assetInfo.decimals ?? 18;
  const assetSymbol = vault?.assetInfo.symbol ?? '';
  const totalAssets = vault?.totalAssets ?? 0n;
  const adapters = overview?.adapters ?? [];

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
      <div className="max-w-3xl mx-auto mt-8 space-y-4">
        <div className="animate-shimmer h-8 bg-bg-hover" />
        <div className="animate-shimmer h-48 bg-bg-hover" />
        <div className="animate-shimmer h-48 bg-bg-hover" />
      </div>
    );
  }

  if (vault?.version !== 'v2') {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <Card>
          <div className="p-6 text-center space-y-3">
            <p className="text-sm text-text-tertiary">Three-level caps are only available for V2 vaults.</p>
            <Button variant="ghost" onClick={() => navigate(`/vault/${chainId}/${vaultAddress}`)}>
              Return to Vault
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto mt-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/vault/${chainId}/${vaultAddress}?tab=adapters`)}
            className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <SectionHeader>Caps Management</SectionHeader>
          <Badge variant="info">V2</Badge>
        </div>
      </div>

      {!canSetCaps && (
        <div className="p-3 bg-warning/10 border border-warning/20 text-xs text-warning">
          Only the curator or owner can modify caps. You have read-only access.
        </div>
      )}

      {/* Section 1: Adapter-level caps */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-info" />
            <CardTitle>Adapter Caps</CardTitle>
            <Badge>{adapters.length}</Badge>
          </div>
        </CardHeader>
        {adapters.length === 0 ? (
          <p className="text-xs text-text-tertiary text-center py-4">No adapters configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-text-tertiary text-left">
                  <th className="px-3 py-2 font-medium">Adapter</th>
                  <th className="px-3 py-2 font-medium">Allocated</th>
                  <th className="px-3 py-2 font-medium">Absolute Cap</th>
                  <th className="px-3 py-2 font-medium">Relative Cap</th>
                  <th className="px-3 py-2 font-medium">Usage</th>
                </tr>
              </thead>
              <tbody>
                {adapters.map((a) => {
                  const usagePct = a.absoluteCap > 0n && !isUnlimitedCap(a.absoluteCap)
                    ? (Number(a.allocationOnChain) / Number(a.absoluteCap) * 100)
                    : 0;
                  return (
                    <tr key={a.address} className="border-b border-border-subtle hover:bg-bg-hover">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <AddressDisplay address={a.address} chainId={chainId} />
                          {a.name && <span className="text-text-secondary">{a.name}</span>}
                          {a.isLiquidityAdapter && <Badge variant="purple">Liq</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-text-primary">
                        {formatTokenAmount(a.realAssets, decimals)} {assetSymbol}
                      </td>
                      <td className="px-3 py-2.5">
                        {canSetCaps ? (
                          <InlineCapEditor
                            vaultAddress={vaultAddress}
                            idData={a.adapterId}
                            currentValue={a.absoluteCap}
                            type="absolute"
                            decimals={decimals}
                            assetSymbol={assetSymbol}
                          />
                        ) : (
                          <span className="font-mono text-text-primary">
                            {isUnlimitedCap(a.absoluteCap) ? 'Unlimited' : formatTokenAmount(a.absoluteCap, decimals)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {canSetCaps ? (
                          <InlineCapEditor
                            vaultAddress={vaultAddress}
                            idData={a.adapterId}
                            currentValue={a.relativeCap}
                            type="relative"
                            decimals={decimals}
                            assetSymbol={assetSymbol}
                          />
                        ) : (
                          <span className="font-mono text-text-primary">
                            {formatWadPercent(a.relativeCap)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {!isUnlimitedCap(a.absoluteCap) && a.absoluteCap > 0n ? (
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1 bg-bg-active overflow-hidden">
                              <div
                                className="h-full bg-accent-primary"
                                style={{ width: `${Math.min(usagePct, 100)}%` }}
                              />
                            </div>
                            <span className="font-mono text-text-tertiary">{usagePct.toFixed(1)}%</span>
                          </div>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Section 2: Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="!p-3">
          <span className="text-[10px] text-text-tertiary uppercase">Total Allocated</span>
          <p className="text-sm font-mono text-text-primary mt-1">
            {formatTokenAmount(
              adapters.reduce((sum, a) => sum + a.realAssets, 0n),
              decimals,
            )} {assetSymbol}
          </p>
        </Card>
        <Card className="!p-3">
          <span className="text-[10px] text-text-tertiary uppercase">Idle</span>
          <p className="text-sm font-mono text-text-primary mt-1">
            {formatTokenAmount(overview?.idle ?? 0n, decimals)} {assetSymbol}
          </p>
        </Card>
        <Card className="!p-3">
          <span className="text-[10px] text-text-tertiary uppercase">Total Assets</span>
          <p className="text-sm font-mono text-text-primary mt-1">
            {formatTokenAmount(totalAssets, decimals)} {assetSymbol}
          </p>
        </Card>
      </div>
    </div>
  );
}
