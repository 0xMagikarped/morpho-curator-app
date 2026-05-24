import type { Address } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useGuardedWriteContract } from '../../../hooks/useGuardedWriteContract';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { formatTokenAmount } from '../../../lib/utils/format';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';

interface SetLiquidityDrawerProps {
  open: boolean;
  onClose: () => void;
  adapters: V2AdapterFull[];
  currentLiquidityAdapter: Address | null;
  vaultAddress: Address;
  chainId: number;
  decimals: number;
  assetSymbol: string;
}

export function SetLiquidityDrawer({
  open,
  onClose,
  adapters,
  currentLiquidityAdapter,
  vaultAddress,
  chainId,
  decimals,
  assetSymbol,
}: SetLiquidityDrawerProps) {
  const { writeContract, data: txHash, isPending, error, simulateError } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // PR 14 — missing `chainId` made the preflight target the wallet's current
  // chain instead of the vault's chain. On a chain mismatch the guard's
  // simulate produces a "no contract at address" error that has nowhere to
  // surface → the Select button looks unresponsive. Pass `chainId` + render
  // the error banner so the user sees what blocked the write.
  //
  // PR 17 — there's no standalone `setLiquidityAdapter(address)` on V2; the
  // atomic setter is `setLiquidityAdapterAndData(address, bytes)`. We pass
  // empty `0x` bytes by default — that's the right shape for a V1-vault
  // adapter, and the safe default for a market-v1 adapter that hasn't been
  // pre-configured (the curator can still allocate via the normal flow).
  // If a curator wants to bind specific market params to liquidity, that's
  // a future enhancement (accept MarketParams in the drawer).
  const handleSet = (adapterAddress: Address) => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'setLiquidityAdapterAndData',
      args: [adapterAddress, '0x'],
      chainId,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Set Liquidity Adapter"
    >
      {isSuccess ? (
        <div className="text-center py-8">
          <Badge variant="success" className="mb-2">Updated</Badge>
          <p className="text-sm text-text-primary">Liquidity adapter updated.</p>
          <p className="text-xs text-text-tertiary mt-1">Takes effect immediately.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(simulateError || error) && (
            <div role="alert" className="bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
              {simulateError?.message ?? (error instanceof Error ? error.message : 'Transaction failed.')}
            </div>
          )}

          <div className="text-xs text-text-secondary mb-4">
            <p>Current: {currentLiquidityAdapter ? (
              <AddressDisplay address={currentLiquidityAdapter} chainId={chainId} />
            ) : 'None'}</p>
          </div>

          <p className="text-xs text-text-tertiary">
            The liquidity adapter receives all new deposits and fulfills withdrawals when the idle pool is empty.
            Choose the most liquid, safest option.
          </p>

          <div className="space-y-2">
            {adapters.map((a) => {
              const isCurrent = currentLiquidityAdapter?.toLowerCase() === a.address.toLowerCase();
              return (
                <div
                  key={a.address}
                  className="flex items-center justify-between p-3 bg-bg-hover border border-border-subtle"
                >
                  <div>
                    <p className="text-xs text-text-primary">
                      {a.name ?? `Adapter ${a.address.slice(0, 10)}`}
                      {isCurrent && <Badge variant="purple" className="ml-2">Current</Badge>}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-text-tertiary">
                      <AddressDisplay address={a.address} chainId={chainId} />
                      <span className="font-mono">
                        {formatTokenAmount(a.realAssets, decimals)} {assetSymbol}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={isCurrent ? 'ghost' : 'secondary'}
                    onClick={() => handleSet(a.address)}
                    disabled={isCurrent || isPending || isConfirming}
                    loading={isPending || isConfirming}
                  >
                    {isCurrent ? 'Active' : 'Select'}
                  </Button>
                </div>
              );
            })}
          </div>

          {adapters.length === 0 && (
            <p className="text-text-tertiary text-sm text-center py-4">
              No adapters enabled. Add an adapter first.
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}
