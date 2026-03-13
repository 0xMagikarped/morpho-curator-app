import { useQuery } from "@tanstack/react-query";
import { type AccrualVault, type VaultMarketAllocation, type MarketId } from "@morpho-org/blue-sdk";
import { fetchAccrualVault } from "@morpho-org/blue-sdk-viem";
import type { Address } from "viem";
import { getMorphoClient } from "../../lib/morpho/clients";
import { isMorphoSdkSupported } from "../../lib/morpho/sdk-config";
import { sdkKeys } from "../../lib/queryKeys";

export interface VaultAllocationsData {
  vault: AccrualVault;
  allocations: VaultMarketAllocation[];
  totalAssets: bigint;
  supplyQueue: MarketId[];
  withdrawQueue: MarketId[];
}

/**
 * Fetch vault allocation details via SDK.
 * AccrualVault already contains the allocations map — no separate fetch needed.
 */
export function useVaultAllocationsSdk(
  vaultAddress: Address | undefined,
  chainId: number | undefined,
) {
  return useQuery<VaultAllocationsData>({
    queryKey: sdkKeys.allocations(vaultAddress!, chainId!),
    queryFn: async () => {
      const client = getMorphoClient(chainId!);
      const vault = await fetchAccrualVault(vaultAddress!, client);

      // AccrualVault.allocations is a Map<MarketId, VaultMarketAllocation>
      const allocations = Array.from(vault.allocations.values());

      return {
        vault,
        allocations,
        totalAssets: vault.totalAssets,
        supplyQueue: [...vault.supplyQueue],
        withdrawQueue: [...vault.withdrawQueue],
      };
    },
    enabled: !!vaultAddress && !!chainId && isMorphoSdkSupported(chainId),
    staleTime: 30_000,
  });
}
