import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { getChainConfig } from '../../config/chains';
import {
  getMarketsByChain,
  getScannerState,
  clearChainData,
  type MarketRecord,
} from '../indexer/indexedDB';
import {
  runIncrementalScan,
  runFullScan,
  type ScanProgress,
} from '../scanner/marketScanner';
import { fetchMarketsViaApi, type ApiMarketResult } from '../scanner/apiScanner';
import {
  fetchEnrichedMarketState,
  type EnrichedMarketState,
} from '../data/marketEnricher';

// ============================================================
// useMarketScanner — Discover markets on a chain
// ============================================================

export function useMarketScanner(chainId: number | undefined) {
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const queryClient = useQueryClient();

  const chainConfig = chainId ? getChainConfig(chainId) : undefined;
  const isApiChain = chainConfig?.apiSupported ?? false;

  const query = useQuery({
    queryKey: ['discovered-markets', chainId],
    queryFn: async (): Promise<MarketRecord[]> => {
      if (!chainId || !chainConfig) return [];

      if (isApiChain) {
        // GraphQL-indexed chain: fetch from API and normalize to MarketRecord
        const apiResults = await fetchMarketsViaApi(chainId);
        return apiResults.map((r: ApiMarketResult) => r.market);
      }

      // RPC-only chain: run incremental scan (saves to IndexedDB),
      // then return enriched data from IndexedDB
      await runIncrementalScan(chainId, setScanProgress);

      // Always return from IndexedDB — it has token symbols after enrichment
      return getMarketsByChain(chainId);
    },
    enabled: !!chainId && !!chainConfig,
    staleTime: 5 * 60_000,  // Consider data fresh for 5 minutes
    gcTime: 10 * 60_000,
    refetchInterval: false,  // Don't auto-refetch — use rescan button instead
  });

  const rescan = useCallback(async () => {
    if (!chainId) return;
    setScanProgress(null);
    await clearChainData(chainId);
    await runFullScan(chainId, setScanProgress);
    queryClient.invalidateQueries({ queryKey: ['discovered-markets', chainId] });
  }, [chainId, queryClient]);

  return {
    ...query,
    scanProgress,
    rescan,
    isApiChain,
  };
}

// ============================================================
// useScannerState — Read cached scanner progress
// ============================================================

export function useScannerState(chainId: number | undefined) {
  return useQuery({
    queryKey: ['scanner-state', chainId],
    queryFn: async () => {
      if (!chainId) return null;
      return getScannerState(chainId);
    },
    enabled: !!chainId,
    staleTime: 10_000,
    refetchInterval: 10_000,
  });
}

// ============================================================
// useEnrichedMarketState — Fetch live state for a single market
// ============================================================

export function useEnrichedMarketState(
  chainId: number | undefined,
  market: MarketRecord | undefined,
) {
  return useQuery<EnrichedMarketState | null>({
    queryKey: ['enriched-market', chainId, market?.marketId],
    queryFn: async () => {
      if (!chainId || !market) return null;
      return fetchEnrichedMarketState(chainId, market);
    },
    enabled: !!chainId && !!market,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
