import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { checkBatchUtilization } from '../risk/utilizationMonitor';
import { checkSharePrice } from '../risk/sharePriceMonitor';
import { getSharePriceHistory } from '../risk/riskDB';
import type { UtilizationData, SharePriceData, SharePriceRecord } from '../risk/riskTypes';
import { riskKeys } from '../queryKeys';

// ============================================================
// useVaultUtilization — Poll utilization for markets in a vault
// ============================================================

export function useVaultUtilization(
  chainId: number | undefined,
  marketIds: `0x${string}`[] | undefined,
) {
  return useQuery<Map<`0x${string}`, UtilizationData>>({
    queryKey: riskKeys.utilization(chainId!, marketIds?.join(',') ?? ''),
    queryFn: async () => {
      if (!chainId || !marketIds || marketIds.length === 0) return new Map();
      return checkBatchUtilization(chainId, marketIds);
    },
    enabled: !!chainId && !!marketIds && marketIds.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ============================================================
// useSharePrice — Track vault share price with historical data
// ============================================================

export function useSharePrice(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
) {
  return useQuery<SharePriceData | null>({
    queryKey: riskKeys.sharePrice(chainId!, vaultAddress!),
    queryFn: async () => {
      if (!chainId || !vaultAddress) return null;
      return checkSharePrice(chainId, vaultAddress);
    },
    enabled: !!chainId && !!vaultAddress,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

// ============================================================
// useSharePriceHistory — Get historical share price records
// ============================================================

export function useSharePriceHistory(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  limit = 50,
) {
  return useQuery<SharePriceRecord[]>({
    queryKey: riskKeys.sharePriceHistory(chainId!, vaultAddress!),
    queryFn: async () => {
      if (!chainId || !vaultAddress) return [];
      return getSharePriceHistory(vaultAddress, chainId, limit);
    },
    enabled: !!chainId && !!vaultAddress,
    staleTime: 60_000,
  });
}
