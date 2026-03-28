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
// GraphQL query — fetch all vaults on chain, filter client-side
// ============================================================

const VAULTS_BY_CHAIN_QUERY = `
  query GetVaultsByChain($chainId: Int!, $first: Int!, $skip: Int!) {
    vaults(
      where: { chainId_in: [$chainId] }
      first: $first
      skip: $skip
      orderBy: TotalAssetsUsd
      orderDirection: Desc
    ) {
      items {
        address
        name
        symbol
        asset { symbol decimals }
        state {
          totalAssets
          curator
          allocation {
            market {
              uniqueKey
            }
            supplyAssets
            supplyCap
          }
        }
      }
    }
  }
`;

interface ApiAllocationItem {
  market: { uniqueKey: string };
  supplyAssets: string;
  supplyCap: string;
}

interface ApiVaultItem {
  address: string;
  name: string;
  symbol: string;
  asset: { symbol: string; decimals: number };
  state: {
    totalAssets: string;
    curator: string | { address: string } | null;
    allocation: ApiAllocationItem[];
  };
}

function resolveCurator(curator: string | { address: string } | null): Address {
  if (!curator) return '0x0000000000000000000000000000000000000000' as Address;
  if (typeof curator === 'string') return curator as Address;
  return (curator.address ?? '0x0000000000000000000000000000000000000000') as Address;
}

async function fetchMarketVaultsFromApi(
  chainId: number,
  marketId: MarketId,
): Promise<MarketVaultAllocation[]> {
  const allVaults: MarketVaultAllocation[] = [];
  let skip = 0;
  const pageSize = 100;

  while (true) {
    const res = await fetch('https://api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: VAULTS_BY_CHAIN_QUERY,
        variables: { chainId, first: pageSize, skip },
      }),
    });

    if (!res.ok) throw new Error(`Morpho API returned ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(`Morpho API error: ${json.errors[0].message}`);

    const items: ApiVaultItem[] = json.data?.vaults?.items ?? [];
    if (items.length === 0) break;

    for (const vault of items) {
      const allocation = vault.state.allocation?.find(
        (a) => a.market.uniqueKey.toLowerCase() === marketId.toLowerCase(),
      );
      if (allocation && (BigInt(allocation.supplyAssets) > 0n || BigInt(allocation.supplyCap) > 0n)) {
        allVaults.push({
          vaultAddress: vault.address as Address,
          vaultName: vault.name,
          vaultSymbol: vault.symbol,
          curator: resolveCurator(vault.state.curator),
          supplyAssets: BigInt(allocation.supplyAssets),
          supplyCap: BigInt(allocation.supplyCap),
          vaultTotalAssets: BigInt(vault.state.totalAssets),
          assetSymbol: vault.asset.symbol,
          assetDecimals: vault.asset.decimals,
        });
      }
    }

    if (items.length < pageSize) break;
    skip += pageSize;

    // Safety cap to prevent infinite loops
    if (skip >= 1000) break;
  }

  // Sort by supply descending
  allVaults.sort((a, b) => (b.supplyAssets > a.supplyAssets ? 1 : -1));
  console.log('[useMarketVaults] Found', allVaults.length, 'vaults for market', marketId);
  return allVaults;
}

// ============================================================
// Hook: useMarketVaults
// ============================================================

export function useMarketVaults(chainId: number, marketId: MarketId) {
  return useQuery({
    queryKey: marketKeys.curators(chainId, marketId),
    queryFn: async () => {
      if (isApiSupportedChain(chainId)) {
        try {
          return await fetchMarketVaultsFromApi(chainId, marketId);
        } catch (err) {
          console.warn('[useMarketVaults] API failed:', err);
        }
      }

      return null; // signals "use fallback"
    },
    staleTime: 120_000,
    refetchInterval: 300_000,
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
