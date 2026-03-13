import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';

const QUERY_KEY = ['tracked-vaults'];
const CACHE_KEY = 'rockaway-tracked-vaults';

export interface TrackedVault {
  address: string;
  chainId: number;
  name: string;
  symbol?: string;
  asset?: string;
  role?: 'owner' | 'curator' | 'both';
  version: 'v1' | 'v2';
  addedAt?: number;
}

export function useTrackedVaults() {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  const {
    data: trackedVaults = [],
    isLoading,
    error,
  } = useQuery<TrackedVault[]>({
    queryKey: [...QUERY_KEY, address],
    queryFn: async () => {
      if (!address) return [];

      try {
        const res = await fetch(`/api/tracked-vaults?wallet=${address}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const vaults = await res.json();
        localStorage.setItem(CACHE_KEY, JSON.stringify(vaults));
        return vaults as TrackedVault[];
      } catch (err) {
        console.warn('Edge Config read failed, using localStorage:', err);
        const cached = localStorage.getItem(CACHE_KEY);
        return cached ? JSON.parse(cached) : [];
      }
    },
    enabled: !!address,
    staleTime: 30_000,
    placeholderData: (): TrackedVault[] => {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        return cached ? (JSON.parse(cached) as TrackedVault[]) : [];
      } catch {
        return [];
      }
    },
  });

  const trackMutation = useMutation({
    mutationFn: async (vault: Omit<TrackedVault, 'addedAt'>) => {
      const res = await fetch('/api/track-vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, vault }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      return res.json();
    },
    onMutate: async (vault) => {
      await queryClient.cancelQueries({ queryKey: [...QUERY_KEY, address] });
      const previous = queryClient.getQueryData<TrackedVault[]>([...QUERY_KEY, address]);
      const optimistic = [...(previous || []), { ...vault, addedAt: Date.now() }];
      queryClient.setQueryData([...QUERY_KEY, address], optimistic);
      localStorage.setItem(CACHE_KEY, JSON.stringify(optimistic));
      return { previous };
    },
    onError: (err, _vault, context) => {
      console.error('[useTrackedVaults] track failed:', err);
      if (context?.previous) {
        queryClient.setQueryData([...QUERY_KEY, address], context.previous);
        localStorage.setItem(CACHE_KEY, JSON.stringify(context.previous));
      }
    },
    onSuccess: (data) => {
      const vaults = data?.vaults;
      if (Array.isArray(vaults)) {
        queryClient.setQueryData([...QUERY_KEY, address], vaults);
        localStorage.setItem(CACHE_KEY, JSON.stringify(vaults));
      }
    },
  });

  const untrackMutation = useMutation({
    mutationFn: async ({ vaultAddress, chainId }: { vaultAddress: string; chainId: number }) => {
      const res = await fetch('/api/untrack-vault', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: address, vaultAddress, chainId }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      return res.json();
    },
    onMutate: async ({ vaultAddress, chainId }) => {
      await queryClient.cancelQueries({ queryKey: [...QUERY_KEY, address] });
      const previous = queryClient.getQueryData<TrackedVault[]>([...QUERY_KEY, address]);
      const optimistic = (previous || []).filter(
        (v) =>
          !(v.address.toLowerCase() === vaultAddress.toLowerCase() && v.chainId === chainId),
      );
      queryClient.setQueryData([...QUERY_KEY, address], optimistic);
      localStorage.setItem(CACHE_KEY, JSON.stringify(optimistic));
      return { previous };
    },
    onError: (err, _vars, context) => {
      console.error('[useTrackedVaults] untrack failed:', err);
      if (context?.previous) {
        queryClient.setQueryData([...QUERY_KEY, address], context.previous);
        localStorage.setItem(CACHE_KEY, JSON.stringify(context.previous));
      }
    },
    onSuccess: (data) => {
      const vaults = data?.vaults;
      if (Array.isArray(vaults)) {
        queryClient.setQueryData([...QUERY_KEY, address], vaults);
        localStorage.setItem(CACHE_KEY, JSON.stringify(vaults));
      }
    },
  });

  return {
    trackedVaults,
    isLoading,
    error,
    trackVault: (vault: Omit<TrackedVault, 'addedAt'>) => trackMutation.mutate(vault),
    untrackVault: (vaultAddress: string, chainId: number) =>
      untrackMutation.mutate({ vaultAddress, chainId }),
    isTracked: (vaultAddress: string, chainId: number) =>
      trackedVaults.some(
        (v) => v.address.toLowerCase() === vaultAddress.toLowerCase() && v.chainId === chainId,
      ),
    isTracking: trackMutation.isPending,
    isUntracking: untrackMutation.isPending,
  };
}
