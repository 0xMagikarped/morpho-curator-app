/**
 * PR 23 — discover every cap entry on a V2 vault by scanning past cap
 * events, regardless of allocation state.
 *
 * The V2 vault emits `IncreaseAbsoluteCap`, `IncreaseRelativeCap`,
 * `DecreaseAbsoluteCap`, `DecreaseRelativeCap` for every successful cap
 * change. Each event includes `idData` (the raw bytes argument passed to
 * `increase*Cap` / `decrease*Cap`) as a non-indexed event field, so a
 * single `getLogs` pass + bytes decode is enough to enumerate every cap
 * entry the vault has ever had — bucketed by level via the string tag at
 * the start of idData ("this" → adapter, "collateralToken" → collateral,
 * "this/marketParams" → market).
 *
 * For each discovered entry we then read the *current* `absoluteCap`,
 * `relativeCap`, and `allocation` (one batched multicall'd-via-Promise.all
 * read). Entries whose caps have been zeroed out still show up here —
 * that's intentional. The UI can hide them if desired.
 *
 * Used by `V2CapsTab` to render the three Morpho-curator-style tables
 * (Adapter / Collateral Token / Market) even before any allocation has
 * landed, and by the Allocation tab / AdapterCard / SetLiquidityDrawer to
 * surface markets that are configured but hold no position yet.
 *
 * The scan must cover the vault's ENTIRE history — a cap set once and never
 * touched again lives at whatever block it was set. But a full history scan
 * is not something a tab can block on: on Pharos, deployment → head for
 * RockawayX USDC is 1.43M blocks = 143 paginated `getLogs` pages per event,
 * and measured against the live RPC the two events together take ~57s. Four
 * surfaces mount this hook, so that cost was being paid several times over.
 *
 * So the scan is split the same way `useV2PendingActions` splits the
 * `Submit` scan:
 *   - the foreground query scans the recent window (or, once a cursor is
 *     persisted, only the delta since it) and paints immediately;
 *   - a background query walks back toward the deployment block one bounded
 *     step at a time, committing the widened range to the cursor after each.
 * After the first full walk every later visit is a one-page delta scan.
 *
 * `isFullHistory` reports honestly whether the returned set is complete, so
 * a caller can say "still scanning" instead of implying "this is all there
 * is" — a missing cap entry reads as a market you are not allowed to
 * allocate to, which is the worse of the two to get wrong.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Address, PublicClient } from 'viem';
import { decodeAbiParameters, parseAbiItem } from 'viem';
import { getPublicClient, fetchTokenInfo } from '../lib/data/rpcClient';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';
import { computeMarketId } from '../lib/market/marketId';
import { scanContractEvent, findDeploymentBlock } from '../lib/data/eventScan';
import { getLogWindowConfig } from '../lib/vault/proposals';
import { vaultKeys } from '../lib/queryKeys';
import type { TokenInfo, MarketParams } from '../types';

export interface AdapterCapEntry {
  level: 'adapter';
  /** Cap-map storage key (keccak256 of idData). */
  id: `0x${string}`;
  idData: `0x${string}`;
  adapter: Address;
  absoluteCap: bigint;
  relativeCap: bigint;
  allocation: bigint;
}

export interface CollateralCapEntry {
  level: 'collateral';
  id: `0x${string}`;
  idData: `0x${string}`;
  collateralToken: TokenInfo;
  absoluteCap: bigint;
  relativeCap: bigint;
  allocation: bigint;
}

export interface MarketCapEntry {
  level: 'market';
  /** Cap-map storage key (keccak256 of idData). Used by V2 vault to look up caps. */
  id: `0x${string}`;
  /** The Morpho Blue market ID (keccak256(abi.encode(MarketParams))). Used to read market state. */
  marketId: `0x${string}`;
  idData: `0x${string}`;
  adapter: Address;
  params: MarketParams;
  /** The market's loan-token / collateral-token info, if resolvable. */
  collateralToken: TokenInfo | null;
  absoluteCap: bigint;
  relativeCap: bigint;
  allocation: bigint;
}

export interface VaultCapEntries {
  adapterCaps: AdapterCapEntry[];
  collateralCaps: CollateralCapEntry[];
  marketCaps: MarketCapEntry[];
  /** First block covered by the scan — entries below it are not accounted for. */
  fromBlock: bigint;
  toBlock: bigint;
  /** True once the scan has reached the vault's deployment block. */
  isFullHistory: boolean;
}

const CAP_READ_ABI = [
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'absoluteCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'relativeCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'allocation', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

/** Decode the leading `string tag` from a cap-map idData payload. */
function decodeIdDataTag(idData: `0x${string}`): string | null {
  try {
    // idData starts with the same encoding as `abi.decode(idData, (string, …))`
    // — we just decode the leading string. The remaining slot(s) are
    // level-specific and decoded separately below.
    const [tag] = decodeAbiParameters([{ type: 'string' }, { type: 'address' }], idData);
    return tag;
  } catch {
    // Some idData payloads are longer (market level adds a tuple); the
    // leading string still decodes via the partial decode above. If even
    // that fails, classify as unknown.
    try {
      // Manual decode: skip the offset word (0x20), read the string length,
      // then the string bytes (padded to 32).
      const hex = idData.slice(2);
      const offset = Number(BigInt('0x' + hex.slice(0, 64)));
      const lenStart = offset * 2;
      const length = Number(BigInt('0x' + hex.slice(lenStart, lenStart + 64)));
      const strHex = hex.slice(lenStart + 64, lenStart + 64 + length * 2);
      return Buffer.from(strHex, 'hex').toString('utf8');
    } catch {
      return null;
    }
  }
}

function decodeAdapterIdData(idData: `0x${string}`): Address {
  const [, adapter] = decodeAbiParameters(
    [{ type: 'string' }, { type: 'address' }],
    idData,
  );
  return adapter as Address;
}

function decodeCollateralIdData(idData: `0x${string}`): Address {
  const [, token] = decodeAbiParameters(
    [{ type: 'string' }, { type: 'address' }],
    idData,
  );
  return token as Address;
}

function decodeMarketIdData(idData: `0x${string}`): { adapter: Address; params: MarketParams } {
  const [, adapter, params] = decodeAbiParameters(
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
  return {
    adapter: adapter as Address,
    params: params as MarketParams,
  };
}

const INCREASE_ABS_EVENT = parseAbiItem(
  'event IncreaseAbsoluteCap(bytes32 indexed id, bytes idData, uint256 newAbsoluteCap)',
);
const INCREASE_REL_EVENT = parseAbiItem(
  'event IncreaseRelativeCap(bytes32 indexed id, bytes idData, uint256 newRelativeCap)',
);

// ============================================================
// Persisted scan cursor
// ============================================================

const CACHE_VERSION = 1;

interface CachedCapEntry {
  id: `0x${string}`;
  idData: `0x${string}`;
}

interface CapEventCache {
  v: number;
  /** Vault deployment block; caching it skips ~24 archive `eth_getCode` calls. */
  deployment: string;
  /** Oldest block covered by `entries`. */
  fromBlock: string;
  /** Newest block covered by `entries`. */
  toBlock: string;
  entries: CachedCapEntry[];
}

function capCacheKey(chainId: number, vault: string): string {
  return `morpho.v2capentries.${chainId}.${vault.toLowerCase()}`;
}

function readCapCache(chainId: number, vault: string): CapEventCache | null {
  try {
    const raw = localStorage.getItem(capCacheKey(chainId, vault));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CapEventCache;
    // A version bump invalidates rather than migrates — the cache is a
    // recoverable derivative of chain state, never a source of truth.
    return parsed?.v === CACHE_VERSION && Array.isArray(parsed.entries) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read-modify-write against whatever is in storage *now*, so the foreground
 * delta scan and the background backfill can land in either order without
 * either narrowing the other's coverage: entries union, `fromBlock` takes the
 * min, `toBlock` the max.
 *
 * There is no `drop` counterpart here (unlike the `Submit` cursor): a cap-map
 * slot's `(id, idData)` pair is permanent once created. Zeroing a cap mutates
 * the slot's value, which we re-read live on every fetch — it never removes
 * the entry.
 */
function updateCapCache(
  chainId: number,
  vault: string,
  update: { deployment: bigint; fromBlock: bigint; toBlock: bigint; add: CachedCapEntry[] },
): void {
  try {
    const current = readCapCache(chainId, vault);
    const merged = new Map<`0x${string}`, `0x${string}`>();
    for (const e of current?.entries ?? []) merged.set(e.id, e.idData);
    for (const e of update.add) if (!merged.has(e.id)) merged.set(e.id, e.idData);

    const prevFrom = current ? BigInt(current.fromBlock) : update.fromBlock;
    const prevTo = current ? BigInt(current.toBlock) : update.toBlock;
    const next: CapEventCache = {
      v: CACHE_VERSION,
      deployment: update.deployment.toString(),
      fromBlock: (prevFrom < update.fromBlock ? prevFrom : update.fromBlock).toString(),
      toBlock: (prevTo > update.toBlock ? prevTo : update.toBlock).toString(),
      entries: [...merged.entries()].map(([id, idData]) => ({ id, idData })),
    };
    localStorage.setItem(capCacheKey(chainId, vault), JSON.stringify(next));
  } catch {
    // Quota / disabled storage — non-fatal, we just re-scan next time.
  }
}

/**
 * `id` is the indexed topic = keccak256(idData), so multiple events for the
 * same cap entry coalesce to one pair.
 */
function toCachedEntries(logs: readonly unknown[]): CachedCapEntry[] {
  const out: CachedCapEntry[] = [];
  for (const log of logs) {
    const args = (log as { args?: { id?: `0x${string}`; idData?: `0x${string}` } }).args;
    if (args?.id && args.idData) out.push({ id: args.id, idData: args.idData });
  }
  return out;
}

async function resolveDeployment(
  client: PublicClient,
  chainId: number,
  vaultAddress: Address,
  latest: bigint,
  cache: CapEventCache | null,
): Promise<bigint> {
  if (cache?.deployment) return BigInt(cache.deployment);
  return findDeploymentBlock(client, chainId, vaultAddress, latest);
}

/** Scan both cap-creating events over one block range. */
async function scanCapEvents(
  client: PublicClient,
  chainId: number,
  vaultAddress: Address,
  from: bigint,
  to: bigint,
): Promise<CachedCapEntry[]> {
  // Increase events only — they create a cap-map slot; decreases just mutate
  // an existing slot, so they always have a matching `Increase…` earlier in
  // the history (a slot can't be decreased before being set).
  const [absLogs, relLogs] = await Promise.all([
    scanContractEvent(client, chainId, vaultAddress, INCREASE_ABS_EVENT, from, to),
    scanContractEvent(client, chainId, vaultAddress, INCREASE_REL_EVENT, from, to),
  ]);
  return [...toCachedEntries(absLogs), ...toCachedEntries(relLogs)];
}

/**
 * How far back one backfill step reaches. Matches the `Submit` walk: ~50
 * pages per event on Pharos, small enough that a failed step costs one step
 * rather than the whole walk, and that each completed step visibly widens the
 * covered range in the UI.
 */
const BACKFILL_STEP_BLOCKS = 500_000n;

/**
 * Widen the covered range one step toward the vault's deployment block.
 *
 * Resumable by construction: the covered range lives in the persisted cursor,
 * so a step that fails (or a reload mid-walk) resumes from the last committed
 * floor instead of starting over. The caller re-invokes until `done`.
 */
export async function backfillCapEventHistory(
  chainId: number,
  vaultAddress: Address,
): Promise<{ extended: boolean; done: boolean }> {
  const client = getPublicClient(chainId) as PublicClient;
  const cache = readCapCache(chainId, vaultAddress);
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

  const add = await scanCapEvents(client, chainId, vaultAddress, from, to);

  updateCapCache(chainId, vaultAddress, {
    deployment,
    fromBlock: from,
    toBlock: BigInt(cache.toBlock),
    add,
  });
  return { extended: true, done: from <= deployment };
}

export async function fetchVaultCapEntries(
  chainId: number,
  vaultAddress: Address,
): Promise<VaultCapEntries> {
  const client = getPublicClient(chainId) as PublicClient;

  const latest = await client.getBlockNumber();
  const cache = readCapCache(chainId, vaultAddress);
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

  const fresh =
    scanFrom <= latest ? await scanCapEvents(client, chainId, vaultAddress, scanFrom, latest) : [];

  const seen = new Map<`0x${string}`, `0x${string}`>(); // id → idData
  for (const e of cache?.entries ?? []) seen.set(e.id, e.idData);
  for (const e of fresh) if (!seen.has(e.id)) seen.set(e.id, e.idData);

  updateCapCache(chainId, vaultAddress, { deployment, fromBlock, toBlock: latest, add: fresh });

  const window = { fromBlock, toBlock: latest, isFullHistory: fromBlock <= deployment };

  // Classify each entry by its idData tag.
  const adapterIds: { id: `0x${string}`; idData: `0x${string}`; adapter: Address }[] = [];
  const collateralIds: { id: `0x${string}`; idData: `0x${string}`; collateral: Address }[] = [];
  const marketIds: { id: `0x${string}`; idData: `0x${string}`; adapter: Address; params: MarketParams }[] = [];

  for (const [id, idData] of seen.entries()) {
    const tag = decodeIdDataTag(idData);
    try {
      if (tag === 'this') {
        adapterIds.push({ id, idData, adapter: decodeAdapterIdData(idData) });
      } else if (tag === 'collateralToken') {
        collateralIds.push({ id, idData, collateral: decodeCollateralIdData(idData) });
      } else if (tag === 'this/marketParams') {
        const decoded = decodeMarketIdData(idData);
        marketIds.push({ id, idData, ...decoded });
      }
      // unknown tags → skip (forward-compat with future cap levels)
    } catch {
      // malformed idData → skip
    }
  }

  // Read current values for each entry. Group reads to limit RPC fan-out.
  const readEntry = async (id: `0x${string}`) => {
    const [absoluteCap, relativeCap, allocation] = await Promise.all([
      client.readContract({ address: vaultAddress, abi: CAP_READ_ABI, functionName: 'absoluteCap', args: [id] }).catch(() => 0n) as Promise<bigint>,
      client.readContract({ address: vaultAddress, abi: CAP_READ_ABI, functionName: 'relativeCap', args: [id] }).catch(() => 0n) as Promise<bigint>,
      client.readContract({ address: vaultAddress, abi: CAP_READ_ABI, functionName: 'allocation', args: [id] }).catch(() => 0n) as Promise<bigint>,
    ]);
    return { absoluteCap, relativeCap, allocation };
  };

  // Build the three buckets concurrently, enriching tokens where we can.
  const [adapterCaps, collateralCaps, marketCaps] = await Promise.all([
    Promise.all(
      adapterIds.map(async (a): Promise<AdapterCapEntry> => ({
        level: 'adapter',
        id: a.id,
        idData: a.idData,
        adapter: a.adapter,
        ...(await readEntry(a.id)),
      })),
    ),
    Promise.all(
      collateralIds.map(async (c): Promise<CollateralCapEntry> => {
        const [reads, token] = await Promise.all([
          readEntry(c.id),
          fetchTokenInfo(chainId, c.collateral).catch(() => ({
            address: c.collateral, name: 'Unknown', symbol: '???', decimals: 18,
          })),
        ]);
        return {
          level: 'collateral',
          id: c.id,
          idData: c.idData,
          collateralToken: token,
          ...reads,
        };
      }),
    ),
    Promise.all(
      marketIds.map(async (m): Promise<MarketCapEntry> => {
        const [reads, collateralToken] = await Promise.all([
          readEntry(m.id),
          fetchTokenInfo(chainId, m.params.collateralToken).catch(() => null),
        ]);
        return {
          level: 'market',
          id: m.id,
          marketId: computeMarketId(m.params),
          idData: m.idData,
          adapter: m.adapter,
          params: m.params,
          collateralToken,
          ...reads,
        };
      }),
    ),
  ]);

  return { adapterCaps, collateralCaps, marketCaps, ...window };
}

export function useV2VaultCapEntries(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
) {
  const queryClient = useQueryClient();
  const baseKey = [
    ...vaultKeys.adapters(chainId ?? 0, vaultAddress ?? '0x'),
    'all-cap-entries',
  ] as const;
  const ready = !!chainId && !!vaultAddress;

  const query = useQuery<VaultCapEntries>({
    queryKey: baseKey,
    queryFn: () => fetchVaultCapEntries(chainId!, vaultAddress!),
    enabled: ready,
    staleTime: 30_000,
  });

  // Walk back toward the deployment block behind the fast paint, one step per
  // query. Keying on the current covered floor is what drives the walk: each
  // completed step widens the cursor, the foreground refetch reports the new
  // floor, that remounts this query under a fresh key, and the next step runs.
  // It ends when the foreground reports `isFullHistory` — no counter, no
  // recursion, and a reload mid-walk resumes from the committed floor.
  const needsBackfill = query.isSuccess && query.data?.isFullHistory === false;
  const floor = query.data?.fromBlock?.toString() ?? '';
  const backfill = useQuery({
    queryKey: [...baseKey, 'backfill', floor],
    queryFn: () => backfillCapEventHistory(chainId!, vaultAddress!),
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
    // Pull the newly recovered entries into the rendered tables immediately.
    // `exact` matters: `baseKey` is a prefix of the backfill's own key, so a
    // prefix invalidation would bounce the backfill straight back into flight.
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
     * cap entry that simply hasn't been reached yet is indistinguishable from
     * one that doesn't exist.
     */
    backfillError:
      needsBackfill && backfill.isError
        ? backfill.error instanceof Error
          ? backfill.error.message
          : 'Cap history scan failed.'
        : null,
  };
}

// Re-exports for tests + future direct callers.
export { decodeIdDataTag, metaMorphoV2Abi };
