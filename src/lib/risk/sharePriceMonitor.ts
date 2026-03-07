import { createPublicClient, http } from 'viem';
import { getChainConfig } from '../../config/chains';
import { metaMorphoV1Abi } from '../contracts/abis';
import { sharePriceStatus, type SharePriceData } from './riskTypes';
import { getLatestSharePrice, saveSharePriceRecord } from './riskDB';

const ONE_SHARE = 10n ** 18n;

export async function checkSharePrice(
  chainId: number,
  vaultAddress: `0x${string}`,
): Promise<SharePriceData> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unknown chain: ${chainId}`);

  const client = createPublicClient({
    transport: http(chainConfig.rpcUrls[0]),
  });

  const [sharePrice, totalAssets] = await Promise.all([
    client.readContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'convertToAssets',
      args: [ONE_SHARE],
    }) as Promise<bigint>,
    client.readContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: 'totalAssets',
    }) as Promise<bigint>,
  ]);

  // Save to history
  await saveSharePriceRecord({
    vaultAddress,
    chainId,
    sharePrice: sharePrice.toString(),
    totalAssets: totalAssets.toString(),
    timestamp: Date.now(),
  });

  // Get previous price for comparison
  const previous = await getLatestSharePrice(vaultAddress, chainId, Date.now() - 24 * 60 * 60 * 1000);
  const previousPrice = previous ? BigInt(previous.sharePrice) : null;

  let priceChange = 0;
  if (previousPrice && previousPrice > 0n) {
    priceChange = (Number(sharePrice - previousPrice) / Number(previousPrice)) * 100;
  }

  return {
    vaultAddress,
    chainId,
    sharePrice,
    timestamp: Date.now(),
    previousPrice,
    priceChange,
    status: sharePriceStatus(priceChange),
  };
}
