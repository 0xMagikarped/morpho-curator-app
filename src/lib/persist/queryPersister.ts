/**
 * PR 30 — IndexedDB-persisted TanStack Query cache.
 *
 * Cold reloads (refresh, tab close+reopen) re-fetched everything from
 * scratch even when the data was still inside the staleTime window. With
 * `staleTime: 5 min` (App.tsx default) and a typical 20+ readContract
 * calls per vault page, a refresh waited 1–4s on public RPCs before the
 * UI had any data. Persisting the QueryClient cache to IndexedDB closes
 * the gap — reloads paint instantly from disk, then revalidate.
 *
 * Two non-trivial concerns wired up here:
 *
 *   1. **BigInt serialization.** TanStack Query persists via JSON.
 *      `JSON.stringify(0n)` throws. Every cache entry we write touches
 *      bigints somewhere (caps, allocations, balances, timelock
 *      durations). Custom replacer/reviver tag bigints with a
 *      `__BI__<decimal>` sentinel that round-trips through JSON.parse.
 *
 *   2. **Cache invalidation across deploys.** When a hook's queryKey or
 *      result shape changes, stale persisted data can poison the UI.
 *      The `BUSTER` constant is the cache version — bump it whenever a
 *      breaking query shape change ships. PR 23's event-discovery
 *      shape change, PR 24's MarketCapEntry.marketId addition, etc.
 *      would each have warranted a bump in production.
 *
 *      The persister discards the entire stored cache when `buster`
 *      differs from what's on disk. This is the lightweight equivalent
 *      of running migrations; the cost is a single cold load after a
 *      buster bump.
 */
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';

/**
 * Bump when a persisted query's shape changes in a breaking way.
 * History:
 *   v1 — initial persistence (PR 30)
 *   v2 — Map / Set support (PR 34). v1 silently nuked Map values to `{}`
 *        which caused `TypeError: v?.get is not a function` on rehydrate.
 *        Forcing a cache clear so prod users get unblocked.
 */
export const QUERY_CACHE_BUSTER = 'v2';

/** Per-query max age in the persisted cache. */
export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

const BI_TAG = '__BI__';
const MAP_TAG = '__MAP__';
const SET_TAG = '__SET__';

/**
 * Replacer runs BEFORE JSON converts the value, so `value instanceof Map`
 * still works at this point. Without these branches, `JSON.stringify(new
 * Map())` produces `"{}"` and silent data loss on rehydrate — `useMarketCaps`
 * / `useRiskMonitoring` / `useOracleHealth` all return Map<…> values and
 * v1 of the persister bricked the app with `TypeError: v?.get is not a
 * function` (PR 34 bug report).
 */
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return `${BI_TAG}${value.toString()}`;
  if (value instanceof Map) {
    // Entries form: `[[k1, v1], [k2, v2], …]`. Nested values get the
    // replacer applied recursively by JSON.stringify.
    return { [MAP_TAG]: Array.from(value.entries()) };
  }
  if (value instanceof Set) {
    return { [SET_TAG]: Array.from(value.values()) };
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(BI_TAG)) {
    try {
      return BigInt(value.slice(BI_TAG.length));
    } catch {
      return value;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj[MAP_TAG])) {
      return new Map(obj[MAP_TAG] as Iterable<readonly [unknown, unknown]>);
    }
    if (Array.isArray(obj[SET_TAG])) {
      return new Set(obj[SET_TAG] as Iterable<unknown>);
    }
  }
  return value;
}

/**
 * Pure helpers exported for testability. Round-tripping `serialize →
 * deserialize` on a value with nested bigints yields a structurally-equal
 * value with the bigints preserved.
 */
export function serialize(value: unknown): string {
  return JSON.stringify(value, replacer);
}
export function deserialize<T = unknown>(text: string): T {
  return JSON.parse(text, reviver) as T;
}

/**
 * The persister handed to `PersistQueryClientProvider`. Storage lives in
 * IndexedDB via `idb-keyval` — async, no quota wars with localStorage, and
 * survives ServiceWorker / Workbox cycles. The key is namespaced so
 * multiple browser-tab apps (or future variants) don't collide.
 */
export const queryPersister = createAsyncStoragePersister({
  storage: {
    getItem: (k) => get<string>(k).then((v) => v ?? null),
    setItem: (k, v) => set(k, v),
    removeItem: (k) => del(k),
  },
  key: 'morpho-curator:query-cache',
  // Throttle writes — every successful query would otherwise rewrite the
  // whole dehydrated cache on every state change. 1s is the published
  // recommendation from the TanStack docs.
  throttleTime: 1_000,
  serialize,
  deserialize,
});
