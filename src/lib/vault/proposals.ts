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
  /**
   * Operation salt. Only authoritative when `saltKnown` is true. On
   * external proposals reconstructed from `CallScheduled` events the salt
   * is unknown (OZ v4 doesn't emit it); we default to zero so the UI can
   * display something but MUST NOT use it to execute without explicit
   * curator confirmation.
   */
  salt: `0x${string}`;
  saltKnown: boolean;
  /** `true` when the op comes from our local cache (app-submitted). */
  isLocal: boolean;
  delay: bigint;
  /** Unix seconds — when the op becomes executable. 0 means not scheduled or already executed. */
  readyAt: bigint;
  /** `true` once block.timestamp passes readyAt. */
  isReady: boolean;
  /** `true` once `CallExecuted` has fired (readyAt stays non-zero but marked done). */
  isDone: boolean;
  /**
   * `true` when `scheduledAt + delay + GRACE` is in the past and the
   * timelock reports no pending timestamp (OZ expires ops after grace
   * period). Only computable for local ops where we know `scheduledAt`.
   */
  isExpired: boolean;
  /** Human label derived from function-selector. 'Unknown call · 0xabcd…' if unresolvable. */
  label: string;
  /** Block timestamp of the `CallScheduled` tx, if known. */
  scheduledAt?: number;
  /** Tx hash of the schedule, if known. */
  txHash?: `0x${string}`;
}

/** OpenZeppelin TimelockController's expiry grace period. */
export const TIMELOCK_GRACE_PERIOD_SECONDS = 7 * 86_400;

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

/**
 * Per-chain log-window configuration. BSC public RPCs cap `eth_getLogs` at
 * 5k blocks; ETH/Base are more generous. We always paginate so the scan
 * works regardless of the RPC's limit, only the *default* scan depth
 * varies. The curator can widen via the `pageWindow` + `maxScanBlocks`
 * overrides (for a "scan full history" modal).
 */
interface LogWindowConfig {
  /** Max blocks per `eth_getLogs` call — must be ≤ the RPC's limit. */
  pageWindow: bigint;
  /** Default total scan depth (most recent N blocks). */
  defaultScan: bigint;
  /** Hard cap for the "full history" modal. */
  maxScan: bigint;
}

const LOG_WINDOW_CONFIG: Record<number, LogWindowConfig> = {
  // BSC public-RPC hard cap is 5000 per request. Default to 14 h of
  // history so the curator sees last-day proposals without paginating.
  56: { pageWindow: 5_000n, defaultScan: 16_000n, maxScan: 900_000n },
};
const FALLBACK_CONFIG: LogWindowConfig = {
  pageWindow: 50_000n,
  defaultScan: 200_000n,
  maxScan: 2_000_000n,
};

export function getLogWindowConfig(chainId: number): LogWindowConfig {
  return LOG_WINDOW_CONFIG[chainId] ?? FALLBACK_CONFIG;
}

/**
 * Paginated `getLogs` scan. Works around RPC-imposed per-request block
 * limits (notably BSC public nodes at 5k blocks / request). Returns null
 * if any individual page throws — caller decides whether to fall back to
 * seed-only.
 */
async function scanLogsPaginated<T>(
  fetchPage: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
  windowSize: bigint,
): Promise<T[] | null> {
  const acc: T[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + windowSize - 1n > toBlock ? toBlock : start + windowSize - 1n;
    try {
      const page = await fetchPage(start, end);
      acc.push(...page);
    } catch {
      return null; // Signal partial scan to caller.
    }
    start = end + 1n;
  }
  return acc;
}

export interface FetchProposalsOptions {
  /**
   * Override the default scan depth. Pass a custom value for the "scan
   * full history" modal. Defaults to the chain's `defaultScan`.
   */
  maxScanBlocks?: bigint;
}

export interface FetchProposalsResult {
  proposals: TimelockProposal[];
  /**
   * True when the on-chain scan failed partway through. Caller should
   * render a banner offering a retry / widened scan.
   */
  scanTruncated: boolean;
  /** Actual fromBlock / toBlock covered by the on-chain scan. */
  scanFromBlock: bigint;
  scanToBlock: bigint;
}

export interface LocalOpSeed {
  opId: `0x${string}`;
  target: Address;
  value: bigint;
  data: `0x${string}`;
  predecessor: `0x${string}`;
  /** Authoritative salt from our `schedule(...)` call. */
  salt: `0x${string}`;
  delay: bigint;
  scheduledAt?: number;
  txHash?: `0x${string}`;
  label?: string;
}

/**
 * Fetch pending TimelockController proposals by merging:
 *   - Local app-submitted ops (authoritative salt + calldata), passed via
 *     `localSeeds`. These always survive.
 *   - On-chain `CallScheduled` events (external ops from Safe/CLI), scanned
 *     in paginated chunks. Events don't emit salt, so we mark those ops
 *     `saltKnown: false` — UI must gate Execute until the curator
 *     confirms the salt.
 *
 * Returns a result object so the UI can surface partial-scan warnings.
 */
export async function fetchTimelockProposals(
  client: PublicClient,
  timelock: Address,
  chainId: number,
  localSeeds: LocalOpSeed[] = [],
  opts: FetchProposalsOptions = {},
): Promise<FetchProposalsResult> {
  if (!timelock) {
    return { proposals: [], scanTruncated: false, scanFromBlock: 0n, scanToBlock: 0n };
  }

  const cfg = getLogWindowConfig(chainId);
  const scan = opts.maxScanBlocks ?? cfg.defaultScan;

  let latest = 0n;
  try {
    latest = await client.getBlockNumber();
  } catch {
    // No latest = no scan; we still serve seeds.
  }
  const scanToBlock = latest;
  const scanFromBlock = latest > scan ? latest - scan : 0n;

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

  let scheduledLogs: ScheduledLog[] | null = null;
  let executedIds = new Set<string>();
  let cancelledIds = new Set<string>();

  if (latest > 0n) {
    const [sched, exec, cancel] = await Promise.all([
      scanLogsPaginated<ScheduledLog>(
        (from, to) =>
          client.getContractEvents({
            address: timelock,
            abi: timelockControllerAbi,
            eventName: 'CallScheduled',
            fromBlock: from,
            toBlock: to,
          }) as Promise<ScheduledLog[]>,
        scanFromBlock,
        scanToBlock,
        cfg.pageWindow,
      ),
      scanLogsPaginated<{ args?: { id?: string } }>(
        (from, to) =>
          client.getContractEvents({
            address: timelock,
            abi: timelockControllerAbi,
            eventName: 'CallExecuted',
            fromBlock: from,
            toBlock: to,
          }) as Promise<Array<{ args?: { id?: string } }>>,
        scanFromBlock,
        scanToBlock,
        cfg.pageWindow,
      ),
      scanLogsPaginated<{ args?: { id?: string } }>(
        (from, to) =>
          client.getContractEvents({
            address: timelock,
            abi: timelockControllerAbi,
            eventName: 'Cancelled',
            fromBlock: from,
            toBlock: to,
          }) as Promise<Array<{ args?: { id?: string } }>>,
        scanFromBlock,
        scanToBlock,
        cfg.pageWindow,
      ),
    ]);

    scheduledLogs = sched;
    if (exec) {
      executedIds = new Set(
        exec.map((l) => l.args?.id?.toLowerCase()).filter((x): x is string => Boolean(x)),
      );
    }
    if (cancel) {
      cancelledIds = new Set(
        cancel.map((l) => l.args?.id?.toLowerCase()).filter((x): x is string => Boolean(x)),
      );
    }
  }

  const scanTruncated = scheduledLogs === null || latest === 0n;

  interface OpSeed {
    opId: `0x${string}`;
    target: Address;
    value: bigint;
    data: `0x${string}`;
    predecessor: `0x${string}`;
    salt: `0x${string}`;
    saltKnown: boolean;
    isLocal: boolean;
    delay: bigint;
    txHash?: `0x${string}`;
    scheduledAt?: number;
    label?: string;
  }

  const ops = new Map<string, OpSeed>();

  // Step 1: local seeds (authoritative salt).
  for (const seed of localSeeds) {
    ops.set(seed.opId.toLowerCase(), {
      opId: seed.opId,
      target: seed.target,
      value: seed.value,
      data: seed.data,
      predecessor: seed.predecessor,
      salt: seed.salt,
      saltKnown: true,
      isLocal: true,
      delay: seed.delay,
      txHash: seed.txHash,
      scheduledAt: seed.scheduledAt,
      label: seed.label,
    });
  }

  // Step 2: event-derived ops. If the opId is already in the map (local
  // seed), skip — the local salt wins. Otherwise, record as external
  // with salt unknown.
  if (scheduledLogs) {
    for (const log of scheduledLogs) {
      const args = log.args;
      if (!args?.id) continue;
      const key = args.id.toLowerCase();
      if (ops.has(key)) continue; // Local copy wins.
      ops.set(key, {
        opId: args.id as `0x${string}`,
        target: args.target ?? ('0x0000000000000000000000000000000000000000' as Address),
        value: args.value ?? 0n,
        data: args.data ?? ('0x' as `0x${string}`),
        predecessor:
          args.predecessor ??
          ('0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`),
        salt: '0x0000000000000000000000000000000000000000000000000000000000000000',
        saltKnown: false,
        isLocal: false,
        delay: args.delay ?? 0n,
        txHash: log.transactionHash,
      });
    }
  }

  if (ops.size === 0) {
    return { proposals: [], scanTruncated, scanFromBlock, scanToBlock };
  }

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
    const key = op.opId.toLowerCase();
    const isDone = executedIds.has(key);
    const isCancelled = cancelledIds.has(key);
    // Expiry: OZ v4 timelocks expire an op after grace period once ready.
    // We can only derive it for local ops where we know `scheduledAt`.
    const expiresAtSec =
      op.scheduledAt != null
        ? op.scheduledAt + Number(op.delay) + TIMELOCK_GRACE_PERIOD_SECONDS
        : null;
    const isExpired =
      expiresAtSec != null && now > expiresAtSec && readyAt === 0n && !isDone && !isCancelled;
    return {
      opId: op.opId,
      timelock,
      target: op.target,
      value: op.value,
      data: op.data,
      predecessor: op.predecessor,
      salt: op.salt,
      saltKnown: op.saltKnown,
      isLocal: op.isLocal,
      delay: op.delay,
      readyAt,
      isReady: !isCancelled && !isDone && readyAt > 0n && Number(readyAt) <= now,
      isDone: isDone || isCancelled,
      isExpired,
      label: op.label ?? (op.data && op.data !== '0x' ? labelCalldata(op.data) : 'Unknown call'),
      scheduledAt: op.scheduledAt,
      txHash: op.txHash,
    };
  });

  return {
    proposals: proposals
      .filter((p) => !p.isDone)
      .sort((a, b) => Number(a.readyAt - b.readyAt)),
    scanTruncated,
    scanFromBlock,
    scanToBlock,
  };
}
