import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import type { MarketId } from '../../types';
import { isApiSupportedChain } from '../data/morphoApi';
import { marketKeys } from '../queryKeys';
import { useVaultAllocation, useVaultInfo } from './useVault';

// ============================================================
// Types
// ============================================================

export interface MarketVaultAllocation {
  vaultAddress: Address;
  vaultName: string;
  vaultSymbol: string;
  curator: Address;
  supplyAssets: bigint;
  supplyCap: bigint;
  vaultTotalAssets: bigint;
  assetSymbol: string;
  assetDecimals: number;
}

// ============================================================
// GraphQL query for API-supported chains
// ============================================================

const MARKET_VAULTS_QUERY = `
  query GetVaultsByMarket($marketUniqueKey: String!, $chainId: Int!) {
    marketByUniqueKey(uniqueKey: $marketUniqueKey, chainId: $chainId) {
      uniqueKey
      vaultAllocations {
        vault {
          address
          name
          symbol
          state {
            totalAssets
            curator
          }
          asset { symbol decimals }
        }
        supplyAssets
        supplyCap
      }
    }
  }
`;

interface ApiVaultAllocation {
  vault: {
    address: string;
    name: string;
    symbol: string;
    state: {
      totalAssets: string;
      curator: string;
    };
    asset: { symbol: string; decimals: number };
  };
  supplyAssets: string;
  supplyCap: string;
}

interface ApiMarketVaultsResponse {
  marketByUniqueKey: {
    uniqueKey: string;
    vaultAllocations: ApiVaultAllocation[];
  } | null;
}

async function fetchMarketVaultsFromApi(
  chainId: number,
  marketId: MarketId,
): Promise<MarketVaultAllocation[]> {
  const res = await fetch('https://api.morpho.org/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: MARKET_VAULTS_QUERY,
      variables: { marketUniqueKey: marketId, chainId },
    }),
  });

  if (!res.ok) {
    throw new Error(`Morpho API returned ${res.status}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Morpho API error: ${json.errors[0].message}`);
  }

  const data = json.data as ApiMarketVaultsResponse;
  const market = data.marketByUniqueKey;
  if (!market?.vaultAllocations) return [];

  return market.vaultAllocations
    .filter((a) => BigInt(a.supplyAssets) > 0n || BigInt(a.supplyCap) > 0n)
    .map((a) => ({
      vaultAddress: a.vault.address as Address,
      vaultName: a.vault.name,
      vaultSymbol: a.vault.symbol,
      curator: a.vault.state.curator as Address,
      supplyAssets: BigInt(a.supplyAssets),
      supplyCap: BigInt(a.supplyCap),
      vaultTotalAssets: BigInt(a.vault.state.totalAssets),
      assetSymbol: a.vault.asset.symbol,
      assetDecimals: a.vault.asset.decimals,
    }));
}

// ============================================================
// Hook: useMarketVaults
// ============================================================

export function useMarketVaults(chainId: number, marketId: MarketId) {
  return useQuery({
    queryKey: marketKeys.curators(chainId, marketId),
    queryFn: async () => {
      // Try the API for supported chains
      if (isApiSupportedChain(chainId)) {
        try {
          return await fetchMarketVaultsFromApi(chainId, marketId);
        } catch (err) {
          console.warn('[useMarketVaults] API failed:', err);
        }
      }

      // Fallback: no data from API (unsupported chain or API error)
      // The tracked vaults fallback is handled by the component using
      // individual vault hooks (see useTrackedVaultMarketMatch below)
      return null; // signals "use fallback"
    },
    staleTime: 60_000,
  });
}

// ============================================================
// Fallback hook: check a single tracked vault for market match
// ============================================================

export function useTrackedVaultMarketMatch(
  chainId: number,
  vaultAddress: Address,
  marketId: MarketId,
) {
  const allocationQuery = useVaultAllocation(chainId, vaultAddress);
  const infoQuery = useVaultInfo(chainId, vaultAddress);

  const match = (() => {
    if (!allocationQuery.data || !infoQuery.data) return null;

    const alloc = allocationQuery.data.allocations.find(
      (a) => a.marketId.toLowerCase() === marketId.toLowerCase(),
    );
    if (!alloc || (alloc.supplyAssets === 0n && alloc.supplyCap === 0n)) return null;

    const info = infoQuery.data;
    return {
      vaultAddress: info.address,
      vaultName: info.name,
      vaultSymbol: info.symbol,
      curator: info.curator,
      supplyAssets: alloc.supplyAssets,
      supplyCap: alloc.supplyCap,
      vaultTotalAssets: info.totalAssets,
      assetSymbol: info.assetInfo?.symbol ?? '???',
      assetDecimals: info.assetInfo?.decimals ?? 18,
    } as MarketVaultAllocation;
  })();

  return {
    data: match,
    isLoading: allocationQuery.isLoading || infoQuery.isLoading,
  };
}
