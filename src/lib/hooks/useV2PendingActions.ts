/**
 * Pending timelocked actions on a Morpho Vault V2.
 *
 * V1 has `PendingCapsBanner`, driven by the vault's `pendingCap` storage.
 * V2 has no equivalent read — a queued action lives only in
 * `executableAt[keccak(data)]`, keyed by the exact calldata that was
 * `submit`-ed, and there is no way to enumerate that mapping on-chain. So
 * nothing in the app ever showed a running V2 timelock: a curator would
 * submit a cap increase and get no feedback anywhere until they happened to
 * reopen the very same drawer with the very same numbers typed in.
 *
 * Recovering the queue takes two steps:
 *   1. Scan `Submit(bytes4 indexed selector, bytes data, uint256 executableAt)`
 *      to recover every calldata ever queued. (`scanContractEvent` handles
 *      range-capped RPCs — Pharos allows 1000 blocks per request.)
 *   2. Re-read `executableAt(data)` for each. Executing or revoking clears
 *      the slot to 0, so a non-zero value is the authoritative "still
 *      queued" signal — the event log alone would show stale entries.
 *
 * Step 1 must cover the vault's ENTIRE history. A queued action never
 * expires: RockawayX USDC on Pharos has live entries submitted at blocks
 * 8.67M and 10.75M against a head of 14.16M. The previous
 * `latest - defaultScan` bound (200k blocks ≈ 2 days at Pharos's ~0.9s
 * blocks) sat above every one of them, so the tab showed "Empty" while five
 * actions were queued on-chain.
 *
 * A full scan is 576 paginated getLogs pages there (~2 min), far too slow to
 * block a tab that also mounts on Overview and Caps. So the scan is split:
 *   - the foreground query scans the recent window (or, once a cursor is
 *     cached, only the delta since it) and paints immediately;
 *   - a background query backfills deployment → that window once, persisting
 *     the recovered calldatas to localStorage.
 * After the first backfill every later visit is a one-page delta scan.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  decodeAbiParameters,
  decodeFunctionData,
  parseAbiItem,
  type Address,
  type PublicClient,
} from 'viem';
import { getPublicClient, fetchTokenInfo } from '../data/rpcClient';
import { metaMorphoV2Abi } from '../contracts/metaMorphoV2Abi';
import { scanContractEvent, findDeploymentBlock } from '../data/eventScan';
import { getLogWindowConfig } from '../vault/proposals';
import { vaultKeys } from '../queryKeys';

const SUBMIT_EVENT = parseAbiItem(
  'event Submit(bytes4 indexed selector, bytes data, uint256 executableAt)',
);

export interface PendingActionsResult {
  actions: PendingV2Action[];
  /** First block scanned — the queue is only complete from here onward. */
  fromBlock: bigint;
  toBlock: bigint;
  /** True when the scan reached the vault's deployment block (full history). */
  isFullHistory: boolean;
}

export interface PendingV2Action {
  /** Exact submitted calldata — the timelock key, and what Execute re-sends. */
  data: `0x${string}`;
  selector: `0x${string}`;
  /** Unix seconds. Always > 0 here (zero entries are filtered out). */
  executableAt: bigint;
  /** Decoded function name, e.g. `increaseAbsoluteCap`. */
  functionName: string;
  /** Human action label, e.g. "Increase absolute cap". */
  label: string;
  /** What the action targets, e.g. "collateral wsrUSD" — null if undecodable. */
  target: string | null;
  /** Formatted new value, e.g. "10,000,000 USDC" or "100%". */
  value: string | null;
  blockNumber: bigint | null;
}

const LABELS: Record<string, string> = {
  increaseAbsoluteCap: 'Increase absolute cap',
  increaseRelativeCap: 'Increase relative cap',
  decreaseAbsoluteCap: 'Decrease absolute cap',
  decreaseRelativeCap: 'Decrease relative cap',
  addAdapter: 'Add adapter',
  removeAdapter: 'Remove adapter',
  setAdapterRegistry: 'Set adapter registry',
  setIsAllocator: 'Set allocator',
  setIsSentinel: 'Set sentinel',
  setCurator: 'Set curator',
  setName: 'Set name',
  setSymbol: 'Set symbol',
  setPerformanceFee: 'Set performance fee',
  setPerformanceFeeRecipient: 'Set performance fee recipient',
  setManagementFee: 'Set management fee',
  setManagementFeeRecipient: 'Set management fee recipient',
  setMaxRate: 'Set max rate',
  setForceDeallocatePenalty: 'Set force-deallocate penalty',
  setLiquidityAdapterAndData: 'Set liquidity adapter',
  decreaseTimelock: 'Decrease timelock',
  abdicate: 'Abdicate selector',
};

/** Leading `string` tag of a cap-map idData payload ("this" / "collateralToken" / "this/marketParams"). */
function idDataTag(idData: `0x${string}`): string | null {
  try {
    const hex = idData.slice(2);
    const offset = Number(BigInt('0x' + hex.slice(0, 64)));
    const lenStart = offset * 2;
    const length = Number(BigInt('0x' + hex.slice(lenStart, lenStart + 64)));
    const strHex = hex.slice(lenStart + 64, lenStart + 64 + length * 2);
    let out = '';
    for (let i = 0; i < strHex.length; i += 2) out += String.fromCharCode(parseInt(strHex.slice(i, i + 2), 16));
    return out;
  } catch {
    return null;
  }
}

/** Resolve a cap idData payload to a human target string. */
async function describeCapTarget(
  chainId: number,
  idData: `0x${string}`,
): Promise<string | null> {
  const tag = idDataTag(idData);
  try {
    if (tag === 'this') {
      const [, adapter] = decodeAbiParameters([{ type: 'string' }, { type: 'address' }], idData);
      return `adapter ${(adapter as string).slice(0, 10)}…`;
    }
    if (tag === 'collateralToken') {
      const [, token] = decodeAbiParameters([{ type: 'string' }, { type: 'address' }], idData);
      const info = await fetchTokenInfo(chainId, token as Address).catch(() => null);
      return `collateral ${info?.symbol ?? (token as string).slice(0, 10) + '…'}`;
    }
    if (tag === 'this/marketParams') {
      const [, , params] = decodeAbiParameters(
        [
          { type: 'string' },
          { type: 'address' },
          {
            type: 'tuple',
            components: [
              { type: 'address', name: 'loanToken' },
              { type: 'address', name: 'collateralToken' },
              { type: 'address', name: 'oracle' },
              { type: 'address', name: 'irm' },
              { type: 'uint256', name: 'lltv' },
            ],
          },
        ],
        idData,
      );
      const p = params as { collateralToken: Address; loanToken: Address; lltv: bigint };
      const [collat, loan] = await Promise.all([
        fetchTokenInfo(chainId, p.collateralToken).catch(() => null),
        fetchTokenInfo(chainId, p.loanToken).catch(() => null),
      ]);
      const lltv = (Number(p.lltv) / 1e18) * 100;
      return `market ${collat?.symbol ?? '???'}/${loan?.symbol ?? '???'} @ ${lltv.toFixed(1)}%`;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function formatUnitsCompact(v: bigint, decimals: number): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let out = whole.toLocaleString('en-US');
  if (frac > 0n) {
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 4);
    if (fracStr) out += `.${fracStr}`;
  }
  return (neg ? '-' : '') + out;
}

// ---------------------------------------------------------------------------
// Persisted submit cursor
//
// The expensive half of this hook is recovering *which* calldatas were ever
// submitted; whether each is still queued is one (multicalled) read. So the
// calldatas and the block range they were recovered from are cached in
// localStorage, and later loads only scan the delta.
// ---------------------------------------------------------------------------

const CACHE_VERSION = 1;

interface CachedSubmit {
  data: `0x${string}`;
  selector: `0x${string}`;
  /** Decimal string — JSON can't hold a bigint. */
  block: string | null;
}

interface SubmitCache {
  v: number;
  /** Vault deployment block; caching it skips ~24 archive `eth_getCode` calls. */
  deployment: string;
  /** Oldest block covered by `submits`. */
  fromBlock: string;
  /** Newest block covered by `submits`. */
  toBlock: string;
  submits: CachedSubmit[];
}

function submitCacheKey(chainId: number, vault: string): string {
  return `morpho.v2submits.${chainId}.${vault.toLowerCase()}`;
}

function readSubmitCache(chainId: number, vault: string): SubmitCache | null {
  try {
    const raw = localStorage.getItem(submitCacheKey(chainId, vault));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SubmitCache;
    // A version bump invalidates rather than migrates — the cache is a
    // recoverable derivative of chain state, never a source of truth.
    return parsed?.v === CACHE_VERSION && Array.isArray(parsed.submits) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read-modify-write against whatever is in storage *now*, so the foreground
 * delta scan and the background backfill can land in either order without
 * either one narrowing the other's coverage: entries union, `fromBlock`
 * takes the min, `toBlock` the max.
 *
 * `drop` removes calldatas the caller has just verified are no longer queued
 * (`executableAt == 0` — executed or revoked). That is safe: a later
 * re-submit of the same bytes emits a fresh `Submit` inside the delta.
 */
function updateSubmitCache(
  chainId: number,
  vault: string,
  update: {
    deployment: bigint;
    fromBlock: bigint;
    toBlock: bigint;
    add: CachedSubmit[];
    drop?: Set<string>;
  },
): void {
  try {
    const current = readSubmitCache(chainId, vault);
    const merged = new Map<`0x${string}`, CachedSubmit>();
    for (const s of current?.submits ?? []) merged.set(s.data, s);
    for (const s of update.add) merged.set(s.data, s);
    for (const d of update.drop ?? []) merged.delete(d as `0x${string}`);

    const prevFrom = current ? BigInt(current.fromBlock) : update.fromBlock;
    const prevTo = current ? BigInt(current.toBlock) : update.toBlock;
    const next: SubmitCache = {
      v: CACHE_VERSION,
      deployment: update.deployment.toString(),
      fromBlock: (prevFrom < update.fromBlock ? prevFrom : update.fromBlock).toString(),
      toBlock: (prevTo > update.toBlock ? prevTo : update.toBlock).toString(),
      submits: [...merged.values()],
    };
    localStorage.setItem(submitCacheKey(chainId, vault), JSON.stringify(next));
  } catch {
    // Quota / disabled storage — non-fatal, we just re-scan next time.
  }
}

function toCachedSubmits(logs: readonly unknown[]): CachedSubmit[] {
  const out: CachedSubmit[] = [];
  for (const log of logs) {
    const args = (log as { args?: { selector?: `0x${string}`; data?: `0x${string}` } }).args;
    if (!args?.data || !args.selector) continue;
    const blockNumber = (log as { blockNumber?: bigint }).blockNumber;
    out.push({
      data: args.data,
      selector: args.selector,
      block: blockNumber !== undefined ? blockNumber.toString() : null,
    });
  }
  return out;
}

async function resolveDeployment(
  client: PublicClient,
  chainId: number,
  vaultAddress: Address,
  latest: bigint,
  cache: SubmitCache | null,
): Promise<bigint> {
  if (cache?.deployment) return BigInt(cache.deployment);
  return findDeploymentBlock(client, chainId, vaultAddress, latest);
}

/**
 * How far back one backfill step reaches. On Pharos (10k getLogs pages) this
 * is ~50 pages ≈ 25s — small enough that a failure costs one step rather than
 * the whole walk, and that each completed step visibly moves the covered
 * range in the UI.
 *
 * Doing the whole gap in a single call was the first attempt and it does not
 * survive contact with a real RPC: 557 pages over ~4.5 minutes, all-or-
 * nothing. One rate-limit burst the retry budget can't absorb rejects the
 * entire scan, and `retry: 1` then parks the query in an error state with
 * nothing fetched and nothing shown.
 */
const BACKFILL_STEP_BLOCKS = 500_000n;

/**
 * Widen the covered range one step toward the vault's deployment block.
 *
 * Resumable by construction: the covered range lives in the persisted cursor,
 * so a step that fails (or a reload mid-walk) resumes from the last committed
 * floor instead of starting over. The caller re-invokes until `done`.
 */
export async function backfillSubmitHistory(
  chainId: number,
  vaultAddress: Address,
): Promise<{ extended: boolean; done: boolean }> {
  const client = getPublicClient(chainId) as PublicClient;
  const cache = readSubmitCache(chainId, vaultAddress);
  // The foreground query always writes the cursor before this runs (it is
  // gated on that query's success), so a missing cursor means storage is
  // unavailable — there is nothing to widen and nothing to resume from.
  if (!cache) return { extended: false, done: true };

  const latest = await client.getBlockNumber();
  const deployment = await resolveDeployment(client, chainId, vaultAddress, latest, cache);
  const coveredFrom = BigInt(cache.fromBlock);
  if (coveredFrom <= deployment) return { extended: false, done: true };

  const stepFloor = coveredFrom > BACKFILL_STEP_BLOCKS ? coveredFrom - BACKFILL_STEP_BLOCKS : 0n;
  const from = stepFloor > deployment ? stepFloor : deployment;
  const to = coveredFrom - 1n;

  const logs = await scanContractEvent(client, chainId, vaultAddress, SUBMIT_EVENT, from, to);

  updateSubmitCache(chainId, vaultAddress, {
    deployment,
    fromBlock: from,
    toBlock: BigInt(cache.toBlock),
    add: toCachedSubmits(logs),
  });
  return { extended: true, done: from <= deployment };
}

export async function fetchPendingActions(
  chainId: number,
  vaultAddress: Address,
  assetDecimals: number,
  assetSymbol: string,
): Promise<PendingActionsResult> {
  const client = getPublicClient(chainId) as PublicClient;

  const latest = await client.getBlockNumber();
  const cache = readSubmitCache(chainId, vaultAddress);
  const deployment = await resolveDeployment(client, chainId, vaultAddress, latest, cache);

  // With a cursor, scan only what arrived since it. Without one, take the
  // chain's standard recent depth so the first paint is fast — the backfill
  // query walks back to `deployment` right behind us.
  const { defaultScan } = getLogWindowConfig(chainId);
  let fromBlock: bigint;
  let scanFrom: bigint;
  if (cache) {
    fromBlock = BigInt(cache.fromBlock);
    scanFrom = BigInt(cache.toBlock) + 1n;
  } else {
    const floor = latest > defaultScan ? latest - defaultScan : 0n;
    fromBlock = floor > deployment ? floor : deployment;
    scanFrom = fromBlock;
  }

  const logs =
    scanFrom <= latest
      ? await scanContractEvent(client, chainId, vaultAddress, SUBMIT_EVENT, scanFrom, latest)
      : [];

  // Dedupe by calldata — re-submitting the same action overwrites the slot.
  const byData = new Map<`0x${string}`, { selector: `0x${string}`; blockNumber: bigint | null }>();
  for (const s of cache?.submits ?? []) {
    byData.set(s.data, { selector: s.selector, blockNumber: s.block === null ? null : BigInt(s.block) });
  }
  for (const s of toCachedSubmits(logs)) {
    byData.set(s.data, { selector: s.selector, blockNumber: s.block === null ? null : BigInt(s.block) });
  }
  const window = { fromBlock, toBlock: latest, isFullHistory: fromBlock <= deployment };
  if (byData.size === 0) {
    updateSubmitCache(chainId, vaultAddress, { deployment, fromBlock, toBlock: latest, add: [] });
    return { actions: [], ...window };
  }

  // `executableAt` is the source of truth: executing or revoking zeroes it.
  // These fan out through the client's multicall batching — one round-trip.
  const entries = [...byData.entries()];
  const liveExecutableAt = await Promise.all(
    entries.map(([data]) =>
      client
        .readContract({
          address: vaultAddress,
          abi: metaMorphoV2Abi,
          functionName: 'executableAt',
          args: [data],
        })
        .catch(() => 0n) as Promise<bigint>,
    ),
  );

  // Settled entries stay out of the cache so it tracks the live queue rather
  // than growing with every action the vault has ever executed.
  const settled = new Set<string>();
  entries.forEach(([data], i) => {
    if (liveExecutableAt[i] === 0n) settled.add(data);
  });
  updateSubmitCache(chainId, vaultAddress, {
    deployment,
    fromBlock,
    toBlock: latest,
    add: toCachedSubmits(logs),
    drop: settled,
  });

  const pending: PendingV2Action[] = [];
  await Promise.all(
    entries.map(async ([data, meta], i) => {
      const executableAt = liveExecutableAt[i];
      if (executableAt === 0n) return; // executed or revoked

      let functionName = 'unknown';
      let target: string | null = null;
      let value: string | null = null;
      try {
        const decoded = decodeFunctionData({ abi: metaMorphoV2Abi, data });
        functionName = decoded.functionName;
        const args = (decoded.args ?? []) as readonly unknown[];

        if (/^(increase|decrease)(Absolute|Relative)Cap$/.test(functionName)) {
          target = await describeCapTarget(chainId, args[0] as `0x${string}`);
          const raw = args[1] as bigint;
          value = functionName.includes('Absolute')
            ? `${formatUnitsCompact(raw, assetDecimals)} ${assetSymbol}`
            : `${(Number(raw) / 1e16).toFixed(2)}%`;
        } else if (typeof args[0] === 'string' && args[0].startsWith('0x') && args[0].length === 42) {
          target = `${args[0].slice(0, 10)}…`;
        }
      } catch {
        /* unknown selector — still surface it as a raw pending entry */
      }

      pending.push({
        data,
        selector: meta.selector,
        executableAt,
        functionName,
        label: LABELS[functionName] ?? functionName,
        target,
        value,
        blockNumber: meta.blockNumber,
      });
    }),
  );

  return {
    actions: pending.sort((a, b) => (a.executableAt < b.executableAt ? -1 : 1)),
    ...window,
  };
}

export function useV2PendingActions(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  assetDecimals: number,
  assetSymbol: string,
  enabled = true,
) {
  const queryClient = useQueryClient();
  const baseKey = [
    ...vaultKeys.adapters(chainId ?? 0, vaultAddress ?? '0x'),
    'pending-timelock-actions',
  ] as const;
  const ready = enabled && !!chainId && !!vaultAddress;

  const query = useQuery<PendingActionsResult>({
    queryKey: baseKey,
    queryFn: () => fetchPendingActions(chainId!, vaultAddress!, assetDecimals, assetSymbol),
    enabled: ready,
    staleTime: 30_000,
    // Advance pending → executable without a manual refresh.
    refetchInterval: 60_000,
  });

  // Walk back toward the deployment block behind the fast paint, one step per
  // query. Keying on the current covered floor is what drives the walk: each
  // completed step widens the cursor, the foreground refetch reports the new
  // floor, that remounts this query under a fresh key, and the next step runs.
  // The loop ends when the foreground reports `isFullHistory` and
  // `needsBackfill` goes false — no counter, no recursion, and a reload mid-walk
  // simply resumes from the committed floor.
  const needsBackfill = query.isSuccess && query.data?.isFullHistory === false;
  const floor = query.data?.fromBlock?.toString() ?? '';
  const backfill = useQuery({
    queryKey: [...baseKey, 'backfill', floor],
    queryFn: () => backfillSubmitHistory(chainId!, vaultAddress!),
    enabled: ready && needsBackfill,
    staleTime: Infinity,
    // Deliberately NOT Infinity: these are per-floor keys, so retaining them
    // would leak a query per step into the persisted cache, each one pinned
    // un-refetchable by `staleTime: Infinity`. Dropping them on unmount also
    // means a step that failed is retried on the next mount rather than
    // leaving the walk permanently parked.
    gcTime: 0,
    retry: 1,
  });

  const extended = backfill.data?.extended === true;
  useEffect(() => {
    // Pull the newly recovered history into the rendered queue immediately
    // rather than waiting out the 60s refetch interval. `exact` matters:
    // `baseKey` is a prefix of the backfill's own key, so a prefix
    // invalidation would bounce the backfill straight back into flight.
    if (extended) queryClient.invalidateQueries({ queryKey: baseKey, exact: true });
    // `baseKey` is rebuilt each render; its identity is captured by the deps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extended, queryClient, chainId, vaultAddress]);

  return {
    ...query,
    /** True while a history-widening step is in flight. */
    isBackfilling: backfill.isFetching,
    /**
     * Set when the walk stalled short of the deployment block. Without this a
     * failed scan is indistinguishable from a genuinely empty queue — which is
     * the worse of the two to get wrong.
     */
    backfillError:
      needsBackfill && backfill.isError
        ? backfill.error instanceof Error
          ? backfill.error.message
          : 'History scan failed.'
        : null,
  };
}
