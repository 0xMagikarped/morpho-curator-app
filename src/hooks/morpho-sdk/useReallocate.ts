import { useWaitForTransactionReceipt, useAccount } from "wagmi";
import { useGuardedWriteContract } from "../useGuardedWriteContract";
import type { Address } from "viem";
import { metaMorphoV1Abi } from "../../lib/contracts/abis";

export interface MarketAllocationArg {
  marketParams: {
    loanToken: Address;
    collateralToken: Address;
    oracle: Address;
    irm: Address;
    lltv: bigint;
  };
  assets: bigint;
}

/**
 * Hook to execute a vault reallocation via the MetaMorpho V1 `reallocate()` function.
 *
 * Includes a pre-flight simulation via RPC to surface the real revert reason
 * instead of relying on wallet (Rabby/MetaMask) simulation which may fail
 * with misleading errors on non-mainnet chains like SEI.
 */
export function useReallocate(vaultAddress: Address, chainId: number) {
  const {
    writeContract,
    data: hash,
    isPending,
    error,
    simulateError,
    reset,
  } = useGuardedWriteContract();
  // Pin the receipt watcher to the vault's chain. Without this wagmi V2
  // defaults to the connected chain, which is fine 99% of the time but
  // not robust if the wallet drifts mid-flight.
  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({ hash, chainId });
  const { address: userAddress } = useAccount();

  const reallocate = async (allocations: MarketAllocationArg[]) => {
    // Log the exact allocations for debugging
    console.log("[reallocate] Vault:", vaultAddress, "Chain:", chainId);
    console.log("[reallocate] Caller:", userAddress);
    console.log("[reallocate] Allocations:");
    for (const a of allocations) {
      const isMax = a.assets === 2n ** 256n - 1n;
      console.log(
        `  loan=${a.marketParams.loanToken} collateral=${a.marketParams.collateralToken}`,
        `\n  oracle=${a.marketParams.oracle} irm=${a.marketParams.irm} lltv=${a.marketParams.lltv}`,
        `\n  assets=${isMax ? "MAX_UINT256 (catcher)" : a.assets.toString()}`,
      );
    }

    const args = [
      allocations.map((a) => ({
        marketParams: a.marketParams,
        assets: a.assets,
      })),
    ] as const;

    // Keep the explicit `gas:` (cd8659c). In wagmi v2 writeContract
    // uses the wallet client; when `gas` is omitted, viem calls
    // `eth_estimateGas` THROUGH THE WALLET'S PROVIDER — i.e. via the
    // wallet's bundled SEI RPC, which on most setups is publicnode
    // (slow / throttled). That extra round-trip was making the popup
    // hang on SEI. Setting gas explicitly skips that wallet-RPC
    // estimateGas hop entirely; the wallet still runs its own popup
    // simulation but at least viem doesn't add a second slow call.
    // Budget: 200k base + 250k per allocation, with a 600k floor so
    // the single-market case has headroom (reallocate's per-market
    // cost dominates writes/reads against Morpho Blue).
    const proposed = 200_000n + BigInt(allocations.length) * 250_000n;
    const gas = proposed > 600_000n ? proposed : 600_000n;

    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: "reallocate",
      args,
      chainId,
      gas,
    });
  };

  // Surface the decoded simulate failure with the same "Reallocation would
  // revert: …" framing the UI already expects.
  const surfaced = simulateError
    ? new Error(`Reallocation would revert: ${simulateError.message}`)
    : error;

  return { reallocate, hash, isPending, isConfirming, isSuccess, error: surfaced, reset };
}
