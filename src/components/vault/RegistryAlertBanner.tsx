import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useRegistryStatus, type RegistryStatus } from '../../hooks/useRegistryStatus';

interface RegistryAlertBannerProps {
  vaultAddress: `0x${string}`;
  chainId: number;
  isV2Vault: boolean;
}

const bannerConfig: Record<Exclude<RegistryStatus, 'loading' | 'set_and_abdicated'>, {
  title: string;
  message: string;
  variant: 'warning' | 'info' | 'danger';
  icon: typeof AlertTriangle;
  ownerActionLabel?: string;
}> = {
  not_set: {
    title: 'Adapter Registry Not Set',
    message: 'This vault hasn\'t been connected to the Morpho Adapter Registry. Adapters cannot be managed until the registry is set and abdicated.',
    variant: 'warning',
    icon: AlertTriangle,
    ownerActionLabel: 'Set Registry',
  },
  set_not_abdicated: {
    title: 'Registry Set — Abdication Pending',
    message: 'The Morpho Registry is set but hasn\'t been abdicated. Abdicate to permanently lock the registry and enable full adapter management.',
    variant: 'info',
    icon: CheckCircle2,
    ownerActionLabel: 'Abdicate Now',
  },
  pending: {
    title: 'Registry Change Pending',
    message: 'A timelocked registry action is pending. It will become executable after the timelock expires.',
    variant: 'info',
    icon: Clock,
  },
  error: {
    title: 'Unable to Check Registry Status',
    message: 'Could not read the vault\'s registry configuration. Please try again later.',
    variant: 'danger',
    icon: XCircle,
  },
};

export function RegistryAlertBanner({ vaultAddress, chainId, isV2Vault }: RegistryAlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const { status, isOwner } = useRegistryStatus(vaultAddress, chainId);

  if (!isV2Vault || dismissed || status === 'set_and_abdicated' || status === 'loading') {
    return null;
  }

  const config = bannerConfig[status];
  const Icon = config.icon;

  const borderClass = {
    warning: 'border-warning/20',
    info: 'border-info/20',
    danger: 'border-danger/20',
  }[config.variant];

  return (
    <Card className={borderClass}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Icon className={`w-4 h-4 mt-0.5 shrink-0 text-${config.variant}`} />
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant={config.variant}>{config.title}</Badge>
            </div>
            <p className="text-xs text-text-primary">{config.message}</p>

            {!isOwner && status !== 'error' && status !== 'pending' && (
              <p className="text-[10px] text-text-tertiary">Only the vault owner can configure this.</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4 shrink-0">
          {isOwner && config.ownerActionLabel && (
            <Link
              to={`/vault/${chainId}/${vaultAddress}/registry`}
              className="px-3 py-1.5 text-xs font-medium bg-accent-primary text-white hover:bg-accent-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
            >
              {config.ownerActionLabel}
            </Link>
          )}
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss registry alert"
            className="text-text-tertiary hover:text-text-secondary text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
          >
            Dismiss
          </button>
        </div>
      </div>
    </Card>
  );
}
