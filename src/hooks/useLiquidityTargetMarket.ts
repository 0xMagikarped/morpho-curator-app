/**
 * PR 36 — resolve the active liquidity adapter's TARGET MARKET.
 *
 * The V2 vault stores arbitrary `liquidityData()` bytes that get passed
 * to the active adapter's `allocate(market, …)` call. For a market-v1
 * adapter, those bytes are `abi.encode(MarketParams)` — the specific
 * market new deposits flow into. The previous Allocation-tab panel
 * (PR 33) showed the adapter address but NOT the target market, which
 * meant curators couldn't tell at a glance where deposits are auto-
 * routing.
 *
 * For other adapter types (vault-v1 or unknown) `liquidityData()` is
 * empty / opaque and we return `null` — the panel falls back to the
 * adapter address.
 */
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { decodeAbiParameters } from 'viem';
import { getPublicClient, fetchTokenInfo } from '../lib/data/rpcClient';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';
import { computeMarketId } from '../lib/market/marketId';
import { vaultKeys } from '../lib/queryKeys';
import type { MarketParams, TokenInfo } from '../types';

export interface LiquidityTargetMarket {
  marketId: `0x${string}`;
  params: MarketParams;
  collateralToken: TokenInfo | null;
}

const MARKET_PARAMS_TUPLE = [
  {
    type: 'tuple',
    components: [
      { name: 'loanToken', type: 'address' },
      { name: 'collateralToken', type: 'address' },
      { name: 'oracle', type: 'address' },
      { name: 'irm', type: 'address' },
      { name: 'lltv', type: 'uint256' },
    ],
  },
] as const;

async function fetchLiquidityTargetMarket(
  chainId: number,
  vaultAddress: Address,
): Promise<LiquidityTargetMarket | null> {
  const client = getPublicClient(chainId);
  let raw: `0x${string}` | undefined;
  try {
    raw = (await client.readContract({
      address: vaultAddress,
      abi: metaMorphoV2Abi,
      functionName: 'liquidityData',
    })) as `0x${string}`;
  } catch {
    return null;
  }
  if (!raw || raw === '0x') return null;

  let params: MarketParams;
  try {
    const [decoded] = decodeAbiParameters(MARKET_PARAMS_TUPLE, raw);
    // `decoded` is the tuple shape declared above.
    params = decoded as MarketParams;
  } catch {
    // liquidityData isn't a MarketParams tuple — likely a non-market-v1
    // adapter target. Caller falls back to address display.
    return null;
  }

  // Sanity guard — zero-address params with zero lltv is the "no target"
  // shape; treat as null so the UI doesn't show "0x0 / 0x0 @ 0%".
  const ZERO = '0x0000000000000000000000000000000000000000';
  if (params.loanToken === ZERO && params.collateralToken === ZERO && params.lltv === 0n) {
    return null;
  }

  const collateralToken = await fetchTokenInfo(chainId, params.collateralToken).catch(() => null);
  return {
    marketId: computeMarketId(params),
    params,
    collateralToken,
  };
}

export function useLiquidityTargetMarket(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
) {
  return useQuery<LiquidityTargetMarket | null>({
    queryKey: [...vaultKeys.adapters(chainId ?? 0, vaultAddress!), 'liquidity-target-market'],
    queryFn: () => fetchLiquidityTargetMarket(chainId!, vaultAddress!),
    enabled: !!chainId && !!vaultAddress,
    staleTime: 60_000,
  });
}
