import { useQuery } from "@tanstack/react-query";
import { type AccrualVault } from "@morpho-org/blue-sdk";
import { fetchAccrualVault } from "@morpho-org/blue-sdk-viem";
import type { Address } from "viem";
import { getMorphoClient } from "../../lib/morpho/clients";
import { isMorphoSdkSupported } from "../../lib/morpho/sdk-config";

/**
 * Fetch a vault's full on-chain state via the Morpho SDK.
 * Returns an AccrualVault which includes allocations, APY, and netApy.
 */
export function useVaultSdk(
  vaultAddress: Address | undefined,
  chainId: number | undefined,
) {
  return useQuery<AccrualVault>({
    queryKey: ["morpho-sdk-vault", vaultAddress, chainId],
    queryFn: async () => {
      const client = getMorphoClient(chainId!);
      return fetchAccrualVault(vaultAddress!, client);
    },
    enabled: !!vaultAddress && !!chainId && isMorphoSdkSupported(chainId),
    staleTime: 30_000,
  });
}
