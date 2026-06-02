/**
 * Shared `eth_getLogs` scanning helpers that work on RPCs which cap the
 * block range per request (notably Pharos at 1000 blocks/request).
 *
 * Strategy: for range-limited chains we binary-search the contract's
 * deployment block (so we don't walk millions of pre-deployment blocks)
 * then page through `[deployment … latest]` in `pageWindow`-sized windows,
 * a handful of pages concurrently. For unrestricted chains we issue a single
 * `0 → latest` request (ETH/Base public RPCs handle that fine).
 *
 * Used by `useV2VaultCapEntries` (cap events) and `useVaultAllocators`
 * (SetIsAllocator events).
 */
import type { AbiEvent, Address, Log, PublicClient } from 'viem';
import { getLogWindowConfig } from '../vault/proposals';

/** Cache of resolved deployment blocks (immutable per contract). */
const deploymentBlockCache = new Map<string, bigint>();

/**
 * Find the first block at which `address` has deployed bytecode, via binary
 * search over [0, latest] (~log2(latest) `eth_getCode` calls). Requires an
 * archive RPC — Pharos's public RPC is archive (verified). Falls back to
 * block 0 if state is unavailable. Result is cached per (chain, address).
 */
export async function findDeploymentBlock(
  client: PublicClient,
  chainId: number,
  address: Address,
  latest: bigint,
): Promise<bigint> {
  const cacheKey = `${chainId}:${address.toLowerCase()}`;
  const cached = deploymentBlockCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let lo = 0n;
  let hi = latest;
  let result = 0n;
  while (lo <= hi) {
    const mid = lo + (hi - lo) / 2n;
    let hasCode = false;
    try {
      const code = await client.getCode({ address, blockNumber: mid });
      hasCode = !!code && code !== '0x';
    } catch {
      // Non-archive node or transient error — assume code present so the
      // search converges downward rather than scanning the whole chain.
      hasCode = true;
    }
    if (hasCode) {
      result = mid;
      hi = mid - 1n;
    } else {
      lo = mid + 1n;
    }
  }
  deploymentBlockCache.set(cacheKey, result);
  return result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Rate-limit / "too fast" responses we should back off and retry on (e.g.
 *  Pharos's zan.top RPC returns 429 / code -32011 "cu limit exceeded"). */
function isRateLimit(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate.?limit|too fast|too many request|cu limit|-32011/i.test(msg);
}

/** Block-range / result-size errors that mean "ask for a smaller range". Every
 *  RPC phrases this differently — Alchemy: "up to a 10000 block range" /
 *  "Log response size exceeded"; zan.top: "block range is too large". We split
 *  and retry on these so a single scanner adapts to any endpoint's caps. */
function isRangeError(err: unknown): boolean {
  if (isRateLimit(err)) return false; // handled by backoff, not splitting
  const msg = err instanceof Error ? err.message : String(err);
  return /block range|range too|too large|up to a \d+ block|response size|query returned more|too many results|exceed/i.test(msg);
}

/**
 * `getLogs` for one window with exponential backoff on rate-limit errors.
 * Total concurrent requests are bounded globally by the per-chain transport
 * throttle in `getPublicClient` (rpcClient.ts), so the backoff here is just a
 * safety net for any 429 that still slips through.
 */
async function getLogsWithRetry(
  client: PublicClient,
  address: Address,
  event: AbiEvent,
  fromBlock: bigint,
  toBlock: bigint,
  retries = 6,
): Promise<Log[]> {
  let delay = 400;
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.getLogs({ address, event, fromBlock, toBlock });
    } catch (err) {
      if (attempt >= retries || !isRateLimit(err)) throw err;
      // jitter so concurrent workers don't retry in lockstep
      await sleep(delay + Math.floor((attempt * 137) % 250));
      delay = Math.min(delay * 2, 5000);
    }
  }
}

/** Minimum span we'll split a range down to before giving up on a range error. */
const MIN_RANGE_SPAN = 100n;

/**
 * Fetch one block range, adaptively halving on range/result-size errors so the
 * scan self-adapts to whatever the live endpoint allows (Alchemy ~10k, the
 * public Pharos RPC 1k, etc.) — no per-chain window tuning required. Rate
 * limits are absorbed by `getLogsWithRetry`'s backoff, not by splitting.
 */
async function scanRange(
  client: PublicClient,
  address: Address,
  event: AbiEvent,
  start: bigint,
  end: bigint,
): Promise<Log[]> {
  try {
    return await getLogsWithRetry(client, address, event, start, end);
  } catch (err) {
    const span = end - start;
    if (span <= MIN_RANGE_SPAN || !isRangeError(err)) throw err;
    const mid = start + span / 2n;
    const [left, right] = await Promise.all([
      scanRange(client, address, event, start, mid),
      scanRange(client, address, event, mid + 1n, end),
    ]);
    return [...left, ...right];
  }
}

async function getLogsPaginated(
  client: PublicClient,
  address: Address,
  event: AbiEvent,
  fromBlock: bigint,
  toBlock: bigint,
  window: bigint,
): Promise<Log[]> {
  const ranges: { from: bigint; to: bigint }[] = [];
  for (let start = fromBlock; start <= toBlock; start += window) {
    const end = start + window - 1n > toBlock ? toBlock : start + window - 1n;
    ranges.push({ from: start, to: end });
  }
  const acc: Log[] = [];
  // Batch size bounds how many page-promises are pending at once. Real
  // concurrency is also bounded by the per-chain transport throttle in
  // getPublicClient (rpcClient.ts) where one is configured.
  const CONCURRENCY = 4;
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = ranges.slice(i, i + CONCURRENCY);
    const pages = await Promise.all(
      batch.map((r) => scanRange(client, address, event, r.from, r.to)),
    );
    for (const page of pages) acc.push(...page);
  }
  return acc;
}

/**
 * Scan a single event across a contract's history. Always paginated from the
 * contract's deployment block (binary-searched) with adaptive range-splitting,
 * so it works through any endpoint's getLogs cap (Alchemy 10k, public 1k) and
 * never walks pre-deployment blocks.
 *
 * Pass `fromBlock` to scan only a delta (incremental re-scan from a cached
 * last-scanned block). `latestOverride` lets the caller reuse a block number
 * it already fetched, so the scanned range and any stored cursor agree.
 */
export async function scanContractEvent(
  client: PublicClient,
  chainId: number,
  address: Address,
  event: AbiEvent,
  fromBlock?: bigint,
  latestOverride?: bigint,
): Promise<Log[]> {
  const latest = latestOverride ?? (await client.getBlockNumber());
  const from = fromBlock ?? (await findDeploymentBlock(client, chainId, address, latest));
  if (from > latest) return [];
  const { pageWindow } = getLogWindowConfig(chainId);
  return getLogsPaginated(client, address, event, from, latest, pageWindow);
}
