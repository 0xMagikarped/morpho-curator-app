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

    // No `gas:` override — every other write in this app (acceptCap,
    // submit, V2 setters, …) lets viem call eth_estimateGas via the
    // configured transport, and they all sign cleanly on SEI. The
    // hardcoded budget here (added in cd8659c to bypass a Rabby
    // Tenderly preflight on mainnet) made `useReallocate` the lone
    // outlier and caused the wallet popup to hang on SEI: when `gas`
    // is user-supplied, MetaMask/Rabby validate the override against
    // their own (often slow) bundled SEI RPC instead of using viem's
    // result, and a stalled wallet RPC leaves writeContract stuck on
    // isPending forever. The PR-2 simulateContract preflight in
    // useGuardedWriteContract already proves the call succeeds against
    // the app's sei-apis-first transport, so estimateGas — running on
    // the same path — won't fail either.
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: "reallocate",
      args,
      chainId,
    });
  };

  // Surface the decoded simulate failure with the same "Reallocation would
  // revert: …" framing the UI already expects.
  const surfaced = simulateError
    ? new Error(`Reallocation would revert: ${simulateError.message}`)
    : error;

  return { reallocate, hash, isPending, isConfirming, isSuccess, error: surfaced, reset };
}
