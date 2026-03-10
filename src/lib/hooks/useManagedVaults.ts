import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import type { VaultVersion } from '../../types';

const MORPHO_API_URL = 'https://api.morpho.org/graphql';

/** Chains indexed by the Morpho GraphQL API */
const API_CHAINS = [1, 8453];

interface ManagedVault {
  address: Address;
  chainId: number;
  name: string;
  version: VaultVersion;
  role: 'owner' | 'curator';
}

const MANAGED_VAULTS_QUERY = `
  query ManagedVaults($address: String!, $chainId: Int!) {
    vaults(
      where: {
        or: [
          { stateEquals: { owner: $address } }
          { stateEquals: { curator: $address } }
        ]
        chainId_in: [$chainId]
      }
      first: 50
    ) {
      items {
        address
        name
        symbol
        chain { id }
        state { owner curator }
      }
    }
  }
`;

async function fetchManagedVaults(walletAddress: Address): Promise<ManagedVault[]> {
  const results: ManagedVault[] = [];
  const lower = walletAddress.toLowerCase();

  for (const chainId of API_CHAINS) {
    try {
      const res = await fetch(MORPHO_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: MANAGED_VAULTS_QUERY,
          variables: { address: walletAddress, chainId },
        }),
      });

      if (!res.ok) continue;
      const json = await res.json();
      const items = json.data?.vaults?.items;
      if (!Array.isArray(items)) continue;

      for (const v of items) {
        const isOwner = v.state?.owner?.toLowerCase() === lower;
        const isCurator = v.state?.curator?.toLowerCase() === lower;
        if (isOwner || isCurator) {
          results.push({
            address: v.address as Address,
            chainId: v.chain?.id ?? chainId,
            name: v.name ?? `Vault ${(v.address as string).slice(0, 8)}...`,
            version: 'v1',
            role: isOwner ? 'owner' : 'curator',
          });
        }
      }
    } catch {
      // Skip chain on error
    }
  }

  return results;
}

export function useManagedVaults(walletAddress: Address | undefined) {
  return useQuery({
    queryKey: ['managed-vaults', walletAddress],
    queryFn: () => fetchManagedVaults(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 5 * 60 * 1000, // 5 min
    refetchOnWindowFocus: false,
  });
}
