import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import type { VaultVersion } from '../../types';
import { CHAIN_CONFIGS, getChainConfig } from '../../config/chains';
import { getPublicClient } from '../data/rpcClient';
import { metaMorphoFactoryAbi } from '../contracts/abis';

const MORPHO_API_URL = 'https://api.morpho.org/graphql';

/** Chains indexed by the Morpho GraphQL API */
const API_CHAINS = [1, 8453];

/** Chains that need on-chain factory scanning (API doesn't index them) */
const ON_CHAIN_ONLY_CHAINS = Object.values(CHAIN_CONFIGS)
  .filter((c) => !c.apiSupported && c.vaultFactories.v1)
  .map((c) => c.chainId);

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

const ownerCuratorAbi = [
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'curator', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

/**
 * Discover vaults on-chain by scanning factory CreateMetaMorpho events,
 * then multicall owner() + curator() to find vaults managed by walletAddress.
 */
async function fetchOnChainManagedVaults(
  walletAddress: Address,
  chainId: number,
): Promise<ManagedVault[]> {
  const config = getChainConfig(chainId);
  if (!config?.vaultFactories.v1) return [];

  const client = getPublicClient(chainId);
  const lower = walletAddress.toLowerCase();

  try {
    // Step 1: Get ALL vault creation events from factory
    const logs = await client.getLogs({
      address: config.vaultFactories.v1,
      event: metaMorphoFactoryAbi[3], // CreateMetaMorpho event
      fromBlock: BigInt(config.deploymentBlock),
      toBlock: 'latest',
    });

    if (logs.length === 0) return [];

    // Step 2: Multicall owner() + curator() on each discovered vault
    const vaultAddresses = logs.map((l) => (l as { args: { metaMorpho: Address } }).args.metaMorpho);

    const calls = vaultAddresses.flatMap((addr) => [
      { address: addr, abi: ownerCuratorAbi, functionName: 'owner' as const },
      { address: addr, abi: ownerCuratorAbi, functionName: 'curator' as const },
    ]);

    const results = await client.multicall({ contracts: calls });

    // Step 3: Match against connected wallet
    const detected: ManagedVault[] = [];

    for (let i = 0; i < vaultAddresses.length; i++) {
      const ownerResult = results[i * 2];
      const curatorResult = results[i * 2 + 1];
      const log = logs[i] as { args: { metaMorpho: Address; name?: string; symbol?: string } };

      const isOwner =
        ownerResult?.status === 'success' &&
        (ownerResult.result as string).toLowerCase() === lower;
      const isCurator =
        curatorResult?.status === 'success' &&
        (curatorResult.result as string).toLowerCase() === lower;

      if (isOwner || isCurator) {
        detected.push({
          address: vaultAddresses[i],
          chainId,
          name: log.args.name || `Vault ${vaultAddresses[i].slice(0, 10)}...`,
          version: 'v1',
          role: isOwner ? 'owner' : 'curator',
        });
      }
    }

    return detected;
  } catch (err) {
    console.warn(`[useManagedVaults] On-chain scan failed for chain ${chainId}:`, err);
    return [];
  }
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
  // Run API chains and on-chain-only chains in parallel
  const onChainPromises = ON_CHAIN_ONLY_CHAINS.map((chainId) =>
    fetchOnChainManagedVaults(walletAddress, chainId),
  );

  const [apiResults, ...onChainResults] = await Promise.all([
    fetchApiManagedVaults(walletAddress),
    ...onChainPromises,
  ]);

  return [...apiResults, ...onChainResults.flat()];
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
