/**
 * Live rate projection for the V2 Reallocate dialog.
 *
 * Every keystroke in the dialog changes the deltas, and each projection round
 * is an on-chain `borrowRateView` per market. Debouncing the inputs (not the
 * query) keeps the query key stable while the curator is still typing, so
 * React Query isn't asked to start and abandon a fetch per character.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Address, PublicClient } from 'viem';
import { getPublicClient } from '../data/rpcClient';
import { getChainConfig } from '../../config/chains';
import {
  projectReallocationRates,
  type MarketRateInput,
  type MarketRateProjection,
} from '../market/reallocationRates';

/** Hold a value steady until it stops changing for `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return settled;
}

export interface ReallocationRatesResult {
  byMarket: Map<string, MarketRateProjection>;
  /** True while a projection for the *current* inputs is still in flight. */
  isProjecting: boolean;
  isError: boolean;
}

export function useReallocationRates(
  chainId: number | undefined,
  inputs: readonly MarketRateInput[],
  enabled = true,
): ReallocationRatesResult {
  // Serialize to a primitive so the key is stable across the array identity
  // churn a `useMemo` over changing text inputs produces.
  const signature = inputs
    .map((i) => `${i.marketId}:${i.delta.toString()}:${i.targetAssets.toString()}`)
    .join('|');
  const debouncedSignature = useDebounced(signature, 350);
  const settled = debouncedSignature === signature;

  const morpho = chainId ? getChainConfig(chainId)?.morphoBlue : undefined;
  const ready = enabled && !!chainId && !!morpho && inputs.length > 0;

  const query = useQuery({
    queryKey: ['v2-reallocation-rates', chainId, debouncedSignature],
    queryFn: () =>
      projectReallocationRates(
        getPublicClient(chainId!) as PublicClient,
        morpho as Address,
        inputs,
      ),
    // Only fetch once the inputs have settled, so a fast typist produces one
    // projection rather than one per character.
    enabled: ready && settled,
    staleTime: 30_000,
    // A projection is a decision input, not a live ticker — refetching under
    // the curator mid-edit would make the numbers jump for no reason.
    refetchOnWindowFocus: false,
  });

  const byMarket = new Map<string, MarketRateProjection>();
  for (const p of query.data ?? []) byMarket.set(p.marketId, p);

  return {
    byMarket,
    isProjecting: ready && (!settled || query.isFetching),
    isError: query.isError,
  };
}
