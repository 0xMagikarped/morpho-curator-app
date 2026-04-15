/**
 * Resolve the MarketFactory address for the given chain, caching 1 day in
 * React Query. Returns `{address, source, isLoading}` so UIs can render an
 * ambient "source" label (config / env / discovered) next to the address.
 */

import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { getPublicClient } from '../lib/data/rpcClient';
import {
  resolveMarketFactoryAddress,
  type MarketFactorySource,
} from '../lib/moolah/resolveMarketFactory';

export interface UseMarketFactoryAddressResult {
  address: Address | null;
  source: MarketFactorySource;
  isLoading: boolean;
}

export function useMarketFactoryAddress(
  chainId: number | undefined,
): UseMarketFactoryAddressResult {
  const query = useQuery({
    queryKey: ['moolah-market-factory', chainId],
    queryFn: async () => {
      if (!chainId) return { address: null, source: null as MarketFactorySource };
      const client = getPublicClient(chainId);
      return resolveMarketFactoryAddress(client, chainId);
    },
    enabled: Boolean(chainId),
    staleTime: 24 * 60 * 60 * 1000, // 1 day
    gcTime: 24 * 60 * 60 * 1000,
  });

  return {
    address: query.data?.address ?? null,
    source: query.data?.source ?? null,
    isLoading: query.isLoading,
  };
}
