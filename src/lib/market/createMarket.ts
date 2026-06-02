import type { Address, PublicClient } from 'viem';
import { morphoBlueAbi } from '../contracts/abis';

export { computeMarketId, type MarketParamsStruct } from './marketId';

/**
 * Check whether a market already exists on Morpho Blue.
 * A market exists if its lastUpdate field is > 0.
 */
export async function checkMarketExists(
  client: PublicClient,
  morphoAddress: Address,
  marketId: `0x${string}`,
): Promise<boolean> {
  try {
    const result = await client.readContract({
      address: morphoAddress,
      abi: morphoBlueAbi,
      functionName: 'market',
      args: [marketId],
    });
    // result[4] is lastUpdate — non-zero means the market has been created
    return result[4] > 0n;
  } catch {
    return false;
  }
}
