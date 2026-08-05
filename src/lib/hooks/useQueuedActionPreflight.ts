/**
 * Does a queued V2 action actually go through if you execute it?
 *
 * A matured timelock entry is not the same as an executable one. The timelock
 * only proves the waiting period elapsed; the target function still runs its
 * own checks, and those were evaluated when the action was *submitted*, often
 * weeks earlier. State moves on. RockawayX USDC on Pharos carries live entries
 * that are simply dead:
 *
 *   setCurator(0x22D4dbFf…)            -> Unauthorized()             0x82b42900
 *   increaseAbsoluteCap(collateral …)  -> AbsoluteCapNotIncreasing() 0xa844d937
 *
 * The first is dead for the connected wallet (`setCurator` is owner-only on
 * top of the timelock); the second is dead for everyone, because the cap it
 * would raise to has since been passed.
 *
 * This matters twice over. On its own a row offering a green Execute that
 * reverts is a wasted transaction. In a batch it is worse: `multicall` has no
 * per-call try/catch, so one dead entry reverts the whole thing. Verified —
 * `multicall([all three live entries])` reverts 0x82b42900, while
 * `multicall([the one that passes])` succeeds.
 *
 * So every matured action is dry-run with `eth_call` from the connected wallet
 * before it is offered, and the revert reason is decoded and shown.
 */
import { useQuery } from '@tanstack/react-query';
import { decodeErrorResult, type Address, type PublicClient } from 'viem';
import { getPublicClient } from '../data/rpcClient';
import { MORPHO_METAMORPHO_V2_ERRORS } from '../contracts/morphoErrors';
import { vaultKeys } from '../queryKeys';
import type { PendingV2Action } from './useV2PendingActions';

export type PreflightStatus = 'ok' | 'reverts' | 'unknown';

export interface ActionPreflight {
  status: PreflightStatus;
  /** Decoded custom-error name, e.g. `AbsoluteCapNotIncreasing`. */
  reason: string | null;
}

/**
 * Dig the 4-byte revert payload out of a viem error. The shape varies by
 * transport and error class, so walk the `cause` chain rather than matching one
 * of them.
 */
function revertData(err: unknown): `0x${string}` | null {
  const seen = new Set<unknown>();
  let node: unknown = err;
  while (node && typeof node === 'object' && !seen.has(node)) {
    seen.add(node);
    const n = node as { data?: unknown; cause?: unknown };
    if (typeof n.data === 'string' && n.data.startsWith('0x') && n.data.length >= 10) {
      return n.data as `0x${string}`;
    }
    const nested = (n.data as { data?: unknown } | undefined)?.data;
    if (typeof nested === 'string' && nested.startsWith('0x') && nested.length >= 10) {
      return nested as `0x${string}`;
    }
    node = n.cause;
  }
  return null;
}

function describeRevert(err: unknown): string | null {
  const data = revertData(err);
  if (!data) return null;
  try {
    const decoded = decodeErrorResult({ abi: MORPHO_METAMORPHO_V2_ERRORS, data });
    return decoded.errorName;
  } catch {
    // Unknown selector — the raw 4 bytes still beat "it failed".
    return data.slice(0, 10);
  }
}

export async function preflightActions(
  chainId: number,
  vaultAddress: Address,
  account: Address,
  actions: readonly PendingV2Action[],
): Promise<Record<string, ActionPreflight>> {
  const client = getPublicClient(chainId) as PublicClient;
  const out: Record<string, ActionPreflight> = {};

  await Promise.all(
    actions.map(async (a) => {
      try {
        await client.call({ account, to: vaultAddress, data: a.data });
        out[a.data] = { status: 'ok', reason: null };
      } catch (err) {
        const reason = describeRevert(err);
        // No decodable revert payload means the node refused for some other
        // reason (rate limit, transport). Claiming "would revert" there would
        // block a perfectly good action, so leave it unknown.
        out[a.data] = reason
          ? { status: 'reverts', reason }
          : { status: 'unknown', reason: null };
      }
    }),
  );

  return out;
}

export function useQueuedActionPreflight(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  actions: readonly PendingV2Action[],
  account: Address | undefined,
  enabled = true,
) {
  // Only matured actions are worth dry-running; an immature one reverts on the
  // timelock check and tells us nothing about the call underneath.
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const matured = actions.filter((a) => a.executableAt <= nowSec);
  const signature = matured.map((a) => a.data).join('|');

  const query = useQuery({
    queryKey: [
      ...vaultKeys.adapters(chainId ?? 0, vaultAddress ?? '0x'),
      'queued-action-preflight',
      account,
      signature,
    ],
    queryFn: () => preflightActions(chainId!, vaultAddress!, account!, matured),
    // Results are wallet-specific (`setCurator` is owner-only), so there is
    // nothing meaningful to compute before a wallet is connected.
    enabled: enabled && !!chainId && !!vaultAddress && !!account && matured.length > 0,
    staleTime: 30_000,
  });

  return {
    byData: (query.data ?? {}) as Record<string, ActionPreflight>,
    isChecking: query.isFetching,
  };
}
