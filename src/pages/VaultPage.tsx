import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { Address } from 'viem';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { OverviewTab } from '../components/vault/OverviewTab';
import { MarketsTab } from '../components/vault/MarketsTab';
import { CapsTab } from '../components/vault/CapsTab';
import { ReallocateTab } from '../components/vault/ReallocateTab';
import { GuardianTab } from '../components/vault/GuardianTab';
import { V2AdaptersTab } from '../components/vault/V2AdaptersTab';
import { V2SecurityTab } from '../components/vault/V2SecurityTab';
import { useVaultInfo, useVaultRole } from '../lib/hooks/useVault';
import { useAppStore } from '../store/appStore';
import { cn } from '../lib/utils/cn';
import { getEmergencyRoleLabel } from '../types';

type TabId = 'overview' | 'markets' | 'caps' | 'adapters' | 'reallocate' | 'guardian' | 'security';

interface TabDef {
  id: TabId;
  label: string;
  v2Label?: string;
  requiresRole?: keyof ReturnType<typeof useVaultRole>;
  v1Only?: boolean;
  v2Only?: boolean;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'markets', label: 'Markets' },
  { id: 'caps', label: 'Caps', requiresRole: 'isCurator' },
  { id: 'adapters', label: 'Adapters', v2Only: true },
  { id: 'reallocate', label: 'Reallocate', requiresRole: 'isAllocator' },
  { id: 'guardian', label: 'Guardian', requiresRole: 'isEmergencyRole', v1Only: true },
  { id: 'security', label: 'Security', requiresRole: 'isEmergencyRole', v2Only: true },
];

export function VaultPage() {
  const { chainId: chainIdStr, address } = useParams<{ chainId: string; address: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const VALID_TABS: TabId[] = ['overview', 'markets', 'caps', 'adapters', 'reallocate', 'guardian', 'security'];
  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'overview';

  const setActiveTab = (tab: TabId) => {
    setSearchParams(tab === 'overview' ? {} : { tab });
  };

  const chainId = chainIdStr ? parseInt(chainIdStr) : undefined;
  const vaultAddress = address as Address | undefined;

  const { data: vault, isLoading, error } = useVaultInfo(chainId, vaultAddress);
  const role = useVaultRole(chainId, vaultAddress);
  const { addTrackedVault } = useAppStore();

  if (!chainId || !vaultAddress) {
    return (
      <div className="text-center py-12">
        <p className="text-text-tertiary">Invalid vault URL.</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate('/')}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  if (error && !vault) {
    return (
      <div className="max-w-6xl mx-auto text-center py-12 space-y-3">
        <p className="text-danger text-sm">Failed to load vault</p>
        <p className="text-text-tertiary text-xs font-mono">{vaultAddress}</p>
        <p className="text-text-tertiary text-xs">{error instanceof Error ? error.message : 'RPC call failed — the vault may not exist on this chain, or the RPC endpoint is unavailable.'}</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate('/')}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  const isV2 = vault?.version === 'v2';

  const handleTrack = () => {
    if (vault) {
      addTrackedVault({
        address: vaultAddress,
        chainId,
        name: vault.name,
        version: vault.version,
      });
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Vault Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            aria-label="Back to dashboard"
            className="text-text-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
          >
            &larr;
          </button>
          <h1 className="text-lg font-bold text-text-primary">
            {vault?.name ?? (isLoading ? 'Loading...' : 'Vault')}
          </h1>
          {vault && (
            <div className="flex gap-1.5">
              <Badge variant="info">{chainId}</Badge>
              <Badge>{vault.version.toUpperCase()}</Badge>
              {role.isOwner && <Badge variant="purple">Owner</Badge>}
              {role.isCurator && <Badge variant="purple">Curator</Badge>}
              {role.isAllocator && <Badge variant="purple">Allocator</Badge>}
              {role.isEmergencyRole && vault && (
                <Badge variant="purple">
                  {getEmergencyRoleLabel(vault.version)}
                </Badge>
              )}
            </div>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={handleTrack}>
          Track Vault
        </Button>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-border-subtle">
        {TABS.map((tab) => {
          if (tab.v2Only && !isV2) return null;
          if (tab.v1Only && isV2) return null;

          const label = isV2 && tab.v2Label ? tab.v2Label : tab.label;
          const hasAccess =
            !tab.requiresRole ||
            role[tab.requiresRole] ||
            role.isOwner;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary',
                activeTab === tab.id
                  ? 'text-text-primary border-accent-primary'
                  : hasAccess
                    ? 'text-text-secondary border-transparent hover:text-text-primary'
                    : 'text-text-tertiary border-transparent cursor-not-allowed',
              )}
              disabled={!hasAccess}
              title={!hasAccess ? `Requires ${tab.requiresRole} role` : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && (
          <OverviewTab chainId={chainId} vaultAddress={vaultAddress} />
        )}
        {activeTab === 'markets' && (
          <MarketsTab chainId={chainId} vaultAddress={vaultAddress} />
        )}
        {activeTab === 'caps' && (
          <CapsTab chainId={chainId} vaultAddress={vaultAddress} />
        )}
        {activeTab === 'reallocate' && (
          <ReallocateTab chainId={chainId} vaultAddress={vaultAddress} />
        )}
        {activeTab === 'adapters' && isV2 && (
          <V2AdaptersTab chainId={chainId} vaultAddress={vaultAddress} />
        )}
        {activeTab === 'guardian' && !isV2 && (
          <GuardianTab chainId={chainId} vaultAddress={vaultAddress} />
        )}
        {activeTab === 'security' && isV2 && (
          <V2SecurityTab chainId={chainId} vaultAddress={vaultAddress} />
        )}
      </div>
    </div>
  );
}
