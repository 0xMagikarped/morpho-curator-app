import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import type { VaultVersion } from '../../types';
import { SEI_KNOWN_VAULTS } from '../../config/chains';
import { getPublicClient } from '../data/rpcClient';
import { metaMorphoV1Abi } from '../contracts/abis';

const MORPHO_API_URL = 'https://api.morpho.org/graphql';

/** Chains indexed by the Morpho GraphQL API */
const API_CHAINS = [1, 8453];

export interface ManagedVault {
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

/** Check SEI known vaults via RPC for owner/curator match */
async function fetchSeiManagedVaults(walletAddress: Address): Promise<ManagedVault[]> {
  const results: ManagedVault[] = [];
  const lower = walletAddress.toLowerCase();

  try {
    const client = getPublicClient(1329);

    for (const [, vault] of Object.entries(SEI_KNOWN_VAULTS)) {
      try {
        const [owner, curator] = await Promise.all([
          client.readContract({
            address: vault.address,
            abi: metaMorphoV1Abi,
            functionName: 'owner',
          }) as Promise<Address>,
          client.readContract({
            address: vault.address,
            abi: metaMorphoV1Abi,
            functionName: 'curator',
          }) as Promise<Address>,
        ]);

        const isOwner = (owner as string).toLowerCase() === lower;
        const isCurator = (curator as string).toLowerCase() === lower;

        if (isOwner || isCurator) {
          results.push({
            address: vault.address,
            chainId: 1329,
            name: vault.name,
            version: 'v1',
            role: isOwner ? 'owner' : 'curator',
          });
        }
      } catch {
        // Skip individual vault on error
      }
    }
  } catch {
    // SEI RPC unavailable
  }

  return results;
}

/** Check API-indexed chains (Ethereum, Base) via GraphQL */
async function fetchApiManagedVaults(walletAddress: Address): Promise<ManagedVault[]> {
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

async function fetchManagedVaults(walletAddress: Address): Promise<ManagedVault[]> {
  const [apiResults, seiResults] = await Promise.all([
    fetchApiManagedVaults(walletAddress),
    fetchSeiManagedVaults(walletAddress),
  ]);
  return [...apiResults, ...seiResults];
}

export function useManagedVaults(walletAddress: Address | undefined) {
  return useQuery({
    queryKey: ['managed-vaults', walletAddress],
    queryFn: () => fetchManagedVaults(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
