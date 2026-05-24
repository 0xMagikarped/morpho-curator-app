import { Zap, AlertTriangle } from 'lucide-react';
import type { Address } from 'viem';
import { useEffect } from 'react';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { useGuardedWriteContract } from '../../../hooks/useGuardedWriteContract';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import { vaultKeys } from '../../../lib/queryKeys';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

interface LiquidityAdapterBannerProps {
  liquidityAdapter: Address | null;
  adapters: V2AdapterFull[];
  chainId: number;
  vaultAddress: Address;
  canSetLiquidity: boolean;
  onSetLiquidity: () => void;
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as const;

/**
 * PR 40 — adds a one-click "Set Idle" button alongside Change.
 *
 * Morpho V2 vaults have no dedicated idle adapter. The canonical
 * idle state is the absence of a liquidity adapter, achieved by
 * `setLiquidityAdapterAndData(0x0, 0x)`. New deposits then sit in
 * the vault's own ERC-4626 balance with no adapter routing.
 *
 * The button is one-click (no drawer needed) — useful as a quick
 * recovery when the current adapter or its market data is mis-set
 * and `allocate()` is reverting. Curator/owner gated via the
 * existing `canSetLiquidity` flag.
 *
 * Invalidates adapter queries on tx success (PR 38 pattern) so the
 * Adapters tab + Allocation tab repaint automatically.
 */
export function LiquidityAdapterBanner({
  liquidityAdapter,
  adapters,
  chainId,
  vaultAddress,
  canSetLiquidity,
  onSetLiquidity,
}: LiquidityAdapterBannerProps) {
  const queryClient = useQueryClient();
  const { writeContract, data: txHash, isPending } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const busy = isPending || isConfirming;

  useEffect(() => {
    if (!isSuccess) return;
    void queryClient.invalidateQueries({
      queryKey: vaultKeys.adapters(chainId, vaultAddress),
    });
  }, [isSuccess, queryClient, chainId, vaultAddress]);

  const handleSetIdle = () => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'setLiquidityAdapterAndData',
      args: [ZERO_ADDR, '0x'],
      chainId,
    });
  };

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
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={handleSetIdle} disabled={busy} loading={busy}>
                Set Idle
              </Button>
              <Button size="sm" variant="ghost" onClick={onSetLiquidity}>
                Change
              </Button>
            </div>
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
