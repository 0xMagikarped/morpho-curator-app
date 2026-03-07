import { MORPHO_API_URL, getChainConfig } from '../../config/chains';
import type { MarketRecord } from '../indexer/indexedDB';

// ============================================================
// GraphQL API Scanner — for Ethereum, Base, etc.
// ============================================================

interface ApiMarketItem {
  uniqueKey: string;
  loanAsset: { address: string; symbol: string; decimals: number };
  collateralAsset: { address: string; symbol: string; decimals: number } | null;
  oracle: { address: string; type: string } | null;
  irmAddress: string;
  lltv: string;
  state: {
    supplyAssetsUsd: number;
    borrowAssetsUsd: number;
    utilization: number;
    supplyApy: number;
    borrowApy: number;
    timestamp: number; // Unix integer, NOT ISO string
  } | null;
}

export interface ApiMarketResult {
  market: MarketRecord;
  state: {
    supplyAssetsUsd: number;
    borrowAssetsUsd: number;
    utilization: number;
    supplyApy: number;
    borrowApy: number;
    timestamp: number;
  } | null;
}

/**
 * Fetch markets from Morpho GraphQL API.
 * Only works for chains where apiSupported === true.
 *
 * IMPORTANT: The API does NOT have a `loanAssetSymbol_in` filter.
 * Use `search` + post-filter by loanAsset.symbol.
 */
export async function fetchMarketsViaApi(
  chainId: number,
  loanAssetSymbol?: string,
): Promise<ApiMarketResult[]> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig?.apiSupported) {
    throw new Error(`Chain ${chainConfig?.name ?? chainId} is not indexed by Morpho API`);
  }

  const query = `{
    markets(
      where: {
        chainId_in: [${chainId}]
        ${loanAssetSymbol ? `search: "${loanAssetSymbol}"` : ''}
      }
      orderBy: SupplyAssetsUsd
      orderDirection: Desc
      first: 200
    ) {
      items {
        uniqueKey
        loanAsset { address symbol decimals }
        collateralAsset { address symbol decimals }
        oracle { address type }
        irmAddress
        lltv
        state {
          supplyAssetsUsd
          borrowAssetsUsd
          utilization
          supplyApy
          borrowApy
          timestamp
        }
      }
    }
  }`;

  const res = await fetch(MORPHO_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Morpho API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  if (json.errors) {
    throw new Error(`GraphQL error: ${json.errors[0]?.message ?? 'Unknown'}`);
  }

  let items: ApiMarketItem[] = json.data?.markets?.items ?? [];

  // Post-filter by symbol (API search is fuzzy)
  if (loanAssetSymbol) {
    const upper = loanAssetSymbol.toUpperCase();
    items = items.filter(
      (m) => m.loanAsset.symbol.toUpperCase() === upper,
    );
  }

  return items.map((item) => ({
    market: {
      chainId,
      marketId: item.uniqueKey as `0x${string}`,
      loanToken: item.loanAsset.address as `0x${string}`,
      collateralToken: (item.collateralAsset?.address ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      oracle: (item.oracle?.address ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      irm: item.irmAddress as `0x${string}`,
      lltv: item.lltv,
      discoveredAtBlock: 0, // API doesn't provide this
      loanTokenSymbol: item.loanAsset.symbol,
      loanTokenDecimals: item.loanAsset.decimals,
      collateralTokenSymbol: item.collateralAsset?.symbol,
      collateralTokenDecimals: item.collateralAsset?.decimals,
    },
    state: item.state,
  }));
}
