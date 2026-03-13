import { useQuery } from "@tanstack/react-query";
import type { MarketId } from "@morpho-org/blue-sdk";
import { LiquidityLoader } from "@morpho-org/liquidity-sdk-viem";
import type { PublicReallocation, SimulationState, MaybeDraft } from "@morpho-org/simulation-sdk";
import { getMorphoClient } from "../../lib/morpho/clients";
import { isMorphoSdkSupported } from "../../lib/morpho/sdk-config";
import { sdkKeys } from "../../lib/queryKeys";

export interface MarketLiquidityData {
  startState: SimulationState;
  endState: MaybeDraft<SimulationState>;
  withdrawals: PublicReallocation[];
  targetBorrowUtilization: bigint;
}

/**
 * Fetch available liquidity for a market via the PublicAllocator.
 * Returns the set of possible public reallocations and the resulting state.
 */
export function useMarketLiquidity(
  marketId: MarketId | undefined,
  chainId: number | undefined,
) {
  return useQuery<MarketLiquidityData>({
    queryKey: sdkKeys.liquidity(marketId!, chainId!),
    queryFn: async () => {
      const client = getMorphoClient(chainId!);
      const loader = new LiquidityLoader(client);
      return loader.fetch(marketId!);
    },
    enabled: !!marketId && !!chainId && isMorphoSdkSupported(chainId),
    staleTime: 60_000,
  });
}
