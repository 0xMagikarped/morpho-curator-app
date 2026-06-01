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
  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({ hash });
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

    // useGuardedWriteContract already runs a `simulateContract` preflight
    // on the exact args (PR-2 audit fix). The redundant manual simulate
    // here doubled SEI RPC pressure and could hang silently before the
    // wallet popup ever opened — drop it and rely on the guarded path.
    // Explicit gas limit kept for SEI wallet compatibility.
    const gasEstimate = BigInt(200_000 + allocations.length * 150_000);

    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: "reallocate",
      args,
      chainId,
      gas: gasEstimate,
    });
  };

  // Surface the decoded simulate failure with the same "Reallocation would
  // revert: …" framing the UI already expects.
  const surfaced = simulateError
    ? new Error(`Reallocation would revert: ${simulateError.message}`)
    : error;

  return { reallocate, hash, isPending, isConfirming, isSuccess, error: surfaced, reset };
}
