/**
 * PR 22 — fetch the per-collateral and per-market cap entries for one V2
 * adapter, in addition to its adapter-level cap.
 *
 * V2 caps are a three-level hierarchy keyed on `keccak256(idData)`:
 *
 *   adapter    : abi.encode("this", adapter)
 *   collateral : abi.encode("collateralToken", collateralToken)
 *   market     : abi.encode("this/marketParams", adapter, marketParams)
 *
 * The adapter's tracked markets come from its on-chain `marketIds()` array
 * (populated only after the first `allocate`). For each tracked market we
 * derive both the market-level and the collateral-level idData/key and
 * read `absoluteCap` / `relativeCap` from the vault. Unique collaterals
 * are deduplicated.
 *
 * Used by `V2CapsTab` to render the three-level table.
 */
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { keccak256 } from 'viem';
import { getPublicClient, fetchAdapterMarketPositions } from '../lib/data/rpcClient';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';
import { adapterIdData, collateralIdData, marketIdData } from '../lib/v2/adapterCapUtils';
import { vaultKeys } from '../lib/queryKeys';
import type { TokenInfo, MarketParams } from '../types';

export interface MarketCapEntry {
  marketId: `0x${string}`;
  params: MarketParams;
  collateralToken: TokenInfo;
  loanSupplyAssets: bigint;
  idData: `0x${string}`;
  absoluteCap: bigint;
  relativeCap: bigint;
}

export interface CollateralCapEntry {
  collateralToken: TokenInfo;
  idData: `0x${string}`;
  absoluteCap: bigint;
  relativeCap: bigint;
}

export interface AdapterAllCaps {
  marketCaps: MarketCapEntry[];
  collateralCaps: CollateralCapEntry[];
}

const CAP_GETTER_ABI = [
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'absoluteCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'relativeCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

async function fetchAdapterAllCaps(
  chainId: number,
  vaultAddress: Address,
  adapterAddress: Address,
  morphoBlue: Address | null,
  type: 'market-v1' | 'vault-v1' | 'unknown',
): Promise<AdapterAllCaps> {
  // Only market-v1 adapters carry the (adapter, market) caps and the
  // per-collateral caps relative to a market — vault-v1 adapters route to
  // an underlying V1 vault, which has its own internal cap model.
  if (type !== 'market-v1' || !morphoBlue) {
    return { marketCaps: [], collateralCaps: [] };
  }

  const positions = await fetchAdapterMarketPositions(chainId, adapterAddress, morphoBlue);
  if (positions.length === 0) {
    return { marketCaps: [], collateralCaps: [] };
  }

  const client = getPublicClient(chainId);

  // ---- market-level caps ------------------------------------------------
  const marketCaps: MarketCapEntry[] = await Promise.all(
    positions.map(async (p) => {
      const idData = marketIdData(adapterAddress, p.params!);
      const id = keccak256(idData);
      const [absoluteCap, relativeCap] = await Promise.all([
        client.readContract({ address: vaultAddress, abi: CAP_GETTER_ABI, functionName: 'absoluteCap', args: [id] }).catch(() => 0n) as Promise<bigint>,
        client.readContract({ address: vaultAddress, abi: CAP_GETTER_ABI, functionName: 'relativeCap', args: [id] }).catch(() => 0n) as Promise<bigint>,
      ]);
      return {
        marketId: p.marketId,
        params: p.params!,
        collateralToken: p.collateralToken!,
        loanSupplyAssets: p.supplyAssets,
        idData,
        absoluteCap,
        relativeCap,
      };
    }),
  );

  // ---- collateral-level caps (deduped per token) -----------------------
  const seen = new Set<string>();
  const uniqueCollaterals = positions
    .map((p) => p.collateralToken!)
    .filter((t) => {
      const k = t.address.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  const collateralCaps: CollateralCapEntry[] = await Promise.all(
    uniqueCollaterals.map(async (token) => {
      const idData = collateralIdData(token.address);
      const id = keccak256(idData);
      const [absoluteCap, relativeCap] = await Promise.all([
        client.readContract({ address: vaultAddress, abi: CAP_GETTER_ABI, functionName: 'absoluteCap', args: [id] }).catch(() => 0n) as Promise<bigint>,
        client.readContract({ address: vaultAddress, abi: CAP_GETTER_ABI, functionName: 'relativeCap', args: [id] }).catch(() => 0n) as Promise<bigint>,
      ]);
      return { collateralToken: token, idData, absoluteCap, relativeCap };
    }),
  );

  return { marketCaps, collateralCaps };
}

export function useV2AdapterAllCaps(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  adapterAddress: Address | undefined,
  morphoBlue: Address | null | undefined,
  type: 'market-v1' | 'vault-v1' | 'unknown' | undefined,
) {
  return useQuery<AdapterAllCaps>({
    queryKey: [
      ...vaultKeys.adapters(chainId ?? 0, vaultAddress!),
      'all-caps',
      adapterAddress?.toLowerCase(),
    ],
    queryFn: () => fetchAdapterAllCaps(chainId!, vaultAddress!, adapterAddress!, morphoBlue ?? null, type!),
    enabled: !!chainId && !!vaultAddress && !!adapterAddress && !!type,
    staleTime: 30_000,
  });
}

// Re-exports for callers that want to construct the same idData themselves.
export { adapterIdData, collateralIdData, marketIdData };

// Re-export ABI fragment used here for documentation / future tests.
export { metaMorphoV2Abi };
