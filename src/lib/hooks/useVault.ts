import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import {
  fetchVaultBasicInfo,
  fetchVaultQueues,
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
import type { VaultRole, AllocationState, MarketInfo, PendingAction } from '../../types';
import { getEmergencyRole } from '../../types';
import { calcUtilization } from '../utils/format';

/**
 * Fetch full vault info from on-chain.
 */
export function useVaultInfo(chainId: number | undefined, vaultAddress: Address | undefined) {
  return useQuery({
    queryKey: ['vault-info', chainId, vaultAddress],
    queryFn: async () => {
      if (!chainId || !vaultAddress) throw new Error('Missing params');
      const info = await fetchVaultBasicInfo(chainId, vaultAddress);
      const assetInfo = await fetchTokenInfo(chainId, info.asset);
      return { ...info, assetInfo };
    },
    enabled: !!chainId && !!vaultAddress,
    staleTime: 30_000, // 30s — balance between freshness and RPC load
    refetchInterval: 60_000, // Auto-refresh every 60s
  });
}

/**
 * Fetch vault supply/withdraw queues and per-market allocation state.
 */
export function useVaultAllocation(chainId: number | undefined, vaultAddress: Address | undefined) {
  return useQuery({
    queryKey: ['vault-allocation', chainId, vaultAddress],
    queryFn: async () => {
      if (!chainId || !vaultAddress) throw new Error('Missing params');

      const queues = await fetchVaultQueues(chainId, vaultAddress);

      // Unique market IDs from both queues
      const allMarketIds = [
        ...new Set([...queues.supplyQueue, ...queues.withdrawQueue]),
      ];

      // Fetch caps, market state, and vault position for each market
      const allocations: AllocationState[] = await Promise.all(
        allMarketIds.map(async (marketId) => {
          const [cap, state, position] = await Promise.all([
            fetchMarketCap(chainId, vaultAddress, marketId),
            fetchMarketState(chainId, marketId),
            fetchVaultMarketPosition(chainId, vaultAddress, marketId),
          ]);

          // Calculate supply assets from shares
          const supplyAssets =
            state.totalSupplyShares > 0n
              ? (position.supplyShares * state.totalSupplyAssets) / state.totalSupplyShares
              : 0n;

          const availableLiquidity = state.totalSupplyAssets - state.totalBorrowAssets;

          return {
            marketId,
            supplyAssets,
            supplyCap: cap.cap,
            availableLiquidity,
          };
        }),
      );

      return {
        ...queues,
        allocations,
        totalAllocated: allocations.reduce((sum, a) => sum + a.supplyAssets, 0n),
      };
    },
    enabled: !!chainId && !!vaultAddress,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Fetch market info for markets in a vault's queues.
 */
export function useVaultMarkets(
  chainId: number | undefined,
  marketIds: `0x${string}`[] | undefined,
) {
  return useQuery({
    queryKey: ['vault-markets', chainId, marketIds],
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
            supplyAPY: 0, // TODO: calculate from IRM
            borrowAPY: 0,
            utilization,
          } as MarketInfo;
        }),
      );

      return markets;
    },
    enabled: !!chainId && !!marketIds?.length,
    staleTime: 60_000,
  });
}

/**
 * Check connected wallet's role for a vault.
 */
export function useVaultRole(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
): VaultRole & { isLoading: boolean } {
  const { address: userAddress } = useAccount();

  const { data, isLoading } = useQuery({
    queryKey: ['vault-role', chainId, vaultAddress, userAddress],
    queryFn: async () => {
      if (!chainId || !vaultAddress || !userAddress) {
        return { isOwner: false, isCurator: false, isAllocator: false, isEmergencyRole: false };
      }

      const info = await fetchVaultBasicInfo(chainId, vaultAddress);
      const isAllocator = await checkIsAllocator(chainId, vaultAddress, userAddress);

      const lowerUser = userAddress.toLowerCase();
      const emergencyRoleAddr = getEmergencyRole(info);
      return {
        isOwner: info.owner.toLowerCase() === lowerUser,
        isCurator: info.curator.toLowerCase() === lowerUser,
        isAllocator,
        isEmergencyRole: emergencyRoleAddr.toLowerCase() === lowerUser,
      };
    },
    enabled: !!chainId && !!vaultAddress && !!userAddress,
    staleTime: 60_000,
  });

  return {
    isOwner: data?.isOwner ?? false,
    isCurator: data?.isCurator ?? false,
    isAllocator: data?.isAllocator ?? false,
    isEmergencyRole: data?.isEmergencyRole ?? false,
    isLoading,
  };
}

/**
 * Fetch all pending actions for a vault.
 */
export function useVaultPendingActions(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  marketIds: `0x${string}`[] | undefined,
) {
  return useQuery({
    queryKey: ['vault-pending', chainId, vaultAddress, marketIds],
    queryFn: async () => {
      if (!chainId || !vaultAddress) return [];

      const actions: PendingAction[] = [];

      // Check pending timelock
      const pendingTimelock = await fetchPendingTimelock(chainId, vaultAddress);
      if (pendingTimelock) {
        actions.push({
          type: 'timelock',
          description: `Timelock change to ${Number(pendingTimelock.value)}s`,
          validAt: pendingTimelock.validAt,
          value: pendingTimelock.value,
        });
      }

      // Check pending guardian
      const pendingGuardian = await fetchPendingGuardian(chainId, vaultAddress);
      if (pendingGuardian) {
        actions.push({
          type: 'guardian',
          description: `Guardian change to ${pendingGuardian.value}`,
          validAt: pendingGuardian.validAt,
          value: pendingGuardian.value,
        });
      }

      // Check pending caps for each market
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
