import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { useAppStore } from '../../store/appStore';
import type { Address } from 'viem';
import type { VaultVersion } from '../../types';

export interface TrackedVault {
  address: Address;
  chainId: number;
  name: string;
  version: VaultVersion;
}

const QUERY_KEY = 'kv-tracked-vaults';

/**
 * Fetch tracked vaults from KV backend, falling back to localStorage (Zustand).
 */
async function fetchTrackedVaults(wallet: Address): Promise<TrackedVault[]> {
  try {
    const res = await fetch(`/api/tracked-vaults?wallet=${wallet}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return (json.vaults ?? []) as TrackedVault[];
  } catch (err) {
    console.warn('[useTrackedVaults] KV fetch failed, using localStorage:', err);
    return [];
  }
}

async function trackVaultOnKV(
  wallet: Address,
  vault: TrackedVault,
): Promise<TrackedVault[]> {
  const res = await fetch('/api/track-vault', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet, vault }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.vaults as TrackedVault[];
}

async function untrackVaultOnKV(
  wallet: Address,
  address: Address,
  chainId: number,
): Promise<TrackedVault[]> {
  const res = await fetch('/api/untrack-vault', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet, address, chainId }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.vaults as TrackedVault[];
}

/**
 * Unified tracked vaults hook.
 *
 * - Reads from Vercel KV (server) with localStorage (Zustand) as fallback/cache
 * - Writes go to both KV and localStorage for instant optimistic updates
 * - Auto-syncs KV → localStorage on successful fetch
 */
export function useTrackedVaults() {
  const { address: wallet } = useAccount();
  const queryClient = useQueryClient();
  const zustandStore = useAppStore();

  // Fetch from KV, merge with localStorage
  const { data: kvVaults, isLoading } = useQuery({
    queryKey: [QUERY_KEY, wallet],
    queryFn: () => fetchTrackedVaults(wallet!),
    enabled: !!wallet,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Merge: KV vaults + localStorage vaults, deduplicated
  const mergedVaults = mergeVaultLists(
    kvVaults ?? [],
    zustandStore.trackedVaults as TrackedVault[],
  );

  // Sync KV → localStorage when KV returns data
  // (ensures localStorage stays up to date as a cache)
  if (kvVaults && kvVaults.length > 0) {
    for (const v of kvVaults) {
      const exists = zustandStore.trackedVaults.some(
        (z) => z.address.toLowerCase() === v.address.toLowerCase() && z.chainId === v.chainId,
      );
      if (!exists) {
        zustandStore.addTrackedVault(v);
      }
    }
  }

  // Track vault mutation
  const trackMutation = useMutation({
    mutationFn: (vault: TrackedVault) => {
      if (!wallet) return Promise.resolve([]);
      return trackVaultOnKV(wallet, vault);
    },
    onMutate: (vault) => {
      // Optimistic: add to Zustand immediately
      zustandStore.addTrackedVault(vault);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, wallet] });
    },
    onError: (_err, vault) => {
      // KV failed but localStorage still has it — acceptable degradation
      console.warn('[useTrackedVaults] KV track failed, localStorage preserved for', vault.address);
    },
  });

  // Untrack vault mutation
  const untrackMutation = useMutation({
    mutationFn: ({ address, chainId }: { address: Address; chainId: number }) => {
      if (!wallet) return Promise.resolve([]);
      return untrackVaultOnKV(wallet, address, chainId);
    },
    onMutate: ({ address, chainId }) => {
      // Optimistic: remove from Zustand immediately
      zustandStore.removeTrackedVault(address, chainId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, wallet] });
    },
    onError: (_err, { address }) => {
      console.warn('[useTrackedVaults] KV untrack failed for', address);
    },
  });

  return {
    /** Merged list of tracked vaults (KV + localStorage) */
    trackedVaults: mergedVaults,
    /** Loading state for initial KV fetch */
    isLoading: isLoading && zustandStore.trackedVaults.length === 0,
    /** Track a new vault (writes to KV + localStorage) */
    trackVault: (vault: TrackedVault) => trackMutation.mutate(vault),
    /** Untrack a vault (removes from KV + localStorage) */
    untrackVault: (address: Address, chainId: number) =>
      untrackMutation.mutate({ address, chainId }),
    /** Whether any KV sync is in-flight */
    isSyncing: trackMutation.isPending || untrackMutation.isPending,
  };
}

/** Deduplicate by (address, chainId) — KV takes priority */
function mergeVaultLists(kvList: TrackedVault[], localList: TrackedVault[]): TrackedVault[] {
  const seen = new Set<string>();
  const result: TrackedVault[] = [];

  for (const v of kvList) {
    const key = `${v.address.toLowerCase()}-${v.chainId}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(v);
    }
  }

  for (const v of localList) {
    const key = `${v.address.toLowerCase()}-${v.chainId}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(v);
    }
  }

  return result;
}
