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

/**
 * PR 12 — combine multiple timelock states into one for UIs that batch many
 * timelocked ops behind a single Submit/Wait/Execute button (e.g. abs+rel
 * cap increases batched via `vault.multicall`).
 *
 * Semantics chosen so a single multicall can correctly transition the whole
 * batch through the V2 governance flow:
 *
 *   - `none`           — no ops in the batch (UI hides the button)
 *   - `loading`        — at least one op is still loading its on-chain state
 *   - `not_submitted`  — at least one op has `executableAt == 0` (a fresh
 *                        multicall must `submit` *every* op to make progress;
 *                        the batch is only fully submitted when each calldata
 *                        has a non-zero `executableAt`).
 *   - `pending`        — all ops submitted, but the slowest hasn't elapsed
 *                        yet; `executableAt` is the max across the batch so
 *                        the UI can show one accurate unlock time.
 *   - `executable`     — every op's `executableAt` has elapsed and the
 *                        batched execute multicall will succeed.
 */
export type CombinedTimelockStep =
  | { step: 'none' }
  | { step: 'loading' }
  | { step: 'not_submitted' }
  | { step: 'pending'; executableAt: bigint }
  | { step: 'executable' };

export function combineTimelockSteps(states: TimelockOpState[]): CombinedTimelockStep {
  if (states.length === 0) return { step: 'none' };
  if (states.some((s) => s.step === 'loading')) return { step: 'loading' };
  // Any unsubmitted calldata blocks the whole batch — a multicall execute
  // that contains an un-timelocked entry reverts `DataNotTimelocked`.
  if (states.some((s) => s.executableAt === 0n)) return { step: 'not_submitted' };
  // All submitted; check if every one has elapsed.
  if (states.some((s) => s.step === 'pending')) {
    const executableAt = states.reduce(
      (max, s) => (s.executableAt > max ? s.executableAt : max),
      0n,
    );
    return { step: 'pending', executableAt };
  }
  return { step: 'executable' };
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
