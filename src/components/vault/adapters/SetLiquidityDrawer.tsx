import type { Address } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
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
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const handleSet = (adapterAddress: Address) => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'setLiquidityAdapter',
      args: [adapterAddress],
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
