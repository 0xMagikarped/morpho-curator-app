import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import {
  fetchVaultBasicInfo,
  fetchVaultQueues,
  fetchV2Adapters,
  fetchMarketCap,
  fetchPendingCap,
  fetchMarketState,
  fetchMarketParams,
  fetchTokenInfo,
  fetchVaultMarketPosition,
  fetchPendingTimelock,
  fetchPendingGuardian,
  checkIsAllocator,
} from '../data/rpcClient';
import type { V2AdapterData } from '../data/rpcClient';
import { isApiSupportedChain, fetchVaultFromApi, type ApiVaultData } from '../data/morphoApi';
import type { VaultRole, AllocationState, MarketInfo, PendingAction, MarketCap, PendingCap } from '../../types';
import type { VaultInfoV1 } from '../../types';
import { calcUtilization } from '../utils/format';
import { vaultKeys } from '../queryKeys';

// ============================================================
// Shared: fetch full vault data (API with RPC fallback)
// ============================================================

/**
 * Single query that fetches all vault data. For Ethereum/Base, uses the
 * Morpho GraphQL API (1 request). Falls back to RPC on API failure or
 * for unsupported chains (SEI).
 */
function useVaultFullData(chainId: number | undefined, vaultAddress: Address | undefined) {
  return useQuery({
    queryKey: vaultKeys.fullData(chainId!, vaultAddress!),
    queryFn: async (): Promise<ApiVaultData> => {
      if (!chainId || !vaultAddress) throw new Error('Missing params');

      // Try API first for supported chains
      if (isApiSupportedChain(chainId)) {
        try {
          return await fetchVaultFromApi(chainId, vaultAddress);
        } catch (apiError) {
          console.warn('[useVaultFullData] API failed, falling back to RPC:', apiError);
          // Fall through to RPC
        }
      }

      // RPC fallback
      return fetchVaultDataViaRpc(chainId, vaultAddress);
    },
    enabled: !!chainId && !!vaultAddress,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Fetch full vault data from RPC (used for SEI and as API fallback). */
async function fetchVaultDataViaRpc(
  chainId: number,
  vaultAddress: Address,
): Promise<ApiVaultData> {
  const vaultInfo = await fetchVaultBasicInfo(chainId, vaultAddress);
  const assetInfo = await fetchTokenInfo(chainId, vaultInfo.asset);

  const queues = await fetchVaultQueues(chainId, vaultAddress, vaultInfo.version);
  const allMarketIds = [
    ...new Set([...queues.supplyQueue, ...queues.withdrawQueue]),
  ];

  // Fetch per-market data in parallel
  const [allocations, markets] = await Promise.all([
    Promise.all(
      allMarketIds.map(async (marketId) => {
        const [cap, state, position] = await Promise.all([
          fetchMarketCap(chainId, vaultAddress, marketId),
          fetchMarketState(chainId, marketId),
          fetchVaultMarketPosition(chainId, vaultAddress, marketId),
        ]);
        const supplyAssets =
          state.totalSupplyShares > 0n
            ? (position.supplyShares * state.totalSupplyAssets) / state.totalSupplyShares
            : 0n;
        return {
          marketId,
          supplyAssets,
          supplyCap: cap.cap,
          availableLiquidity: state.totalSupplyAssets - state.totalBorrowAssets,
        } as AllocationState;
      }),
    ),
    Promise.all(
      allMarketIds.map(async (id) => {
        const [params, state] = await Promise.all([
          fetchMarketParams(chainId, id),
          fetchMarketState(chainId, id),
        ]);
        const [loanToken, collateralToken] = await Promise.all([
          fetchTokenInfo(chainId, params.loanToken),
          fetchTokenInfo(chainId, params.collateralToken),
        ]);
        return {
          id,
          params,
          state,
          loanToken,
          collateralToken,
          supplyAPY: 0,
          borrowAPY: 0,
          utilization: calcUtilization(state.totalBorrowAssets, state.totalSupplyAssets),
        } as MarketInfo;
      }),
    ),
  ]);

  const info = { ...vaultInfo, assetInfo };

  return {
    info,
    allocation: {
      ...queues,
      allocations,
      totalAllocated: allocations.reduce((sum, a) => sum + a.supplyAssets, 0n),
    },
    markets,
  };
}

// ============================================================
// useVaultInfo
// ============================================================

export function useVaultInfo(chainId: number | undefined, vaultAddress: Address | undefined) {
  const query = useVaultFullData(chainId, vaultAddress);
  return {
    ...query,
    data: query.data?.info,
  };
}

// ============================================================
// useVaultAllocation
// ============================================================

export function useVaultAllocation(chainId: number | undefined, vaultAddress: Address | undefined) {
  const query = useVaultFullData(chainId, vaultAddress);
  return {
    ...query,
    data: query.data?.allocation,
  };
}

// ============================================================
// useVaultMarkets (RPC-only, for non-API chains)
// ============================================================

/**
 * Fetch market info via RPC. For API-supported chains, use useVaultMarketsFromApi instead.
 */
export function useVaultMarkets(
  chainId: number | undefined,
  marketIds: `0x${string}`[] | undefined,
) {
  return useQuery({
    queryKey: [...vaultKeys.detail(chainId!, ''), 'markets', ...(marketIds ?? [])],
    queryFn: async () => {
      if (!chainId || !marketIds?.length) return [];

      const markets: MarketInfo[] = await Promise.all(
        marketIds.map(async (id) => {
          const [params, state] = await Promise.all([
            fetchMarketParams(chainId, id),
            fetchMarketState(chainId, id),
          ]);

          const [loanToken, collateralToken] = await Promise.all([
            fetchTokenInfo(chainId, params.loanToken),
            fetchTokenInfo(chainId, params.collateralToken),
          ]);

          const utilization = calcUtilization(
            state.totalBorrowAssets,
            state.totalSupplyAssets,
          );

          return {
            id,
            params,
            state,
            loanToken,
            collateralToken,
            supplyAPY: 0,
            borrowAPY: 0,
            utilization,
          } as MarketInfo;
        }),
      );

      return markets;
    },
    enabled: !!chainId && !!marketIds?.length && !isApiSupportedChain(chainId ?? 0),
    staleTime: 60_000,
  });
}

/**
 * Returns markets from the shared full-data query (works for all chains).
 */
export function useVaultMarketsFromApi(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
) {
  const query = useVaultFullData(chainId, vaultAddress);
  return {
    ...query,
    data: query.data?.markets,
  };
}

// ============================================================
// useV2Adapters
// ============================================================

export function useV2Adapters(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
) {
  return useQuery<V2AdapterData[]>({
    queryKey: vaultKeys.adapters(chainId!, vaultAddress!),
    queryFn: () => fetchV2Adapters(chainId!, vaultAddress!),
    enabled: !!chainId && !!vaultAddress,
    staleTime: 30_000,
  });
}

// ============================================================
// useVaultRole
// ============================================================

export function useVaultRole(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
): VaultRole & { isLoading: boolean } {
  const { address: userAddress } = useAccount();
  const fullData = useVaultFullData(chainId, vaultAddress);

  const { data, isLoading } = useQuery({
    queryKey: vaultKeys.role(chainId!, vaultAddress!, userAddress),
    queryFn: async () => {
      if (!chainId || !vaultAddress || !userAddress || !fullData.data) {
        return { isOwner: false, isCurator: false, isAllocator: false, isEmergencyRole: false };
      }

      const info = fullData.data.info;
      // isAllocator requires an on-chain call (not available in API)
      let isAllocator = false;
      try {
        isAllocator = await checkIsAllocator(chainId, vaultAddress, userAddress);
      } catch {
        // RPC call failed — skip allocator check
      }

      const lowerUser = userAddress.toLowerCase();
      const emergencyAddr = info.version === 'v1'
        ? (info as VaultInfoV1).guardian
        : info.version === 'v2'
          ? info.sentinel
          : ('0x0000000000000000000000000000000000000000' as Address);
      return {
        isOwner: info.owner.toLowerCase() === lowerUser,
        isCurator: info.curator.toLowerCase() === lowerUser,
        isAllocator,
        isEmergencyRole: emergencyAddr.toLowerCase() === lowerUser,
      };
    },
    enabled: !!chainId && !!vaultAddress && !!userAddress && !!fullData.data,
    staleTime: 10 * 60 * 1000, // Roles rarely change
  });

  return {
    isOwner: data?.isOwner ?? false,
    isCurator: data?.isCurator ?? false,
    isAllocator: data?.isAllocator ?? false,
    isEmergencyRole: data?.isEmergencyRole ?? false,
    isLoading,
  };
}

// ============================================================
// useVaultPendingActions
// ============================================================

export function useVaultPendingActions(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  marketIds: `0x${string}`[] | undefined,
) {
  return useQuery({
    queryKey: [...vaultKeys.pending(chainId!, vaultAddress!), marketIds],
    queryFn: async () => {
      if (!chainId || !vaultAddress) return [];

      const actions: PendingAction[] = [];

      const pendingTimelock = await fetchPendingTimelock(chainId, vaultAddress);
      if (pendingTimelock) {
        actions.push({
          type: 'timelock',
          description: `Timelock change to ${Number(pendingTimelock.value)}s`,
          validAt: pendingTimelock.validAt,
          value: pendingTimelock.value,
        });
      }

      const pendingGuardian = await fetchPendingGuardian(chainId, vaultAddress);
      if (pendingGuardian) {
        actions.push({
          type: 'guardian',
          description: `Guardian change to ${pendingGuardian.value}`,
          validAt: pendingGuardian.validAt,
          value: pendingGuardian.value,
        });
      }

      if (marketIds) {
        const pendingCaps = await Promise.all(
          marketIds.map((id) => fetchPendingCap(chainId, vaultAddress, id)),
        );
        for (const pc of pendingCaps) {
          if (pc) {
            actions.push({
              type: 'cap',
              description: `Cap increase to ${pc.value}`,
              validAt: pc.validAt,
              marketId: pc.marketId,
              value: pc.value,
            });
          }
        }
      }

      return actions.sort((a, b) => Number(a.validAt - b.validAt));
    },
    enabled: !!chainId && !!vaultAddress,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ============================================================
// useDiscoveredMarketStatuses — Read config + pendingCap for
// discovered markets that are NOT already in the vault queues.
// This detects PENDING/ENABLED states for markets added via submitCap.
// ============================================================

export interface DiscoveredMarketStatus {
  marketId: `0x${string}`;
  config: MarketCap;
  pendingCap: PendingCap | null;
}

export function useDiscoveredMarketStatuses(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  discoveredMarketIds: `0x${string}`[] | undefined,
) {
  return useQuery({
    queryKey: [...vaultKeys.discoveredStatuses(chainId!, vaultAddress!), discoveredMarketIds],
    queryFn: async (): Promise<DiscoveredMarketStatus[]> => {
      if (!chainId || !vaultAddress || !discoveredMarketIds?.length) return [];

      // Fetch each market independently — one RPC failure shouldn't block all
      const settled = await Promise.allSettled(
        discoveredMarketIds.map(async (marketId) => {
          const [config, pendingCap] = await Promise.all([
            fetchMarketCap(chainId, vaultAddress, marketId),
            fetchPendingCap(chainId, vaultAddress, marketId),
          ]);
          return { marketId, config, pendingCap };
        }),
      );

      const results: DiscoveredMarketStatus[] = [];
      for (const s of settled) {
        if (s.status === 'rejected') {
          console.warn('[useDiscoveredMarketStatuses] RPC call failed:', s.reason);
          continue;
        }
        const r = s.value;
        // Only include markets that have on-chain state (enabled or pending)
        if (r.config.enabled || r.config.cap > 0n || r.pendingCap !== null) {
          results.push(r);
        }
      }

      return results;
    },
    enabled: !!chainId && !!vaultAddress && !!discoveredMarketIds?.length,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
