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
import { getLogWindowConfig, isLogRangeLimited } from '../vault/proposals';

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
  // Batch size just bounds how many page-promises are pending at once — the
  // REAL concurrency cap is the per-chain transport throttle in
  // getPublicClient (rpcClient.ts), which gates total in-flight requests
  // across all scans + reads so Pharos's per-second CU limit isn't tripped.
  const CONCURRENCY = 4;
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = ranges.slice(i, i + CONCURRENCY);
    const pages = await Promise.all(
      batch.map((r) => getLogsWithRetry(client, address, event, r.from, r.to)),
    );
    for (const page of pages) acc.push(...page);
  }
  return acc;
}

/**
 * Scan a single event on a contract. Range-limited chains (e.g. Pharos) are
 * paged from `fromBlock` (default: the contract's deployment block) to
 * `latest`; everything else uses one `fromBlock → latest` request.
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
  if (!isLogRangeLimited(chainId)) {
    return client.getLogs({ address, event, fromBlock: fromBlock ?? 0n, toBlock: 'latest' });
  }
  const { pageWindow } = getLogWindowConfig(chainId);
  const latest = latestOverride ?? (await client.getBlockNumber());
  const from = fromBlock ?? (await findDeploymentBlock(client, chainId, address, latest));
  if (from > latest) return [];
  return getLogsPaginated(client, address, event, from, latest, pageWindow);
}
