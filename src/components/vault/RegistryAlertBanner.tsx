import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useRegistryStatus, type RegistryStep } from '../../hooks/useRegistryStatus';

interface RegistryAlertBannerProps {
  vaultAddress: `0x${string}`;
  chainId: number;
  isV2Vault: boolean;
}

interface BannerCfg {
  title: string;
  message: string;
  variant: 'warning' | 'info' | 'danger';
  icon: typeof AlertTriangle;
  /** Label for the call-to-action link; omitted = no action. */
  actionLabel?: string;
}

// `loading` and `complete` show no banner (null).
const bannerConfig: Record<RegistryStep, BannerCfg | null> = {
  loading: null,
  complete: null,
  set_not_submitted: {
    title: 'Adapter Registry Not Set',
    message:
      "This vault isn't connected to the Morpho Adapter Registry. Adapters can't be managed until the registry is set (submit) and abdicated.",
    variant: 'warning',
    icon: AlertTriangle,
    actionLabel: 'Set Registry',
  },
  set_pending: {
    title: 'Registry Change Pending',
    message:
      'A registry change has been submitted and is waiting for its timelock to elapse before it can be executed.',
    variant: 'info',
    icon: Clock,
  },
  set_executable: {
    title: 'Registry Change Ready to Execute',
    message:
      'The submitted registry change has cleared its timelock. Execute it to finish setting the adapter registry.',
    variant: 'info',
    icon: CheckCircle2,
    actionLabel: 'Continue Setup',
  },
  abdicate_not_submitted: {
    title: 'Registry Set — Abdication Pending',
    message:
      'The Morpho Registry is set but not yet abdicated. Abdicate to permanently lock it and enable full adapter management.',
    variant: 'info',
    icon: CheckCircle2,
    actionLabel: 'Abdicate Now',
  },
  abdicate_pending: {
    title: 'Abdication Pending',
    message:
      'The abdication has been submitted and is waiting for its timelock to elapse before it can be executed.',
    variant: 'info',
    icon: Clock,
  },
  abdicate_executable: {
    title: 'Abdication Ready to Execute',
    message: 'The submitted abdication has cleared its timelock. Execute it to permanently lock the registry.',
    variant: 'info',
    icon: CheckCircle2,
    actionLabel: 'Continue Setup',
  },
  error: {
    title: 'Unable to Check Registry Status',
    message: "Could not read the vault's registry configuration. Please try again later.",
    variant: 'danger',
    icon: XCircle,
  },
};

export function RegistryAlertBanner({ vaultAddress, chainId, isV2Vault }: RegistryAlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const { step, canManage } = useRegistryStatus(vaultAddress, chainId);

  const config = bannerConfig[step];
  if (!isV2Vault || dismissed || !config) return null;

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

            {!canManage && step !== 'error' && (
              <p className="text-[10px] text-text-tertiary">
                Only the vault owner or curator can configure this.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4 shrink-0">
          {config.actionLabel && (
            <Link
              to={`/vault/${chainId}/${vaultAddress}/registry`}
              className="px-3 py-1.5 text-xs font-medium bg-accent-primary text-white hover:bg-accent-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
            >
              {config.actionLabel}
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
