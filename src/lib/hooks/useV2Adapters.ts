/**
 * Hooks for V2 vault adapter management.
 */
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { getPublicClient } from '../data/rpcClient';
import { fetchV2Adapters, type V2AdapterData } from '../data/rpcClient';
import {
  fetchLiquidityAdapter,
  fetchAdapterCaps,
  computeVaultAdapterId,
  detectAdapterType,
  contractExists,
  isAdapterEnabled,
  type AdapterDetectionResult,
} from '../v2/adapterUtils';

// ============================================================
// Enhanced adapter data with caps and liquidity status
// ============================================================

export interface V2AdapterFull extends V2AdapterData {
  adapterId: `0x${string}`;
  absoluteCap: bigint;
  relativeCap: bigint;
  allocationOnChain: bigint;
  isLiquidityAdapter: boolean;
}

export interface V2AdapterOverview {
  adapters: V2AdapterFull[];
  liquidityAdapter: Address | null;
  totalAssets: bigint;
  idle: bigint;
}

/**
 * Fetch full adapter data including caps and liquidity adapter status.
 */
async function fetchV2AdapterOverview(
  chainId: number,
  vaultAddress: Address,
  totalAssets: bigint,
): Promise<V2AdapterOverview> {
  const client = getPublicClient(chainId);

  const [baseAdapters, liqAdapter] = await Promise.all([
    fetchV2Adapters(chainId, vaultAddress),
    fetchLiquidityAdapter(vaultAddress, client),
  ]);

  const liqLower = liqAdapter?.toLowerCase() ?? '';

  // Enrich each adapter with caps
  const enriched = await Promise.all(
    baseAdapters.map(async (a): Promise<V2AdapterFull> => {
      const adapterId = computeVaultAdapterId(a.address);
      const caps = await fetchAdapterCaps(vaultAddress, adapterId, client);
      return {
        ...a,
        adapterId,
        absoluteCap: caps.absoluteCap,
        relativeCap: caps.relativeCap,
        allocationOnChain: caps.allocation,
        isLiquidityAdapter: a.address.toLowerCase() === liqLower,
      };
    }),
  );

  const totalAllocated = enriched.reduce((sum, a) => sum + a.realAssets, 0n);
  const idle = totalAssets > totalAllocated ? totalAssets - totalAllocated : 0n;

  return {
    adapters: enriched,
    liquidityAdapter: liqAdapter,
    totalAssets,
    idle,
  };
}

/**
 * Hook: full adapter overview for a V2 vault.
 */
export function useV2AdapterOverview(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  totalAssets: bigint | undefined,
) {
  return useQuery<V2AdapterOverview>({
    queryKey: ['v2-adapter-overview', chainId, vaultAddress, totalAssets?.toString()],
    queryFn: () => fetchV2AdapterOverview(chainId!, vaultAddress!, totalAssets ?? 0n),
    enabled: !!chainId && !!vaultAddress,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ============================================================
// Adapter Preview (for Add Adapter flow)
// ============================================================

export interface AdapterPreview {
  contractExists: boolean;
  isAlreadyEnabled: boolean;
  detection: AdapterDetectionResult;
  assetMatch: boolean | null; // null if couldn't determine
}

async function fetchAdapterPreview(
  chainId: number,
  vaultAddress: Address,
  adapterAddress: Address,
  vaultAsset: Address,
): Promise<AdapterPreview> {
  const client = getPublicClient(chainId);

  const [exists, alreadyEnabled, detection] = await Promise.all([
    contractExists(adapterAddress, client),
    isAdapterEnabled(vaultAddress, adapterAddress, client),
    detectAdapterType(adapterAddress, client),
  ]);

  let assetMatch: boolean | null = null;
  if (detection.asset) {
    assetMatch = detection.asset.toLowerCase() === vaultAsset.toLowerCase();
  }

  return {
    contractExists: exists,
    isAlreadyEnabled: alreadyEnabled,
    detection,
    assetMatch,
  };
}

/**
 * Hook: preview an adapter before adding it to a vault.
 */
export function useAdapterPreview(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  adapterAddress: Address | undefined,
  vaultAsset: Address | undefined,
  enabled: boolean,
) {
  return useQuery<AdapterPreview>({
    queryKey: ['adapter-preview', chainId, vaultAddress, adapterAddress],
    queryFn: () => fetchAdapterPreview(chainId!, vaultAddress!, adapterAddress!, vaultAsset!),
    enabled: enabled && !!chainId && !!vaultAddress && !!adapterAddress && !!vaultAsset,
    staleTime: 60_000,
  });
}
