/**
 * Pending Timelock proposal discovery for MoolahVault governance.
 *
 * Two sources are merged:
 *   1. The local `scheduledOps` slice in `appStore` — every propose the app
 *      issued is persisted, so we never lose track of our own proposals even
 *      when the RPC prunes logs (BSC public nodes keep a narrow window).
 *   2. `CallScheduled` logs queried over a recent block window. Picks up
 *      proposals submitted from Safe, CLI, or other curator tooling.
 *
 * For each op id we read `getTimestamp(id)` — 0 means unknown/expired,
 * non-zero is the earliest execution time.
 */

import {
  type Address,
  type PublicClient,
  decodeFunctionData,
} from 'viem';
import { timelockControllerAbi, moolahVaultAbi } from '../contracts/moolahAbis';
import { metaMorphoV1Abi } from '../contracts/abis';

export interface TimelockProposal {
  opId: `0x${string}`;
  timelock: Address;
  target: Address;
  value: bigint;
  data: `0x${string}`;
  predecessor: `0x${string}`;
  salt: `0x${string}`;
  delay: bigint;
  /** Unix seconds — when the op becomes executable. 0 means not scheduled or already executed. */
  readyAt: bigint;
  /** `true` once block.timestamp passes readyAt. */
  isReady: boolean;
  /** `true` once `CallExecuted` has fired (readyAt stays non-zero but marked done). */
  isDone: boolean;
  /** Human label derived from function-selector. 'Unknown call · 0xabcd…' if unresolvable. */
  label: string;
  /** Block timestamp of the `CallScheduled` tx, if known. */
  scheduledAt?: number;
  /** Tx hash of the schedule, if known. */
  txHash?: `0x${string}`;
}

/** Best-effort selector → label map for common vault writes. */
const KNOWN_SELECTORS: Record<string, string> = {
  // MetaMorpho-compatible setters preserved by MoolahVault
  '0x8bb7ce69': 'submitCap',
  '0x4ed5e1be': 'acceptCap',
  '0xd82ce95f': 'revokePendingCap',
  '0xe4dcfaf5': 'setSupplyQueue',
  '0x6ef35ac4': 'updateWithdrawQueue',
  '0xe4a6c22a': 'reallocate',
  '0xa7a4c13d': 'setFeeRecipient',
  '0x8c65c4c0': 'setFee',
  '0x3fb60e06': 'setCurator',
  '0xb192a84a': 'setIsAllocator',
  '0xe45aec31': 'setTimelock',
  '0x33b1e7b0': 'setSkimRecipient',
  // Moolah-only writes
  '0x8456cb59': 'pause',
  '0x3f4ba83a': 'unpause',
  '0x01ffc9a7': 'supportsInterface',
  '0x2f2ff15d': 'grantRole',
  '0xd547741f': 'revokeRole',
  '0x36568abe': 'renounceRole',
};

export function labelCalldata(data: `0x${string}`): string {
  if (!data || data.length < 10) return 'Unknown call';
  const selector = data.slice(0, 10).toLowerCase();
  const known = KNOWN_SELECTORS[selector];
  if (known) {
    // Try to decode args for a slightly richer label (vault setters only).
    try {
      const decoded = decodeFunctionData({ abi: metaMorphoV1Abi, data });
      return `${decoded.functionName}(${String(decoded.args?.[0] ?? '')})`.slice(0, 80);
    } catch {
      try {
        const decoded = decodeFunctionData({ abi: moolahVaultAbi, data });
        return decoded.functionName;
      } catch {
        return known;
      }
    }
  }
  return `Unknown call · ${selector}`;
}

const BSC_LOG_WINDOW = 900_000n; // ~30 days of BSC @ 3s blocks
const DEFAULT_LOG_WINDOW = 200_000n; // good for ETH/Base

export async function fetchTimelockProposals(
  client: PublicClient,
  timelock: Address,
  chainId: number,
  /** Optional local ops to seed the set — saves a hit when the RPC prunes. */
  seedOpIds: `0x${string}`[] = [],
): Promise<TimelockProposal[]> {
  if (!timelock) return [];

  const window = chainId === 56 ? BSC_LOG_WINDOW : DEFAULT_LOG_WINDOW;
  let fromBlock: bigint = 0n;
  try {
    const latest = await client.getBlockNumber();
    fromBlock = latest > window ? latest - window : 0n;
  } catch {
    fromBlock = 0n;
  }

  type ScheduledLog = {
    args?: {
      id?: `0x${string}`;
      target?: Address;
      value?: bigint;
      data?: `0x${string}`;
      predecessor?: `0x${string}`;
      delay?: bigint;
    };
    blockNumber?: bigint;
    transactionHash?: `0x${string}`;
  };

  let scheduledLogs: ScheduledLog[] = [];
  let executedIds = new Set<string>();
  let cancelledIds = new Set<string>();
  try {
    const [sched, exec, cancel] = await Promise.all([
      client.getContractEvents({
        address: timelock,
        abi: timelockControllerAbi,
        eventName: 'CallScheduled',
        fromBlock,
        toBlock: 'latest',
      }) as Promise<ScheduledLog[]>,
      client.getContractEvents({
        address: timelock,
        abi: timelockControllerAbi,
        eventName: 'CallExecuted',
        fromBlock,
        toBlock: 'latest',
      }),
      client.getContractEvents({
        address: timelock,
        abi: timelockControllerAbi,
        eventName: 'Cancelled',
        fromBlock,
        toBlock: 'latest',
      }),
    ]);
    scheduledLogs = sched;
    executedIds = new Set(
      exec
        .map((l) => (l as { args?: { id?: string } }).args?.id?.toLowerCase())
        .filter((x): x is string => Boolean(x)),
    );
    cancelledIds = new Set(
      cancel
        .map((l) => (l as { args?: { id?: string } }).args?.id?.toLowerCase())
        .filter((x): x is string => Boolean(x)),
    );
  } catch {
    // Some public RPCs reject wide getLogs queries on large windows — fall
    // back to seed-only. The app still sees its own proposals.
  }

  const ops = new Map<string, {
    opId: `0x${string}`;
    target: Address;
    value: bigint;
    data: `0x${string}`;
    predecessor: `0x${string}`;
    salt: `0x${string}`;
    delay: bigint;
    txHash?: `0x${string}`;
    blockNumber?: bigint;
  }>();

  for (const log of scheduledLogs) {
    const args = log.args;
    if (!args?.id) continue;
    ops.set(args.id.toLowerCase(), {
      opId: args.id as `0x${string}`,
      target: args.target ?? ('0x0000000000000000000000000000000000000000' as Address),
      value: args.value ?? 0n,
      data: args.data ?? ('0x' as `0x${string}`),
      predecessor: args.predecessor ?? ('0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`),
      salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
      delay: args.delay ?? 0n,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    });
  }

  // Seed with local-only ops the RPC pruned.
  for (const id of seedOpIds) {
    const key = id.toLowerCase();
    if (!ops.has(key)) {
      ops.set(key, {
        opId: id,
        target: '0x0000000000000000000000000000000000000000' as Address,
        value: 0n,
        data: '0x' as `0x${string}`,
        predecessor: '0x0000000000000000000000000000000000000000000000000000000000000000',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
        delay: 0n,
      });
    }
  }

  if (ops.size === 0) return [];

  // Read readyAt for every op + block timestamp for headers in parallel.
  const entries = Array.from(ops.values());
  const [timestamps, currentBlock] = await Promise.all([
    Promise.all(
      entries.map((op) =>
        client
          .readContract({
            address: timelock,
            abi: timelockControllerAbi,
            functionName: 'getTimestamp',
            args: [op.opId],
          })
          .catch(() => 0n) as Promise<bigint>,
      ),
    ),
    client.getBlock().catch(() => null),
  ]);

  const now = currentBlock ? Number(currentBlock.timestamp) : Math.floor(Date.now() / 1000);

  const proposals: TimelockProposal[] = entries.map((op, i) => {
    const readyAt = timestamps[i];
    const isDone = executedIds.has(op.opId.toLowerCase());
    const isCancelled = cancelledIds.has(op.opId.toLowerCase());
    return {
      opId: op.opId,
      timelock,
      target: op.target,
      value: op.value,
      data: op.data,
      predecessor: op.predecessor,
      salt: op.salt,
      delay: op.delay,
      readyAt,
      // `getTimestamp` returns 1 for "done" in some OZ versions, but we lean
      // on the event signal instead — more reliable across forks.
      isReady: !isCancelled && !isDone && readyAt > 0n && Number(readyAt) <= now,
      isDone: isDone || isCancelled,
      label: op.data && op.data !== '0x' ? labelCalldata(op.data) : 'Unknown call',
      txHash: op.txHash,
    };
  });

  return proposals
    .filter((p) => !p.isDone) // Don't show already-executed / cancelled ops
    .sort((a, b) => Number(a.readyAt - b.readyAt));
}
