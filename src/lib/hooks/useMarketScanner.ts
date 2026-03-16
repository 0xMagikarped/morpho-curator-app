import { useQuery } from '@tanstack/react-query';
import { useState, useCallback, useRef } from 'react';
import { marketKeys } from '../queryKeys';
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

  const chainConfig = chainId ? getChainConfig(chainId) : undefined;
  const isApiChain = chainConfig?.apiSupported ?? false;

  // Ref to signal the next queryFn run should do a full scan
  const fullScanRef = useRef(false);

  const query = useQuery({
    queryKey: marketKeys.discovered(chainId!),
    queryFn: async (): Promise<MarketRecord[]> => {
      if (!chainId || !chainConfig) return [];

      if (isApiChain) {
        // GraphQL-indexed chain: fetch from API and normalize to MarketRecord
        const apiResults = await fetchMarketsViaApi(chainId);
        return apiResults.map((r: ApiMarketResult) => r.market);
      }

      // RPC-only chain: run scan (saves to IndexedDB),
      // then return enriched data from IndexedDB
      if (fullScanRef.current) {
        fullScanRef.current = false;
        await runFullScan(chainId, setScanProgress);
      } else {
        await runIncrementalScan(chainId, setScanProgress);
      }

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
    try {
      setScanProgress(null);
      await clearChainData(chainId);
      fullScanRef.current = true;
      // Refetch triggers queryFn which sees fullScanRef and runs a full scan
      await query.refetch();
    } catch (err) {
      console.error('Rescan failed:', err);
    }
  }, [chainId, query]);

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
    queryKey: marketKeys.scanner(chainId!),
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
    queryKey: [...marketKeys.detail(chainId!, market?.marketId ?? ''), 'enriched'],
    queryFn: async () => {
      if (!chainId || !market) return null;
      return fetchEnrichedMarketState(chainId, market);
    },
    enabled: !!chainId && !!market,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
