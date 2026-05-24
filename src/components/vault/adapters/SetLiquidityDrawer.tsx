import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { encodeAbiParameters } from 'viem';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { useGuardedWriteContract } from '../../../hooks/useGuardedWriteContract';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { formatTokenAmount } from '../../../lib/utils/format';
import { metaMorphoV2Abi } from '../../../lib/contracts/metaMorphoV2Abi';
import type { V2AdapterFull } from '../../../lib/hooks/useV2Adapters';
import { useV2VaultCapEntries, type MarketCapEntry } from '../../../hooks/useV2VaultCapEntries';
import { vaultKeys } from '../../../lib/queryKeys';

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

/**
 * PR 37 — two-step flow for setting the active liquidity adapter on a V2
 * vault.
 *
 * Step 1: pick an adapter.
 * Step 2: for market-v1 adapters, pick the target market the adapter
 *         routes new deposits to. The picker is sourced from the
 *         vault's cap-discovered markets for that adapter (PR 23 event
 *         scan) so the curator only sees markets they've actually
 *         configured caps for. The selected MarketParams gets
 *         `abi.encode`d into the `liquidityData` bytes argument.
 *         Vault-v1 adapters skip step 2 — their liquidityData is empty.
 *
 * Behind the scenes:
 *   setLiquidityAdapterAndData(adapter, abi.encode(MarketParams)?)
 *
 * The PR 36 `useLiquidityTargetMarket` hook reads `liquidityData()`
 * back and decodes it on the Allocation tab — so the loop closes: the
 * Active Adapter row finally shows "WXDC / USDC @ 38.5%" instead of
 * the bare adapter address.
 */
const MARKET_PARAMS_TUPLE = [
  {
    type: 'tuple',
    components: [
      { name: 'loanToken', type: 'address' },
      { name: 'collateralToken', type: 'address' },
      { name: 'oracle', type: 'address' },
      { name: 'irm', type: 'address' },
      { name: 'lltv', type: 'uint256' },
    ],
  },
] as const;

function encodeMarketParamsBytes(market: MarketCapEntry): `0x${string}` {
  return encodeAbiParameters(MARKET_PARAMS_TUPLE, [market.params]);
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
  const queryClient = useQueryClient();
  const { writeContract, data: txHash, isPending, error, simulateError } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // Two-step flow state — when null we're in step 1 (pick adapter).
  const [pickingMarketFor, setPickingMarketFor] = useState<V2AdapterFull | null>(null);

  // Reset whenever the drawer closes so step 1 is fresh on re-open.
  useEffect(() => {
    if (!open) setPickingMarketFor(null);
  }, [open]);

  // PR 38 — when the tx confirms, invalidate the adapter family queries.
  // Without this the Allocation tab's `useLiquidityTargetMarket` keeps
  // its pre-change result (typically `null`) for the full staleTime
  // window, so the Active Adapter row stays on the fallback
  // address-only display instead of switching to the new
  // `{collateral}/{loan} @ {lltv}%` shape PR 36/37 wired up.
  useEffect(() => {
    if (!isSuccess) return;
    void queryClient.invalidateQueries({
      queryKey: vaultKeys.adapters(chainId, vaultAddress),
    });
  }, [isSuccess, queryClient, chainId, vaultAddress]);

  // PR 23 event scan — markets that have caps configured on the vault,
  // filtered to the picked adapter in step 2.
  const { data: capEntries } = useV2VaultCapEntries(chainId, vaultAddress);
  const adapterMarkets: MarketCapEntry[] =
    pickingMarketFor
      ? (capEntries?.marketCaps ?? []).filter(
          (m) => m.adapter.toLowerCase() === pickingMarketFor.address.toLowerCase(),
        )
      : [];

  const handleAdapterSelect = (adapter: V2AdapterFull) => {
    if (adapter.type === 'market-v1') {
      // Market adapter — go to step 2 to pick the target market.
      setPickingMarketFor(adapter);
    } else {
      // Vault-v1 or unknown — no market to pick; send empty bytes.
      writeContract({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: 'setLiquidityAdapterAndData',
        args: [adapter.address, '0x'],
        chainId,
      });
    }
  };

  const handleMarketSelect = (market: MarketCapEntry) => {
    if (!pickingMarketFor) return;
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'setLiquidityAdapterAndData',
      args: [pickingMarketFor.address, encodeMarketParamsBytes(market)],
      chainId,
    });
  };

  // Clear-route option for market-v1 adapters: explicitly set empty
  // liquidityData so the adapter is "set without a target". Rare but
  // useful — keeps the curator from being stuck if no market is
  // configured yet.
  const handleSkipMarket = () => {
    if (!pickingMarketFor) return;
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'setLiquidityAdapterAndData',
      args: [pickingMarketFor.address, '0x'],
      chainId,
    });
  };

  // PR 40 — "True Idle" — sets the liquidity adapter to ZERO ADDRESS
  // so new deposits don't even touch an adapter; they sit in the
  // vault's own ERC-4626 balance. This is the canonical Morpho V2
  // "idle" state: there is no dedicated idle adapter on V2 vaults
  // (the design doesn't need one — absence of a liquidity adapter
  // IS the idle state).
  //
  // PR 39's earlier semantic (keep current adapter, clear data) is
  // still reachable via step 2's "Skip (no target)" — useful when the
  // curator wants to keep the adapter wired but route to no specific
  // market.
  const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as const;
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
    <Drawer
      open={open}
      onClose={onClose}
      title={pickingMarketFor ? 'Pick Target Market' : 'Set Liquidity Adapter'}
    >
      {isSuccess ? (
        <div className="text-center py-8">
          <Badge variant="success" className="mb-2">Updated</Badge>
          <p className="text-sm text-text-primary">Liquidity adapter updated.</p>
          <p className="text-xs text-text-tertiary mt-1">Takes effect immediately.</p>
        </div>
      ) : pickingMarketFor ? (
        // === STEP 2 — market picker for market-v1 adapter ===========
        <div className="space-y-3">
          {(simulateError || error) && (
            <div role="alert" className="bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
              {simulateError?.message ?? (error instanceof Error ? error.message : 'Transaction failed.')}
            </div>
          )}

          <div className="text-xs text-text-secondary">
            <p>
              Adapter:{' '}
              <span className="font-mono text-text-primary">{pickingMarketFor.address.slice(0, 10)}…</span>
            </p>
            <p className="text-text-tertiary text-[10px] mt-0.5">
              New deposits will auto-flow into the market you pick here. Encoded as{' '}
              <span className="font-mono">abi.encode(MarketParams)</span> in{' '}
              <span className="font-mono">liquidityData</span>.
            </p>
          </div>

          {adapterMarkets.length === 0 ? (
            <p className="text-[10px] text-warning">
              No markets with caps on this adapter yet. Either skip below to set the adapter
              without a target, or configure a market via the Caps tab first.
            </p>
          ) : (
            <div className="space-y-2">
              {adapterMarkets.map((m) => {
                const lltvPct = (Number(m.params.lltv) / 1e18) * 100;
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between p-3 bg-bg-hover border border-border-subtle"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-text-primary">
                        {m.collateralToken?.symbol ?? '???'} / {assetSymbol}{' '}
                        <span className="text-text-tertiary">@ {lltvPct.toFixed(1)}%</span>
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-text-tertiary">
                        <span className="font-mono">
                          {m.marketId.slice(0, 10)}…{m.marketId.slice(-4)}
                        </span>
                        <span className="font-mono">
                          {formatTokenAmount(m.allocation, decimals)} {assetSymbol} allocated
                        </span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleMarketSelect(m)}
                      disabled={isPending || isConfirming}
                      loading={isPending || isConfirming}
                    >
                      Select
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-border-subtle">
            <Button variant="ghost" size="sm" onClick={() => setPickingMarketFor(null)} className="flex-1">
              ← Back
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSkipMarket}
              disabled={isPending || isConfirming}
              loading={isPending || isConfirming}
              className="flex-1"
            >
              Skip (no target)
            </Button>
          </div>
        </div>
      ) : (
        // === STEP 1 — adapter picker =================================
        <div className="space-y-3">
          {(simulateError || error) && (
            <div role="alert" className="bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
              {simulateError?.message ?? (error instanceof Error ? error.message : 'Transaction failed.')}
            </div>
          )}

          <div className="text-xs text-text-secondary mb-4">
            <p>
              Current:{' '}
              {currentLiquidityAdapter ? (
                <AddressDisplay address={currentLiquidityAdapter} chainId={chainId} />
              ) : (
                'None'
              )}
            </p>
          </div>

          <p className="text-xs text-text-tertiary">
            The liquidity adapter receives all new deposits and fulfills withdrawals when the
            idle pool is empty. Choose the most liquid, safest option.
          </p>

          {/* PR 40 — TRUE IDLE: clears the liquidity adapter to zero so
              new deposits sit in the vault's own ERC-4626 balance with
              no adapter touching them. There is no dedicated idle
              adapter on Morpho V2 vaults — absence of a liquidity
              adapter IS the idle state. */}
          <div className="flex items-center justify-between gap-3 p-3 border border-border-default">
            <div className="min-w-0">
              <p className="text-xs text-text-primary font-medium">Set to True Idle</p>
              <p className="text-[10px] text-text-tertiary mt-0.5">
                Clears the liquidity adapter so new deposits sit in the vault's own balance
                (no auto-allocation, no adapter touching the funds). Sends{' '}
                <span className="font-mono">setLiquidityAdapterAndData(0x0, 0x)</span>. To
                keep the current adapter wired but clear the market target instead, use the
                step-2 <span className="font-mono">Skip (no target)</span> path after Next.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSetIdle}
              disabled={isPending || isConfirming}
              loading={isPending || isConfirming}
            >
              Set Idle
            </Button>
          </div>

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
                      {a.type === 'market-v1' && <Badge variant="success" className="ml-2">MKT</Badge>}
                      {a.type === 'vault-v1' && <Badge variant="info" className="ml-2">V1</Badge>}
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
                    onClick={() => handleAdapterSelect(a)}
                    disabled={isPending || isConfirming}
                    loading={isPending || isConfirming}
                  >
                    {a.type === 'market-v1' ? 'Next →' : isCurrent ? 'Active' : 'Select'}
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
