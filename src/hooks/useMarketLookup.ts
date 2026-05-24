/**
 * Direct market lookup by bytes32 market ID — works on every chain with
 * a Morpho Blue deployment, including those without API coverage
 * (XDC, SEI, etc.).
 *
 * Used as a fallback by `MarketBrowser`: when the user pastes a 32-byte
 * market ID into the search box and the regular GraphQL-backed list is
 * empty, we resolve the market via RPC (`idToMarketParams` +
 * `market(state)` + `idToToken metadata`) and synthesize a `MarketInfo`
 * so the rest of the wizard flow works unchanged.
 */
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import {
  fetchMarketParams,
  fetchMarketState,
  fetchTokenInfo,
  getPublicClient,
} from '../lib/data/rpcClient';
import { getChainConfig } from '../config/chains';
import { morphoBlueAbi } from '../lib/contracts/abis';
import { marketKeys } from '../lib/queryKeys';
import type { MarketInfo, MarketId } from '../types';

/**
 * Parse free-form user input into a canonical 32-byte market ID (`0x...`).
 *
 * Accepts:
 *   - `0x` + 64 hex chars
 *   - 64 hex chars (no prefix)
 *
 * Returns `null` if the input doesn't fit either shape. Pure — testable
 * without React.
 */
export function parseMarketIdInput(raw: string): MarketId | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const hex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (hex.length !== 64) return null;
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return `0x${hex}` as MarketId;
}

interface UseMarketLookupArgs {
  chainId: number | undefined;
  /** Raw user input — parsed inside the hook. */
  input: string;
  /** Optional: assert the resolved market's loan token matches this. */
  expectedLoanToken?: Address;
  /** Set false to pause (e.g., when the regular API list is non-empty). */
  enabled?: boolean;
}

export type MarketLookupStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'loan-token-mismatch'; actual: Address }
  | { kind: 'found'; market: MarketInfo }
  | { kind: 'error'; message: string };

/**
 * Resolve a single market by ID via RPC. Fails gracefully (not-found,
 * mismatch, error) without throwing — UI surfaces each state.
 */
export function useMarketLookup({
  chainId,
  input,
  expectedLoanToken,
  enabled = true,
}: UseMarketLookupArgs): MarketLookupStatus {
  const marketId = parseMarketIdInput(input);

  const query = useQuery<MarketInfo | { error: 'not-found' | 'loan-token-mismatch'; actual?: Address }>({
    queryKey: [...marketKeys.list(chainId ?? 0), 'manual-lookup', marketId?.toLowerCase()],
    enabled: enabled && !!chainId && !!marketId,
    staleTime: 60_000,
    queryFn: async () => {
      // Quickest disqualification: if Morpho Blue has no params for this
      // ID, `loanToken` comes back as the zero address. (`idToMarketParams`
      // doesn't revert for unknown IDs — it returns a zero struct.)
      const params = await fetchMarketParams(chainId!, marketId!);
      if (params.loanToken === '0x0000000000000000000000000000000000000000') {
        return { error: 'not-found' };
      }
      if (
        expectedLoanToken &&
        params.loanToken.toLowerCase() !== expectedLoanToken.toLowerCase()
      ) {
        return { error: 'loan-token-mismatch', actual: params.loanToken };
      }

      const [state, loanInfo, collateralInfo] = await Promise.all([
        fetchMarketState(chainId!, marketId!),
        fetchTokenInfo(chainId!, params.loanToken),
        fetchTokenInfo(chainId!, params.collateralToken),
      ]);

      // Best-effort APY/utilization derivation — full APY needs IRM math;
      // we leave it at 0 and let the UI compute downstream if needed.
      const utilization =
        state.totalSupplyAssets > 0n
          ? Number((state.totalBorrowAssets * 10000n) / state.totalSupplyAssets) / 10000
          : 0;

      const market: MarketInfo = {
        id: marketId!,
        params,
        state,
        loanToken: loanInfo,
        collateralToken: collateralInfo,
        supplyAPY: 0,
        borrowAPY: 0,
        utilization,
        rewards: [],
      };
      return market;
    },
  });

  if (!chainId || !marketId) return { kind: 'idle' };
  if (query.isLoading) return { kind: 'loading' };
  if (query.error)
    return { kind: 'error', message: query.error instanceof Error ? query.error.message : 'Lookup failed' };
  const d = query.data;
  if (!d) return { kind: 'idle' };
  if ('error' in d) {
    if (d.error === 'not-found') return { kind: 'not-found' };
    return { kind: 'loan-token-mismatch', actual: d.actual! };
  }
  return { kind: 'found', market: d };
}

/**
 * Read-only Morpho Blue address probe — exposed for tests + DevTools.
 * Returns the configured Blue address or undefined.
 */
export function getBlueAddress(chainId: number | undefined): Address | undefined {
  if (!chainId) return undefined;
  const cfg = getChainConfig(chainId);
  return cfg?.morphoBlue;
}

// Re-export for tests that want to exercise the underlying client without
// rebuilding the chain config plumbing.
export { getPublicClient, morphoBlueAbi };
