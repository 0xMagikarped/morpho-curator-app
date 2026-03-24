/**
 * V2 Market Discovery: finds ALL markets with caps set on a V2 vault.
 *
 * Strategy:
 * 1. Try V2 GraphQL API (blue-api.morpho.org) for indexed vaults → caps field
 * 2. Fallback: query Morpho API for all markets with the vault's loan token,
 *    then check caps on-chain via RPC multicall.
 */
import type { Address } from 'viem';
import { getPublicClient } from './rpcClient';
import { marketRiskId, readCap } from '../v2/capComputation';
import type { MarketParams, MarketState, TokenInfo, AdapterMarketPosition, MarketId } from '../../types';

// ============================================================
// V2 GraphQL API (blue-api.morpho.org)
// ============================================================

const V2_API_URL = 'https://blue-api.morpho.org/graphql';

interface V2ApiMarketCap {
  type: 'MarketV1' | 'Adapter' | 'Collateral' | 'Unknown';
  absoluteCap: string;
  relativeCap: string;
  allocation: string;
  data: {
    adapterAddress?: string;
    market?: {
      uniqueKey: string;
      loanAsset: { symbol: string; address: string; decimals: number };
      collateralAsset: { symbol: string; address: string; decimals: number } | null;
      lltv: string;
      oracleAddress: string;
      irmAddress: string;
      state: {
        supplyAssets: string;
        borrowAssets: string;
        utilization: number;
      };
    };
    marketParams?: {
      loanToken: string;
      collateralToken: string;
      oracle: string;
      irm: string;
      lltv: string;
    };
  };
}

const V2_CAPS_QUERY = `
  query VaultCaps($address: String!, $chainId: Int!) {
    vaultV2ByAddress(address: $address, chainId: $chainId) {
      caps(first: 100) {
        items {
          type
          absoluteCap
          relativeCap
          allocation
          data {
            ... on MarketV1CapData {
              adapterAddress
              marketParams {
                loanToken
                collateralToken
                oracle
                irm
                lltv
              }
              market {
                uniqueKey
                loanAsset { symbol address decimals }
                collateralAsset { symbol address decimals }
                lltv
                oracleAddress
                irmAddress
                state {
                  supplyAssets
                  borrowAssets
                  utilization
                }
              }
            }
          }
        }
      }
    }
  }
`;

export interface DiscoveredMarket {
  marketId: `0x${string}`;
  params: MarketParams;
  loanToken: TokenInfo | null;
  collateralToken: TokenInfo | null;
  marketState: MarketState | null;
  // Cap from API (if available)
  apiAbsoluteCap?: bigint;
  apiRelativeCap?: bigint;
  apiAllocation?: bigint;
}

/**
 * Try to get all capped markets from the V2 API.
 * Returns null if the vault is not indexed.
 */
async function fetchCappedMarketsFromV2Api(
  chainId: number,
  vaultAddress: Address,
): Promise<DiscoveredMarket[] | null> {
  try {
    const res = await fetch(V2_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: V2_CAPS_QUERY,
        variables: { address: vaultAddress, chainId },
      }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    if (json.errors?.length) return null;

    const vault = json.data?.vaultV2ByAddress;
    if (!vault?.caps?.items) return null;

    const marketCaps = (vault.caps.items as V2ApiMarketCap[]).filter(
      (c) => c.type === 'MarketV1' && c.data?.market,
    );

    return marketCaps.map((c): DiscoveredMarket => {
      const m = c.data.market!;
      const mp = c.data.marketParams!;
      return {
        marketId: m.uniqueKey as `0x${string}`,
        params: {
          loanToken: mp.loanToken as Address,
          collateralToken: mp.collateralToken as Address,
          oracle: mp.oracle as Address,
          irm: mp.irm as Address,
          lltv: BigInt(mp.lltv),
        },
        loanToken: m.loanAsset
          ? { address: m.loanAsset.address as Address, name: m.loanAsset.symbol, symbol: m.loanAsset.symbol, decimals: m.loanAsset.decimals }
          : null,
        collateralToken: m.collateralAsset
          ? { address: m.collateralAsset.address as Address, name: m.collateralAsset.symbol, symbol: m.collateralAsset.symbol, decimals: m.collateralAsset.decimals }
          : null,
        marketState: {
          totalSupplyAssets: BigInt(m.state.supplyAssets),
          totalSupplyShares: 0n,
          totalBorrowAssets: BigInt(m.state.borrowAssets),
          totalBorrowShares: 0n,
          lastUpdate: 0n,
          fee: 0n,
        },
        apiAbsoluteCap: BigInt(c.absoluteCap),
        apiRelativeCap: BigInt(c.relativeCap),
        apiAllocation: BigInt(c.allocation),
      };
    });
  } catch {
    return null;
  }
}

// ============================================================
// RPC Fallback: Morpho API market discovery + on-chain cap check
// ============================================================

const MORPHO_API_URL = 'https://blue-api.morpho.org/graphql';

const MARKETS_BY_LOAN_TOKEN_QUERY = `
  query MarketsByLoanToken($loanToken: String!, $chainId: Int!) {
    markets(
      first: 200
      where: { loanAssetAddress_in: [$loanToken], chainId_in: [$chainId] }
    ) {
      items {
        uniqueKey
        loanAsset { symbol address decimals }
        collateralAsset { symbol address decimals }
        lltv
        oracleAddress
        irmAddress
        state {
          supplyAssets
          borrowAssets
        }
      }
    }
  }
`;

interface ApiMarketItem {
  uniqueKey: string;
  loanAsset: { symbol: string; address: string; decimals: number };
  collateralAsset: { symbol: string; address: string; decimals: number } | null;
  lltv: string;
  oracleAddress: string;
  irmAddress: string;
  state: {
    supplyAssets: string;
    borrowAssets: string;
  };
}

/**
 * Fallback: discover all markets for a loan token from the Morpho API,
 * then check caps on-chain to find which ones are configured for this vault.
 */
async function discoverCappedMarketsViaRpc(
  chainId: number,
  vaultAddress: Address,
  adapterAddress: Address,
  loanTokenAddress: Address,
): Promise<DiscoveredMarket[]> {
  // Step 1: Get all markets for this loan token from the API
  let apiMarkets: ApiMarketItem[] = [];
  try {
    const res = await fetch(MORPHO_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: MARKETS_BY_LOAN_TOKEN_QUERY,
        variables: { loanToken: loanTokenAddress, chainId },
      }),
    });
    if (res.ok) {
      const json = await res.json();
      apiMarkets = json.data?.markets?.items ?? [];
    }
  } catch {
    // API unavailable — can't discover markets
    return [];
  }

  if (apiMarkets.length === 0) return [];

  // Step 2: For each market, check caps on the vault via RPC
  const client = getPublicClient(chainId);
  const results = await Promise.allSettled(
    apiMarkets.map(async (m): Promise<DiscoveredMarket | null> => {
      if (!m.collateralAsset) return null;

      const params: MarketParams = {
        loanToken: m.loanAsset.address as Address,
        collateralToken: m.collateralAsset.address as Address,
        oracle: m.oracleAddress as Address,
        irm: m.irmAddress as Address,
        lltv: BigInt(m.lltv),
      };

      // Compute risk ID and check cap
      const riskId = marketRiskId(
        adapterAddress,
        params.loanToken,
        params.collateralToken,
        params.oracle,
        params.irm,
        params.lltv,
      );

      const cap = await readCap(client, vaultAddress, riskId);

      // If both caps are 0, this market is not configured for this vault
      if (cap.absoluteCap === 0n && cap.relativeCap === 0n) return null;

      return {
        marketId: m.uniqueKey as `0x${string}`,
        params,
        loanToken: {
          address: m.loanAsset.address as Address,
          name: m.loanAsset.symbol,
          symbol: m.loanAsset.symbol,
          decimals: m.loanAsset.decimals,
        },
        collateralToken: {
          address: m.collateralAsset.address as Address,
          name: m.collateralAsset.symbol,
          symbol: m.collateralAsset.symbol,
          decimals: m.collateralAsset.decimals,
        },
        marketState: {
          totalSupplyAssets: BigInt(m.state.supplyAssets),
          totalSupplyShares: 0n,
          totalBorrowAssets: BigInt(m.state.borrowAssets),
          totalBorrowShares: 0n,
          lastUpdate: 0n,
          fee: 0n,
        },
        apiAbsoluteCap: cap.absoluteCap,
        apiRelativeCap: cap.relativeCap,
      };
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<DiscoveredMarket | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((m): m is DiscoveredMarket => m !== null);
}

// ============================================================
// Public API: discover all capped markets
// ============================================================

/**
 * Discover all markets with caps set for a V2 vault adapter.
 * Tries V2 API first, falls back to market scan + on-chain cap check.
 */
export async function discoverAllCappedMarkets(
  chainId: number,
  vaultAddress: Address,
  adapterAddress: Address,
  loanTokenAddress: Address,
): Promise<DiscoveredMarket[]> {
  // Try V2 API first (fast, complete, includes 0-allocation markets)
  const apiMarkets = await fetchCappedMarketsFromV2Api(chainId, vaultAddress);
  if (apiMarkets && apiMarkets.length > 0) {
    return apiMarkets;
  }

  // Fallback: discover via Morpho API + RPC cap checks
  return discoverCappedMarketsViaRpc(chainId, vaultAddress, adapterAddress, loanTokenAddress);
}

/**
 * Merge adapter positions (active supply) with discovered markets (all capped).
 * Returns a unified list where every capped market appears, with position data overlaid.
 */
export function mergePositionsWithDiscoveredMarkets(
  positions: AdapterMarketPosition[],
  discovered: DiscoveredMarket[],
): AdapterMarketPosition[] {
  const merged = new Map<string, AdapterMarketPosition>();

  // Start with all discovered markets (caps set, may have 0 allocation)
  for (const dm of discovered) {
    merged.set(dm.marketId, {
      marketId: dm.marketId as MarketId,
      supplyAssets: 0n,
      supplyShares: 0n,
      params: dm.params,
      marketState: dm.marketState,
      loanToken: dm.loanToken,
      collateralToken: dm.collateralToken,
    });
  }

  // Overlay actual positions (active supply) — these take precedence
  for (const pos of positions) {
    merged.set(pos.marketId, pos);
  }

  return Array.from(merged.values());
}
