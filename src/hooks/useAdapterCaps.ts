/**
 * Hook to read all three levels of V2 caps for an adapter on a vault.
 */
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { getPublicClient } from '../lib/data/rpcClient';
import {
  adapterIdData,
  collateralIdData,
  marketIdData,
  capId,
} from '../lib/v2/adapterCapUtils';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';
import { vaultKeys } from '../lib/queryKeys';
import type { MarketParams, CapLevel } from '../types';

export interface CapReading {
  level: CapLevel;
  label: string;
  id: `0x${string}`;
  absoluteCap: bigint;
  relativeCap: bigint;
  allocation: bigint;
}

async function fetchCapsForAdapter(
  chainId: number,
  vaultAddress: Address,
  adapterAddress: Address,
  marketParams?: MarketParams,
): Promise<CapReading[]> {
  const client = getPublicClient(chainId);
  const results: CapReading[] = [];

  // 1. Adapter-level cap
  const adapterData = adapterIdData(adapterAddress);
  const adapterId = capId(adapterData);

  const [adapterAbsCap, adapterRelCap, adapterAlloc] = await Promise.all([
    client.readContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'absoluteCap', args: [adapterId] }).catch(() => 0n),
    client.readContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'relativeCap', args: [adapterId] }).catch(() => 0n),
    client.readContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'allocation', args: [adapterId] }).catch(() => 0n),
  ]);

  results.push({
    level: 'adapter',
    label: 'Adapter',
    id: adapterId,
    absoluteCap: adapterAbsCap,
    relativeCap: adapterRelCap,
    allocation: adapterAlloc,
  });

  // 2. Collateral-level cap (if market params provided)
  if (marketParams) {
    const collData = collateralIdData(marketParams.collateralToken);
    const collId = capId(collData);

    const [collAbsCap, collRelCap, collAlloc] = await Promise.all([
      client.readContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'absoluteCap', args: [collId] }).catch(() => 0n),
      client.readContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'relativeCap', args: [collId] }).catch(() => 0n),
      client.readContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'allocation', args: [collId] }).catch(() => 0n),
    ]);

    results.push({
      level: 'collateral',
      label: 'Collateral',
      id: collId,
      absoluteCap: collAbsCap,
      relativeCap: collRelCap,
      allocation: collAlloc,
    });

    // 3. Market-level cap
    const mktData = marketIdData(adapterAddress, marketParams);
    const mktId = capId(mktData);

    const [mktAbsCap, mktRelCap, mktAlloc] = await Promise.all([
      client.readContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'absoluteCap', args: [mktId] }).catch(() => 0n),
      client.readContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'relativeCap', args: [mktId] }).catch(() => 0n),
      client.readContract({ address: vaultAddress, abi: metaMorphoV2Abi, functionName: 'allocation', args: [mktId] }).catch(() => 0n),
    ]);

    results.push({
      level: 'market',
      label: 'Market',
      id: mktId,
      absoluteCap: mktAbsCap,
      relativeCap: mktRelCap,
      allocation: mktAlloc,
    });
  }

  return results;
}

export function useAdapterCaps(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  adapterAddress: Address | undefined,
  marketParams?: MarketParams,
) {
  return useQuery<CapReading[]>({
    queryKey: [
      ...vaultKeys.adapters(chainId!, vaultAddress!),
      'caps',
      adapterAddress?.toLowerCase(),
      marketParams?.collateralToken?.toLowerCase(),
    ],
    queryFn: () => fetchCapsForAdapter(chainId!, vaultAddress!, adapterAddress!, marketParams),
    enabled: !!chainId && !!vaultAddress && !!adapterAddress,
    staleTime: 30_000,
  });
}
