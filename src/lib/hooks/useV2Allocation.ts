/**
 * Hook for V2 Allocation Tab: combines adapter market positions with 3-level caps.
 * Discovers ALL markets with caps (not just active positions) via API + RPC fallback.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { getPublicClient } from '../data/rpcClient';
import { useAdapterMarketPositions, type V2AdapterFull } from './useV2Adapters';
import {
  adapterRiskId,
  collateralRiskId,
  marketRiskId,
  readCap,
  effectiveCap,
  type CapPair,
} from '../v2/capComputation';
import {
  discoverAllCappedMarkets,
  mergePositionsWithDiscoveredMarkets,
} from '../data/v2MarketDiscovery';
import { vaultKeys } from '../queryKeys';
import type { AdapterMarketPosition, MarketParams } from '../../types';

// ============================================================
// Types
// ============================================================

export interface AllocationRow {
  type: 'idle' | 'market';
  // Market identity
  marketId?: `0x${string}`;
  collateralSymbol?: string;
  collateralAddress?: Address;
  loanSymbol?: string;
  lltv?: number;
  // Full market params (needed for reallocation tx)
  params?: MarketParams;
  // Caps
  effectiveAbsCap?: bigint;
  effectiveRelCap?: bigint;
  // Metrics
  share?: number;        // adapter supply / market total supply * 100
  liquidity?: bigint;    // market totalSupply - totalBorrow
  percentAllocated: number;
  allocation: bigint;
}

export interface V2AllocationData {
  assetSymbol: string;
  assetDecimals: number;
  totalAssets: bigint;
  adapterAddress: Address;
  adapterRealAssets: bigint;
  idle: bigint;
  rows: AllocationRow[];
}

// ============================================================
// Hook: discover all capped markets for the adapter
// ============================================================

function useDiscoveredMarkets(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  adapterAddress: Address | undefined,
  loanTokenAddress: Address | undefined,
) {
  return useQuery({
    queryKey: [...vaultKeys.adapters(chainId!, vaultAddress!), 'discovered-markets', adapterAddress],
    queryFn: () => discoverAllCappedMarkets(chainId!, vaultAddress!, adapterAddress!, loanTokenAddress!),
    enabled: !!chainId && !!vaultAddress && !!adapterAddress && !!loanTokenAddress,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}

// ============================================================
// Hook: read caps for all markets in the adapter
// ============================================================

function useMarketCaps(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  adapterAddress: Address | undefined,
  positions: AdapterMarketPosition[] | undefined,
) {
  return useQuery({
    queryKey: [...vaultKeys.adapters(chainId!, vaultAddress!), 'allocation-caps', adapterAddress, positions?.length],
    queryFn: async (): Promise<Map<string, CapPair>> => {
      if (!chainId || !vaultAddress || !adapterAddress || !positions) {
        return new Map();
      }
      const client = getPublicClient(chainId);

      // Read adapter-level cap once
      const adapterCapId = adapterRiskId(adapterAddress);
      const adapterCap = await readCap(client, vaultAddress, adapterCapId);

      const capMap = new Map<string, CapPair>();

      // Read collateral + market caps for each position
      await Promise.all(
        positions.map(async (pos) => {
          if (!pos.params) return;

          const [collatCap, mktCap] = await Promise.all([
            readCap(
              client,
              vaultAddress,
              collateralRiskId(adapterAddress, pos.params.collateralToken),
            ),
            readCap(
              client,
              vaultAddress,
              marketRiskId(
                adapterAddress,
                pos.params.loanToken,
                pos.params.collateralToken,
                pos.params.oracle,
                pos.params.irm,
                pos.params.lltv,
              ),
            ),
          ]);

          capMap.set(pos.marketId, effectiveCap(adapterCap, collatCap, mktCap));
        }),
      );

      return capMap;
    },
    enabled: !!chainId && !!vaultAddress && !!adapterAddress && !!positions && positions.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ============================================================
// Main hook: V2 Allocation Data
// ============================================================

export function useV2AllocationData(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  totalAssets: bigint | undefined,
  adapter: V2AdapterFull | undefined,
  assetSymbol: string,
  assetDecimals: number,
  loanTokenAddress: Address | undefined,
) {
  // Active positions from adapter (markets with supply > 0)
  const { data: positions, isLoading: posLoading } = useAdapterMarketPositions(
    chainId,
    adapter?.address,
    adapter?.morphoBlue,
    adapter?.type ?? 'unknown',
  );

  // ALL capped markets (including 0-allocation ones)
  const { data: discovered, isLoading: discLoading } = useDiscoveredMarkets(
    chainId,
    vaultAddress,
    adapter?.address,
    loanTokenAddress,
  );

  // Merge positions + discovered markets
  const mergedPositions = positions && discovered
    ? mergePositionsWithDiscoveredMarkets(positions, discovered)
    : positions;

  // Build cap map from API-provided caps (preferred — avoids risk ID computation)
  const apiCapMap = useMemo(() => {
    if (!discovered) return undefined;
    const map = new Map<string, CapPair>();
    for (const dm of discovered) {
      if (dm.apiAbsoluteCap !== undefined || dm.apiRelativeCap !== undefined) {
        map.set(dm.marketId, {
          absoluteCap: dm.apiAbsoluteCap ?? 0n,
          relativeCap: dm.apiRelativeCap ?? 0n,
        });
      }
    }
    return map.size > 0 ? map : undefined;
  }, [discovered]);

  // Only fall back to RPC cap reads when API caps are not available
  const { data: rpcCapMap, isLoading: capsLoading } = useMarketCaps(
    chainId,
    vaultAddress,
    adapter?.address,
    !apiCapMap ? mergedPositions : undefined, // skip RPC when API caps exist
  );

  // Prefer API caps, fall back to RPC caps
  const capMap = apiCapMap ?? rpcCapMap;

  const isLoading = posLoading || discLoading || (!apiCapMap && capsLoading);

  // Build allocation data
  const data: V2AllocationData | null = (() => {
    if (!adapter || !mergedPositions || !totalAssets) return null;

    const adapterTotal = adapter.realAssets;
    const idle = totalAssets > adapterTotal ? totalAssets - adapterTotal : 0n;

    const rows: AllocationRow[] = [];

    // Idle row
    rows.push({
      type: 'idle',
      percentAllocated: 0,
      allocation: idle,
    });

    // Market rows
    for (const pos of mergedPositions) {
      const lltv = pos.params ? Number(pos.params.lltv) / 1e18 : 0;

      const share = pos.marketState && pos.marketState.totalSupplyAssets > 0n
        ? Number((pos.supplyAssets * 10000n) / pos.marketState.totalSupplyAssets) / 100
        : 0;

      const liquidity = pos.marketState
        ? pos.marketState.totalSupplyAssets - pos.marketState.totalBorrowAssets
        : 0n;

      const percentAllocated = adapterTotal > 0n
        ? Number((pos.supplyAssets * 10000n) / adapterTotal) / 100
        : 0;

      const caps = capMap?.get(pos.marketId);

      rows.push({
        type: 'market',
        marketId: pos.marketId,
        collateralSymbol: pos.collateralToken?.symbol ?? '???',
        collateralAddress: pos.params?.collateralToken,
        loanSymbol: pos.loanToken?.symbol ?? '???',
        lltv: lltv * 100,
        params: pos.params ?? undefined,
        effectiveAbsCap: caps?.absoluteCap,
        effectiveRelCap: caps?.relativeCap,
        share,
        liquidity,
        percentAllocated,
        allocation: pos.supplyAssets,
      });
    }

    return {
      assetSymbol,
      assetDecimals,
      totalAssets,
      adapterAddress: adapter.address,
      adapterRealAssets: adapterTotal,
      idle,
      rows,
    };
  })();

  return { data, isLoading };
}
