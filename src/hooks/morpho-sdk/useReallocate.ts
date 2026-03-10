import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import type { Address } from "viem";
import { metaMorphoV1Abi } from "../../lib/contracts/abis";

const MAX_UINT256 = 2n ** 256n - 1n;

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
 * CRITICAL: The last allocation entry should use MAX_UINT256 as the "max catcher"
 * to absorb rounding dust and prevent reverts.
 */
export function useReallocate(vaultAddress: Address, chainId: number) {
  const {
    writeContract,
    data: hash,
    isPending,
    error,
    reset,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({ hash });

  const reallocate = (allocations: MarketAllocationArg[]) => {
    writeContract({
      address: vaultAddress,
      abi: metaMorphoV1Abi,
      functionName: "reallocate",
      args: [
        allocations.map((a) => ({
          marketParams: a.marketParams,
          assets: a.assets,
        })),
      ],
      chainId,
    });
  };

  return { reallocate, hash, isPending, isConfirming, isSuccess, error, reset };
}

/**
 * Build the allocations array for `reallocate()` with a max-catcher on the last entry.
 *
 * The catcher market absorbs rounding dust — its `assets` is set to type(uint256).max.
 * The last entry in `targets` is used as the catcher.
 * Reorder your targets so the catcher market (e.g. idle or largest) is last before calling.
 */
export function buildReallocateArgs(
  targets: MarketAllocationArg[],
): MarketAllocationArg[] {
  return targets.map((t, i) => {
    if (i === targets.length - 1) {
      return { ...t, assets: MAX_UINT256 };
    }
    return t;
  });
}

/**
 * Reorder allocations so withdrawals come first, supplies second,
 * and the catcher (MAX_UINT256) is last.
 */
export function orderAllocations(
  allocations: MarketAllocationArg[],
  currentAssets: Map<string, bigint>,
  catcherIndex: number,
): MarketAllocationArg[] {
  const result = [...allocations];

  // Move catcher to end
  const [catcher] = result.splice(catcherIndex, 1);

  // Sort: withdrawals (target < current) first, then supplies
  result.sort((a, b) => {
    const aKey = `${a.marketParams.loanToken}-${a.marketParams.collateralToken}-${a.marketParams.oracle}-${a.marketParams.irm}-${a.marketParams.lltv}`;
    const bKey = `${b.marketParams.loanToken}-${b.marketParams.collateralToken}-${b.marketParams.oracle}-${b.marketParams.irm}-${b.marketParams.lltv}`;
    const aCurrent = currentAssets.get(aKey) ?? 0n;
    const bCurrent = currentAssets.get(bKey) ?? 0n;
    const aDelta = a.assets - aCurrent;
    const bDelta = b.assets - bCurrent;
    // Withdrawals (negative delta) first
    if (aDelta < 0n && bDelta >= 0n) return -1;
    if (aDelta >= 0n && bDelta < 0n) return 1;
    return 0;
  });

  // Append catcher with MAX_UINT256
  if (catcher) {
    result.push({ ...catcher, assets: MAX_UINT256 });
  }

  return result;
}
