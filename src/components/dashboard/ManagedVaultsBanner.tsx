import { useState, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { Scan } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { useManagedVaults } from '../../lib/hooks/useManagedVaults';
import { useAppStore } from '../../store/appStore';
import { useTrackedVaults } from '../../lib/hooks/useTrackedVaults';
import { truncateAddress } from '../../lib/utils/format';
import { getChainConfig } from '../../config/chains';

const DISMISSED_KEY = 'morpho-managed-vaults-dismissed';

export function ManagedVaultsBanner() {
  const { address } = useAccount();
  const { data: managed, isLoading } = useManagedVaults(address);
  const { trackedVaults, addTrackedVault } = useAppStore();
  const { trackVault } = useTrackedVaults();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Filter out already-tracked vaults
  const untracked = useMemo(() => {
    if (!managed) return [];
    return managed.filter(
      (m) =>
        !trackedVaults.some(
          (t) => t.address.toLowerCase() === m.address.toLowerCase() && t.chainId === m.chainId,
        ),
    );
  }, [managed, trackedVaults]);

  if (dismissed || isLoading || !address || untracked.length === 0) return null;

  const handleTrackAll = () => {
    for (const v of untracked) {
      const vault = {
        address: v.address,
        chainId: v.chainId,
        name: v.name,
        version: v.version,
      };
      addTrackedVault(vault);
      trackVault(vault);
    }
    handleDismiss();
  };

  const handleDismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      // ignore
    }
  };

  return (
    <Card className="!p-3 border-accent-primary/30 bg-accent-primary-muted">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Scan size={16} className="text-accent-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium text-text-primary">
              Found {untracked.length} vault{untracked.length !== 1 ? 's' : ''} you manage
            </p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {untracked.map((v) => (
                <Badge key={`${v.chainId}-${v.address}`} variant="info">
                  {getChainConfig(v.chainId)?.name ?? `Chain ${v.chainId}`} ·{' '}
                  {v.name || truncateAddress(v.address)} · {v.role}
                </Badge>
              ))}
            </div>
            <p className="text-[10px] text-text-tertiary mt-1">
              Auto-detected via Morpho API and on-chain RPC reads.
            </p>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Button size="sm" onClick={handleTrackAll}>
            Track All
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </Card>
  );
}
