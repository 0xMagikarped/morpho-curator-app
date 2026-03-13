import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { Scan } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { useManagedVaults } from '../../lib/hooks/useManagedVaults';
import { useAppStore } from '../../store/appStore';
import { truncateAddress } from '../../lib/utils/format';
import { getChainConfig } from '../../config/chains';

export function ManagedVaultsBanner() {
  const { address } = useAccount();
  const { data: managed, isLoading } = useManagedVaults(address);
  const trackedVaults = useAppStore((s) => s.trackedVaults);
  const dismissedVaults = useAppStore((s) => s.dismissedVaults);
  const trackAll = useAppStore((s) => s.trackAll);
  const persistToEdgeConfig = useAppStore((s) => s.persistToEdgeConfig);

  // Filter out already-tracked AND explicitly-dismissed vaults
  const untracked = useMemo(() => {
    if (!managed) return [];
    const dismissedSet = new Set(dismissedVaults);
    return managed.filter(
      (m) =>
        !trackedVaults.some(
          (t) => t.address.toLowerCase() === m.address.toLowerCase() && t.chainId === m.chainId,
        ) &&
        !dismissedSet.has(`${m.address.toLowerCase()}-${m.chainId}`),
    );
  }, [managed, trackedVaults, dismissedVaults]);

  if (isLoading || !address || untracked.length === 0) return null;

  const handleTrackAll = () => {
    const vaults = untracked.map((v) => ({
      address: v.address,
      chainId: v.chainId,
      name: v.name,
      version: v.version,
    }));
    trackAll(vaults);
    persistToEdgeConfig(address);
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
        </div>
      </div>
    </Card>
  );
}
