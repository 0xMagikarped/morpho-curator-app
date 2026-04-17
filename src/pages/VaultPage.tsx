import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { Address } from 'viem';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { OverviewTab } from '../components/vault/OverviewTab';
import { MarketsTab } from '../components/vault/MarketsTab';
import { CapsTab } from '../components/vault/CapsTab';
import { ReallocateTab } from '../components/vault/ReallocateTab';
import { GuardianTab } from '../components/vault/GuardianTab';
import { ProtocolTab } from '../components/vault/ProtocolTab';
import { V2AdaptersTab } from '../components/vault/V2AdaptersTab';
import { V2SecurityTab } from '../components/vault/V2SecurityTab';
import { V2AllocationTab } from '../components/vault/V2AllocationTab';
import { QueuesTab } from '../components/vault/QueuesTab';
import { useVaultInfo, useVaultRole } from '../lib/hooks/useVault';
import { useVaultPermissions } from '../hooks/useVaultPermissions';
import { isApiSupportedChain } from '../lib/data/morphoApi';
import { useAppStore } from '../store/appStore';
import { cn } from '../lib/utils/cn';
import { getEmergencyRoleLabel } from '../types';
import { formatApyDisplay, getApyColorClass } from '../lib/utils/format';
import { isChainDeployed, getChainConfig } from '../config/chains';
import { ProtocolChip } from '../components/ui/ProtocolChip';
import { useVaultFlavor } from '../lib/vault/flavor';
import { useIsVaultBlacklisted } from '../lib/hooks/useMoolahSingleton';
import { Lock } from 'lucide-react';

type TabId = 'overview' | 'markets' | 'caps' | 'adapters' | 'allocation' | 'queues' | 'reallocate' | 'guardian' | 'security' | 'protocol';

interface TabDef {
  id: TabId;
  label: string;
  v2Label?: string;
  requiresRole?: keyof ReturnType<typeof useVaultRole>;
  v1Only?: boolean;
  v2Only?: boolean;
  /** Only render on chains whose `protocol` field matches one of these values. */
  protocols?: Array<'morpho' | 'moolah'>;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'markets', label: 'Markets' },
  // Caps is always visible — allocators need to see caps for reallocation
  // limits, and any role can accept pending caps after timelock. Write
  // buttons inside are gated by permissions.canCurate.
  { id: 'caps', label: 'Caps' },
  { id: 'adapters', label: 'Adapters', v2Only: true },
  { id: 'allocation', label: 'Allocation', v2Only: true },
  { id: 'queues', label: 'Queues', requiresRole: 'isAllocator', v1Only: true },
  { id: 'reallocate', label: 'Reallocate', requiresRole: 'isAllocator', v1Only: true },
  { id: 'guardian', label: 'Guardian', requiresRole: 'isEmergencyRole', v1Only: true },
  { id: 'security', label: 'Security', requiresRole: 'isEmergencyRole', v2Only: true },
  { id: 'protocol', label: 'Protocol', protocols: ['moolah'] },
];

export function VaultPage() {
  const { chainId: chainIdStr, address } = useParams<{ chainId: string; address: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const VALID_TABS: TabId[] = ['overview', 'markets', 'caps', 'adapters', 'allocation', 'queues', 'reallocate', 'guardian', 'security', 'protocol'];
  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId = tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'overview';

  const setActiveTab = (tab: TabId) => {
    setSearchParams(tab === 'overview' ? {} : { tab });
  };

  const chainId = chainIdStr ? parseInt(chainIdStr) : undefined;
  const vaultAddress = address as Address | undefined;

  const { data: vault, isLoading, error, dataSource } = useVaultInfo(chainId, vaultAddress);
  const role = useVaultRole(chainId, vaultAddress);
  const permissions = useVaultPermissions(chainId, vaultAddress);
  const { data: vaultFlavor } = useVaultFlavor(chainId, vaultAddress);
  const { data: isBlacklisted } = useIsVaultBlacklisted(chainId, vaultAddress);
  const chainConfig = chainId ? getChainConfig(chainId) : undefined;
  const trackedVaults = useAppStore((s) => s.trackedVaults);
  const addTrackedVault = useAppStore((s) => s.addTrackedVault);
  const removeTrackedVault = useAppStore((s) => s.removeTrackedVault);

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

  if (!isChainDeployed(chainId)) {
    const cfg = getChainConfig(chainId);
    return (
      <div className="text-center py-12">
        <p className="text-lg font-medium text-text-primary mb-2">{cfg?.name ?? `Chain ${chainId}`} — Coming Soon</p>
        <p className="text-sm text-text-secondary mb-4">
          Morpho contracts are being deployed on {cfg?.name ?? 'this chain'}.
          This page will activate automatically once deployment is complete.
        </p>
        <a
          href="https://github.com/morpho-org/sdks"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-info hover:text-info/80"
        >
          Track deployment progress
        </a>
        <div className="mt-4">
          <Button variant="ghost" onClick={() => navigate('/')}>
            Back to Dashboard
          </Button>
        </div>
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

  const isTracked = trackedVaults.some(
    (v) => v.address.toLowerCase() === vaultAddress.toLowerCase() && v.chainId === chainId,
  );

  const handleToggleTrack = () => {
    if (!vault) return;
    if (isTracked) {
      removeTrackedVault(vaultAddress, chainId);
    } else {
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
            <div className="flex gap-1.5 items-center">
              <Badge variant="info">{chainId}</Badge>
              <Badge>{vault.version.toUpperCase()}</Badge>
              <ProtocolChip flavor={vaultFlavor} />
              {dataSource === 'rpc' && isApiSupportedChain(chainId) && (
                <Badge variant="warning" title="API unavailable — data loaded via RPC fallback">RPC</Badge>
              )}
              {role.isOwner && <Badge variant="purple">Owner</Badge>}
              {role.isCurator && <Badge variant="purple">Curator</Badge>}
              {role.isAllocator && <Badge variant="purple">Allocator</Badge>}
              {role.isEmergencyRole && vault && (
                <Badge variant="purple">
                  {getEmergencyRoleLabel(vault.version)}
                </Badge>
              )}
              {vault?.netApy != null && (
                <span className={`text-sm font-mono font-medium ${getApyColorClass(vault.netApy)}`}>
                  {formatApyDisplay(vault.netApy)} APY
                </span>
              )}
            </div>
          )}
        </div>
        <Button
          variant={isTracked ? 'ghost' : 'secondary'}
          size="sm"
          onClick={handleToggleTrack}
        >
          {isTracked ? 'Untrack' : 'Track Vault'}
        </Button>
      </div>

      {/* Blacklist banner — writes will revert on-chain. */}
      {isBlacklisted && (
        <div className="flex items-start gap-2 px-3 py-2 bg-danger/10 border border-danger/30 text-xs text-danger">
          <Lock size={14} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Blocked by Lista.</span>{' '}
            This vault is on the Moolah singleton's vault blacklist.
            Writes (propose / execute, caps, reallocate) will revert on-chain.
            Contact Lista DAO to request removal.
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-border-subtle">
        {TABS.map((tab) => {
          if (tab.v2Only && !isV2) return null;
          if (tab.v1Only && isV2) return null;
          if (tab.protocols && !tab.protocols.includes(chainConfig?.protocol ?? 'morpho')) return null;

          const label = isV2 && tab.v2Label ? tab.v2Label : tab.label;
          // On Moolah, always show role-gated tabs (read-only if no
          // permission). Proposers need to SEE caps/queues to know what
          // to propose. On MetaMorpho, keep the old hide-when-no-role UX.
          const isMoolahChain = chainConfig?.protocol === 'moolah';
          const hasAccess = isMoolahChain
            ? !tab.requiresRole ||
              (tab.requiresRole === 'isCurator' && (permissions.canCurate || permissions.isAdmin)) ||
              (tab.requiresRole === 'isAllocator' && (permissions.isAllocator || permissions.canManage || permissions.isAdmin)) ||
              (tab.requiresRole === 'isEmergencyRole' && (permissions.canCancel || permissions.isAdmin)) ||
              role.isOwner
            : !tab.requiresRole ||
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
        {activeTab === 'allocation' && isV2 && (
          <V2AllocationTab chainId={chainId} vaultAddress={vaultAddress} />
        )}
        {activeTab === 'queues' && !isV2 && (
          <QueuesTab chainId={chainId} vaultAddress={vaultAddress} />
        )}
        {activeTab === 'guardian' && !isV2 && (
          <GuardianTab chainId={chainId} vaultAddress={vaultAddress} />
        )}
        {activeTab === 'security' && isV2 && (
          <V2SecurityTab chainId={chainId} vaultAddress={vaultAddress} />
        )}
        {activeTab === 'protocol' && chainConfig?.protocol === 'moolah' && (
          <ProtocolTab chainId={chainId} />
        )}
      </div>
    </div>
  );
}
