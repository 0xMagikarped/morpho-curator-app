import { useState } from "react";
import { useWaitForTransactionReceipt, useAccount } from "wagmi";
import { useGuardedWriteContract } from "../useGuardedWriteContract";
import type { Address } from "viem";
import { BaseError, ContractFunctionRevertedError } from "viem";
import { metaMorphoV1Abi } from "../../lib/contracts/abis";
import { getPublicClient } from "../../lib/data/rpcClient";

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
    error: writeError,
    reset,
  } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({ hash });
  const { address: userAddress } = useAccount();
  const [simulationError, setSimulationError] = useState<Error | null>(null);

  const reallocate = async (allocations: MarketAllocationArg[]) => {
    setSimulationError(null);

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

    // Pre-flight: simulate the call via RPC to get the real revert reason
    // This bypasses Rabby/wallet simulation which may fail on SEI with misleading errors
    if (userAddress) {
      try {
        const client = getPublicClient(chainId);

        await client.simulateContract({
          address: vaultAddress,
          abi: metaMorphoV1Abi,
          functionName: "reallocate",
          args,
          account: userAddress,
        });
        console.log("[reallocate] Pre-flight simulation: SUCCESS");
      } catch (simErr) {
        // Extract meaningful revert reason
        let reason = "Unknown revert";
        if (simErr instanceof BaseError) {
          const revertErr = simErr.walk((e) => e instanceof ContractFunctionRevertedError);
          if (revertErr instanceof ContractFunctionRevertedError) {
            reason = revertErr.data?.errorName ?? revertErr.shortMessage ?? reason;
          } else {
            reason = simErr.shortMessage ?? simErr.message;
          }
        } else if (simErr instanceof Error) {
          reason = simErr.message;
        }

        console.error("[reallocate] Pre-flight simulation FAILED:", reason);
        console.error("[reallocate] Full error:", simErr);

        setSimulationError(new Error(`Reallocation would revert: ${reason}`));
        return; // Don't submit a tx that will revert
      }
    }

    // Explicit gas limit for wallet simulation compatibility on SEI
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

  // Combine errors: simulation error takes priority
  const error = simulationError ?? writeError;

  return { reallocate, hash, isPending, isConfirming, isSuccess, error, reset };
}
