/**
 * PR 41 — virtual "Idle" card.
 *
 * Morpho's curator app renders the vault's idle balance as a card
 * alongside the real adapters. There is no separate on-chain idle
 * adapter on V2 vaults; the "Idle" slot represents
 *
 *   vault.totalAssets() − Σ adapter.realAssets()
 *
 * — the portion of the vault's holdings that is NOT routed through
 * any adapter. Funds in this slot are immediately withdrawable (no
 * adapter / market liquidity constraint).
 *
 * The card is marked "Active" when the vault's `liquidityAdapter` is
 * the zero address (PR 40 "true idle" state) — new deposits then
 * land directly in this slot. When some other adapter is the
 * liquidity adapter, the idle slot is shown but not active.
 *
 * The "Set as Liquidity (Idle)" affordance calls
 * `setLiquidityAdapterAndData(0x0, 0x)` directly — same as the
 * banner's Set Idle (PR 40), exposed here for symmetry with the
 * other adapter cards' actions.
 */
import { useEffect } from 'react';
import type { Address } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { useGuardedWriteContract } from '../../../hooks/useGuardedWriteContract';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import { vaultKeys } from '../../../lib/queryKeys';
import { formatTokenAmount } from '../../../lib/utils/format';

interface IdleCardProps {
  idle: bigint;
  totalAssets: bigint;
  isLiquidityAdapterIdle: boolean;
  chainId: number;
  vaultAddress: Address;
  decimals: number;
  assetSymbol: string;
  canSetLiquidity: boolean;
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as const;

export function IdleCard({
  idle,
  totalAssets,
  isLiquidityAdapterIdle,
  chainId,
  vaultAddress,
  decimals,
  assetSymbol,
  canSetLiquidity,
}: IdleCardProps) {
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

  const allocationPct =
    totalAssets > 0n ? (Number(idle) / Number(totalAssets)) * 100 : 0;

  const handleSetIdle = () => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'setLiquidityAdapterAndData',
      args: [ZERO_ADDR, '0x'],
      chainId,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 min-w-0">
          <CardTitle className="truncate">Idle</CardTitle>
          <Badge variant="info">Virtual</Badge>
          {isLiquidityAdapterIdle && <Badge variant="success">Active</Badge>}
        </div>
      </CardHeader>

      <p className="text-[10px] text-text-tertiary mb-3">
        Vault's own ERC-4626 balance — not routed through any adapter. Always immediately
        withdrawable. {' '}
        {isLiquidityAdapterIdle
          ? 'New deposits land here (true idle).'
          : 'New deposits flow to the active liquidity adapter; this slot only grows when allocators de-allocate.'}
      </p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3">
        <MetricRow
          label="Allocation"
          value={`${formatTokenAmount(idle, decimals)} ${assetSymbol}`}
        />
        <MetricRow
          label="Allocation %"
          value={`${allocationPct.toFixed(2)}%`}
        />
        <MetricRow label="Abs / Rel Cap" value="∞ / 100%" />
        <MetricRow
          label="Liquidity"
          value={`${formatTokenAmount(idle, decimals)} ${assetSymbol}`}
        />
      </div>

      <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border-subtle">
        {canSetLiquidity && !isLiquidityAdapterIdle && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSetIdle}
            disabled={busy}
            loading={busy}
          >
            Set as Liquidity (True Idle)
          </Button>
        )}
        {isLiquidityAdapterIdle && (
          <span className="text-[10px] text-text-tertiary italic">
            Liquidity adapter is unset — deposits already routing here.
          </span>
        )}
      </div>
    </Card>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] text-text-tertiary uppercase">{label}</span>
      <p className="font-mono text-xs text-text-primary">{value}</p>
    </div>
  );
}
