import { Zap, AlertTriangle } from 'lucide-react';
import type { Address } from 'viem';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { AddressDisplay } from '../../ui/AddressDisplay';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

interface LiquidityAdapterBannerProps {
  liquidityAdapter: Address | null;
  adapters: V2AdapterFull[];
  chainId: number;
  canSetLiquidity: boolean;
  onSetLiquidity: () => void;
}

export function LiquidityAdapterBanner({
  liquidityAdapter,
  adapters,
  chainId,
  canSetLiquidity,
  onSetLiquidity,
}: LiquidityAdapterBannerProps) {
  if (liquidityAdapter) {
    const adapterInfo = adapters.find(
      (a) => a.address.toLowerCase() === liquidityAdapter.toLowerCase(),
    );
    return (
      <Card className="!p-3 border-accent-primary/30 bg-accent-primary-muted">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-accent-primary shrink-0" />
            <div>
              <p className="text-xs font-medium text-text-primary">
                Liquidity Adapter: {adapterInfo?.name ?? 'Unknown'}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <AddressDisplay address={liquidityAdapter} chainId={chainId} />
                <span className="text-[10px] text-text-tertiary">
                  Deposits auto-flow here. Withdrawals auto-pull.
                </span>
              </div>
            </div>
          </div>
          {canSetLiquidity && (
            <Button size="sm" variant="ghost" onClick={onSetLiquidity}>
              Change
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card className="!p-3 border-warning/30 bg-warning/5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-warning shrink-0" />
          <div>
            <p className="text-xs font-medium text-text-primary">No Liquidity Adapter Set</p>
            <p className="text-[10px] text-text-tertiary mt-0.5">
              New deposits sit idle. Withdrawals may fail if idle pool is empty.
            </p>
          </div>
        </div>
        {canSetLiquidity && (
          <Button size="sm" onClick={onSetLiquidity}>
            Set Liquidity Adapter
          </Button>
        )}
      </div>
    </Card>
  );
}
