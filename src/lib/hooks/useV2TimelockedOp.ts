import { useReadContract } from 'wagmi';
import { vaultV2RegistryAbi } from '../contracts/vaultV2RegistryAbi';

/**
 * Morpho Vault V2 timelock state for a single operation.
 *
 * Vault V2 timelocks every config change: `submit(calldata)` queues an op;
 * after `executableAt`, the target function (e.g. `addAdapter`) is called
 * directly and self-checks `executableAt`. The whole UI for any timelocked
 * op needs Submit → Wait → Execute. PR 10 / PR 7 / PR 9 fix this — this
 * hook is the shared state derivation used by every consumer.
 *
 * The `0-duration timelock` case collapses naturally: `submit` sets
 * `executableAt = now + 0 = now`, so Execute is immediately enabled.
 */

export type TimelockStep = 'loading' | 'not_submitted' | 'pending' | 'executable';

export interface TimelockOpState {
  step: TimelockStep;
  /** Unix-seconds the op becomes executable (0 = not submitted). */
  executableAt: bigint;
}

/** Pure derivation — unit-testable without React. */
export function deriveTimelockStep(
  executableAt: bigint,
  nowSec: bigint,
): Exclude<TimelockStep, 'loading'> {
  if (executableAt === 0n) return 'not_submitted';
  if (executableAt > nowSec) return 'pending';
  return 'executable';
}

interface Opts {
  vaultAddress: `0x${string}` | undefined;
  chainId: number | undefined;
  /** Exact calldata that gets `submit`-ed (the key `executableAt` is indexed by). */
  calldata: `0x${string}` | undefined;
  /** Set false to pause polling (e.g., drawer closed). */
  enabled?: boolean;
}

export function useV2TimelockedOp({
  vaultAddress,
  chainId,
  calldata,
  enabled = true,
}: Opts): TimelockOpState {
  const { data, isLoading } = useReadContract({
    address: vaultAddress,
    abi: vaultV2RegistryAbi,
    functionName: 'executableAt',
    args: calldata ? [calldata] : undefined,
    chainId,
    query: {
      enabled: enabled && !!vaultAddress && !!chainId && !!calldata,
      // Poll so the state advances from `pending` → `executable` and from
      // `not_submitted` → `pending`/`executable` after a submit tx confirms.
      refetchInterval: 10_000,
      staleTime: 5_000,
    },
  });

  if (!enabled || !vaultAddress || !chainId || !calldata) {
    return { step: 'not_submitted', executableAt: 0n };
  }
  if (isLoading && data === undefined) {
    return { step: 'loading', executableAt: 0n };
  }
  const executableAt = (data as bigint | undefined) ?? 0n;
  const now = BigInt(Math.floor(Date.now() / 1000));
  return { step: deriveTimelockStep(executableAt, now), executableAt };
}
