/**
 * Hook to browse Morpho Blue markets filtered by loan token (vault asset).
 * Uses the Morpho GraphQL API on supported chains, RPC scanner fallback for SEI.
 */
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { isApiSupportedChain } from '../lib/data/morphoApi';
import { marketKeys } from '../lib/queryKeys';
import type { MarketInfo, TokenInfo } from '../types';

const MORPHO_API_URL = 'https://blue-api.morpho.org/graphql';

const MARKETS_QUERY = `
  query GetMarkets($chainId: Int!, $loanToken: String!, $first: Int!, $skip: Int!) {
    markets(
      where: { chainId_in: [$chainId], loanAssetAddress_in: [$loanToken] }
      first: $first
      skip: $skip
      orderBy: SupplyAssetsUsd
      orderDirection: Desc
    ) {
      items {
        uniqueKey
        loanAsset { address symbol decimals }
        collateralAsset { address symbol decimals }
        lltv
        oracleAddress
        irmAddress
        state {
          supplyAssets
          borrowAssets
          liquidityAssets
          utilization
          supplyApy
          borrowApy
        }
      }
    }
  }
`;

interface ApiMarketItem {
  uniqueKey: string;
  loanAsset: { address: string; symbol: string; decimals: number };
  collateralAsset: { address: string; symbol: string; decimals: number } | null;
  lltv: string;
  oracleAddress: string;
  irmAddress: string;
  state: {
    supplyAssets: string;
    borrowAssets: string;
    liquidityAssets: string;
    utilization: number;
    supplyApy: number;
    borrowApy: number;
  };
}

function apiToMarketInfo(item: ApiMarketItem): MarketInfo {
  const loanToken: TokenInfo = {
    address: item.loanAsset.address as Address,
    symbol: item.loanAsset.symbol,
    decimals: item.loanAsset.decimals,
  };
  const collateralToken: TokenInfo = item.collateralAsset
    ? {
        address: item.collateralAsset.address as Address,
        symbol: item.collateralAsset.symbol,
        decimals: item.collateralAsset.decimals,
      }
    : { address: '0x0000000000000000000000000000000000000000' as Address, symbol: 'NONE', decimals: 0 };

  return {
    id: item.uniqueKey as `0x${string}`,
    params: {
      loanToken: loanToken.address,
      collateralToken: collateralToken.address,
      oracle: item.oracleAddress as Address,
      irm: item.irmAddress as Address,
      lltv: BigInt(item.lltv),
    },
    state: {
      totalSupplyAssets: BigInt(item.state.supplyAssets),
      totalSupplyShares: 0n,
      totalBorrowAssets: BigInt(item.state.borrowAssets),
      totalBorrowShares: 0n,
      lastUpdate: 0n,
      fee: 0n,
    },
    loanToken,
    collateralToken,
    supplyAPY: item.state.supplyApy,
    borrowAPY: item.state.borrowApy,
    utilization: item.state.utilization,
  };
}

async function fetchMarketsFromApi(
  chainId: number,
  loanToken: Address,
  limit = 50,
  skip = 0,
): Promise<MarketInfo[]> {
  const res = await fetch(MORPHO_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: MARKETS_QUERY,
      variables: {
        chainId,
        loanToken: loanToken.toLowerCase(),
        first: limit,
        skip,
      },
    }),
  });

  if (!res.ok) throw new Error(`Morpho API error: ${res.status}`);

  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0]?.message ?? 'GraphQL error');

  const items: ApiMarketItem[] = json.data?.markets?.items ?? [];
  return items.map(apiToMarketInfo);
}

/**
 * Browse Morpho Blue markets matching a vault's loan token (asset).
 */
export function useMorphoMarkets(
  chainId: number | undefined,
  loanToken: Address | undefined,
  enabled = true,
) {
  return useQuery<MarketInfo[]>({
    queryKey: [...marketKeys.list(chainId!), 'browse', loanToken?.toLowerCase()],
    queryFn: () => fetchMarketsFromApi(chainId!, loanToken!),
    enabled: enabled && !!chainId && !!loanToken && isApiSupportedChain(chainId),
    staleTime: 5 * 60_000,
  });
}
