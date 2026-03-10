import { useState } from 'react';
import type { Address } from 'viem';
import { useQuery } from '@tanstack/react-query';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { checkMigrationStatus, type MigrationStatus } from '../../lib/migration/usdcMigration';
import { formatTokenAmount, truncateAddress } from '../../lib/utils/format';

interface UsdcMigrationBannerProps {
  chainId: number;
  vaultAddress: Address;
  vaultAsset: Address;
}

export function UsdcMigrationBanner({ chainId, vaultAddress, vaultAsset }: UsdcMigrationBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  const { data: status } = useQuery<MigrationStatus>({
    queryKey: ['usdc-migration', chainId, vaultAddress],
    queryFn: () => checkMigrationStatus(chainId, vaultAddress, vaultAsset),
    staleTime: 5 * 60_000,
    enabled: chainId === 1329, // SEI only
  });

  if (dismissed || !status || status.status === 'not-applicable' || status.status === 'completed') {
    return null;
  }

  const isLive = status.status === 'live';

  return (
    <Card className={isLive ? 'border-warning/20' : 'border-info/20'}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant={isLive ? 'warning' : 'info'}>
              USDC.n Migration
            </Badge>
            {isLive && <Badge variant="danger">ACTION REQUIRED</Badge>}
          </div>

          {isLive ? (
            <>
              <p className="text-xs text-text-primary">
                Native USDC is live on SEI. Your vault should migrate from bridged USDC to USDC.n.
              </p>
              <div className="text-xs text-text-tertiary space-y-1">
                <p>
                  Bridged USDC balance: {formatTokenAmount(status.bridgedUsdcBalance, 6)} USDC
                </p>
                {status.nativeUsdcAddress && (
                  <p>
                    Native USDC: {truncateAddress(status.nativeUsdcAddress)}
                  </p>
                )}
              </div>
              <p className="text-[10px] text-warning bg-warning/10 p-2">
                Migration steps: 1) Reduce caps on bridged USDC markets. 2) Reallocate to idle.
                3) Wait for borrows to repay. 4) Deploy new vault with native USDC. 5) Migrate depositors.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs text-text-primary">
                SEI is planning to migrate from bridged USDC to native USDC. Your vault holds
                {' '}{formatTokenAmount(status.bridgedUsdcBalance, 6)} in bridged USDC.
              </p>
              <p className="text-xs text-text-tertiary">
                Status: Migration not yet live. No action needed yet.
              </p>
            </>
          )}
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="text-text-tertiary hover:text-text-secondary text-xs ml-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
        >
          Dismiss
        </button>
      </div>
    </Card>
  );
}
