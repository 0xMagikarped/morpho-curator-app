import { useQuery } from "@tanstack/react-query";
import { type Market, type MarketId } from "@morpho-org/blue-sdk";
import { fetchMarket } from "@morpho-org/blue-sdk-viem";
import { getMorphoClient } from "../../lib/morpho/clients";
import { isMorphoSdkSupported } from "../../lib/morpho/sdk-config";
import { sdkKeys } from "../../lib/queryKeys";

export interface MarketSdkData {
  market: Market;
  utilization: bigint;
  liquidity: bigint;
  supplyApy: number;
  borrowApy: number;
}

/**
 * Fetch a single market's on-chain state via the Morpho SDK.
 */
export function useMarketSdk(
  marketId: MarketId | undefined,
  chainId: number | undefined,
) {
  return useQuery<MarketSdkData>({
    queryKey: sdkKeys.market(marketId!, chainId!),
    queryFn: async () => {
      const client = getMorphoClient(chainId!);
      const market = await fetchMarket(marketId!, client);

      return {
        market,
        utilization: market.utilization,
        liquidity: market.liquidity,
        supplyApy: market.supplyApy,
        borrowApy: market.borrowApy,
      };
    },
    enabled: !!marketId && !!chainId && isMorphoSdkSupported(chainId),
    staleTime: 30_000,
  });
}
