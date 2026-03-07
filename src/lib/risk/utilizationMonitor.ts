import { createPublicClient, http } from 'viem';
import { getChainConfig } from '../../config/chains';
import { morphoBlueAbi } from '../contracts/abis';
import { utilizationStatus, type UtilizationData } from './riskTypes';

export async function checkMarketUtilization(
  chainId: number,
  marketId: `0x${string}`,
): Promise<UtilizationData> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unknown chain: ${chainId}`);

  const client = createPublicClient({
    transport: http(chainConfig.rpcUrls[0]),
  });

  const result = await client.readContract({
    address: chainConfig.morphoBlue,
    abi: morphoBlueAbi,
    functionName: 'market',
    args: [marketId],
  });

  const totalSupply = result[0] as bigint; // totalSupplyAssets
  const totalBorrow = result[2] as bigint; // totalBorrowAssets
  const utilization = totalSupply > 0n
    ? Number((totalBorrow * 10000n) / totalSupply) / 100
    : 0;

  return {
    marketId,
    chainId,
    totalSupply,
    totalBorrow,
    utilization,
    timestamp: Date.now(),
    status: utilizationStatus(utilization),
  };
}

export async function checkBatchUtilization(
  chainId: number,
  marketIds: `0x${string}`[],
): Promise<Map<`0x${string}`, UtilizationData>> {
  const results = await Promise.allSettled(
    marketIds.map((id) => checkMarketUtilization(chainId, id)),
  );

  const map = new Map<`0x${string}`, UtilizationData>();
  for (let i = 0; i < marketIds.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      map.set(marketIds[i], result.value);
    }
  }
  return map;
}
