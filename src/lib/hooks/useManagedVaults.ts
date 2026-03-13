import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import type { VaultVersion } from '../../types';
import { CHAIN_CONFIGS, SEI_KNOWN_VAULTS, getChainConfig } from '../../config/chains';
import { getPublicClient } from '../data/rpcClient';
import { metaMorphoFactoryAbi, metaMorphoV2FactoryAbi } from '../contracts/abis';

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

/** V1 vaults by owner */
const V1_OWNER_QUERY = `
  query V1Owner($address: String!, $chainId: Int!) {
    vaults(where: { ownerAddress_in: [$address], chainId_in: [$chainId] }, first: 50) {
      items { address name symbol chain { id } state { owner curator } }
    }
  }
`;

/** V1 vaults by curator */
const V1_CURATOR_QUERY = `
  query V1Curator($address: String!, $chainId: Int!) {
    vaults(where: { curatorAddress_in: [$address], chainId_in: [$chainId] }, first: 50) {
      items { address name symbol chain { id } state { owner curator } }
    }
  }
`;

/** V2 vaults by owner */
const V2_OWNER_QUERY = `
  query V2Owner($address: String!, $chainId: Int!) {
    vaultV2s(where: { ownerAddress_in: [$address], chainId_in: [$chainId] }, first: 50) {
      items { address name symbol chain { id } owner { address } curator { address } }
    }
  }
`;

/** V2 vaults by curator */
const V2_CURATOR_QUERY = `
  query V2Curator($address: String!, $chainId: Int!) {
    vaultV2s(where: { curatorAddress_in: [$address], chainId_in: [$chainId] }, first: 50) {
      items { address name symbol chain { id } owner { address } curator { address } }
    }
  }
`;

const ownerCuratorNameAbi = [
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'curator', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

/** Block explorer API base URLs for non-API chains */
const EXPLORER_APIS: Record<number, string> = {
  1329: 'https://pacific-1-api.seitrace.com/api',
};

// ============================================================
// On-chain vault discovery (for non-API chains like SEI)
// ============================================================

/**
 * Discover vaults on non-API chains using multiple sources:
 *
 * 1. Try getLogs on factory (fast, works if RPC allows the block range)
 * 2. Fallback: block explorer txlist API → fetch TX receipts → extract vault addresses
 *    (receipts may not be available for old TXs on some RPCs)
 * 3. Also include known vaults from static config (catches old vaults where receipts expired)
 * 4. Deduplicate, then multicall owner() + curator() + name()
 */
async function fetchOnChainManagedVaults(
  walletAddress: Address,
  chainId: number,
): Promise<ManagedVault[]> {
  const config = getChainConfig(chainId);
  if (!config) return [];

  const client = getPublicClient(chainId);
  const lower = walletAddress.toLowerCase();

  try {
    // Collect vault addresses from all available sources, tagged with version
    const vaultEntries: { address: string; version: VaultVersion }[] = [];
    const seen = new Set<string>();

    const addVault = (addr: string, version: VaultVersion) => {
      const key = addr.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        vaultEntries.push({ address: key, version });
      }
    };

    // Source 1: known vaults from static config
    if (chainId === 1329) {
      for (const vault of Object.values(SEI_KNOWN_VAULTS)) {
        addVault(vault.address, 'v1');
      }
    }

    // Source 2: V1 factory event logs
    if (config.vaultFactories.v1) {
      try {
        const logs = await client.getLogs({
          address: config.vaultFactories.v1,
          event: metaMorphoFactoryAbi[3], // CreateMetaMorpho event
          fromBlock: BigInt(config.deploymentBlock),
          toBlock: 'latest',
        });
        for (const l of logs) {
          const addr = (l as { args: { metaMorpho: Address } }).args.metaMorpho;
          if (addr) addVault(addr, 'v1');
        }
      } catch {
        // getLogs failed (block range limit) — try explorer + receipts
        const explorerAddrs = await discoverVaultsViaExplorerReceipts(chainId, config.vaultFactories.v1);
        for (const addr of explorerAddrs) addVault(addr, 'v1');
      }
    }

    // Source 3: V2 factory event logs
    if (config.vaultFactories.v2) {
      try {
        const v2Event = metaMorphoV2FactoryAbi.find(
          (e) => e.type === 'event' && e.name === 'CreateVaultV2',
        );
        if (v2Event) {
          const logs = await client.getLogs({
            address: config.vaultFactories.v2,
            event: v2Event as typeof v2Event & { type: 'event' },
            fromBlock: BigInt(config.deploymentBlock),
            toBlock: 'latest',
          });
          for (const l of logs) {
            const addr = (l as { args: { newVaultV2: Address } }).args.newVaultV2;
            if (addr) addVault(addr, 'v2');
          }
        }
      } catch (err) {
        console.warn(`[useManagedVaults] V2 factory scan failed for chain ${chainId}:`, err);
      }
    }

    if (vaultEntries.length === 0) return [];

    // Multicall owner() + curator() + name() on each vault
    const calls = vaultEntries.flatMap((v) => [
      { address: v.address as Address, abi: ownerCuratorNameAbi, functionName: 'owner' as const },
      { address: v.address as Address, abi: ownerCuratorNameAbi, functionName: 'curator' as const },
      { address: v.address as Address, abi: ownerCuratorNameAbi, functionName: 'name' as const },
    ]);

    const results = await client.multicall({ contracts: calls });

    const detected: ManagedVault[] = [];
    for (let i = 0; i < vaultEntries.length; i++) {
      const ownerResult = results[i * 3];
      const curatorResult = results[i * 3 + 1];
      const nameResult = results[i * 3 + 2];

      const isOwner =
        ownerResult?.status === 'success' &&
        (ownerResult.result as string).toLowerCase() === lower;
      const isCurator =
        curatorResult?.status === 'success' &&
        (curatorResult.result as string).toLowerCase() === lower;

      if (isOwner || isCurator) {
        const vaultName =
          nameResult?.status === 'success'
            ? (nameResult.result as string)
            : `Vault ${vaultEntries[i].address.slice(0, 10)}...`;

        detected.push({
          address: vaultEntries[i].address as Address,
          chainId,
          name: vaultName,
          version: vaultEntries[i].version,
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

/**
 * Discover vault addresses via block explorer txlist API + RPC receipt fetching.
 *
 * 1. Get all transactions to the factory via explorer API (reliable, returns full history)
 * 2. Fetch receipt for each TX via RPC (may fail for old TXs — that's OK, static list covers those)
 * 3. Extract vault address from logs[0].address (the vault emits OwnershipTransferred first)
 */
async function discoverVaultsViaExplorerReceipts(
  chainId: number,
  factoryAddress: Address,
): Promise<Address[]> {
  const apiBase = EXPLORER_APIS[chainId];
  if (!apiBase) return [];

  try {
    const url = `${apiBase}?module=account&action=txlist&address=${factoryAddress}&startblock=0&endblock=999999999&sort=asc&page=1&offset=200`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const json = await res.json();
    const txs = json?.result;
    if (!Array.isArray(txs)) return [];

    // Filter for successful createMetaMorpho calls (selector 0xb5102025)
    const factoryTxHashes = txs
      .filter((tx: { input: string; isError: string; to: string }) =>
        tx.input?.startsWith('0xb5102025') &&
        tx.isError === '0' &&
        tx.to?.toLowerCase() === factoryAddress.toLowerCase(),
      )
      .map((tx: { hash: string }) => tx.hash as `0x${string}`);

    if (factoryTxHashes.length === 0) return [];

    // Fetch receipts in parallel — some may fail for old TXs (null result)
    const client = getPublicClient(chainId);
    const receipts = await Promise.all(
      factoryTxHashes.map((hash) =>
        client.getTransactionReceipt({ hash }).catch(() => null),
      ),
    );

    const vaultAddresses: Address[] = [];
    for (const receipt of receipts) {
      if (!receipt || receipt.logs.length === 0) continue;
      // First log is emitted by the newly created vault (OwnershipTransferred)
      const vaultAddr = receipt.logs[0].address as Address;
      if (vaultAddr && vaultAddr.toLowerCase() !== factoryAddress.toLowerCase()) {
        vaultAddresses.push(vaultAddr);
      }
    }

    return vaultAddresses;
  } catch (err) {
    console.warn(`[useManagedVaults] Explorer+receipt discovery failed for chain ${chainId}:`, err);
    return [];
  }
}

// ============================================================
// API-based discovery (for Ethereum, Base)
// ============================================================

async function gqlFetch(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(MORPHO_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (json.errors) {
    console.warn('[useManagedVaults] GraphQL errors:', json.errors);
    return null;
  }
  return json.data;
}

async function fetchApiManagedVaults(walletAddress: Address): Promise<ManagedVault[]> {
  const results: ManagedVault[] = [];
  const seen = new Set<string>();
  const lower = walletAddress.toLowerCase();

  for (const chainId of API_CHAINS) {
    const vars = { address: lower, chainId };

    // Fire all 4 queries in parallel: V1 owner, V1 curator, V2 owner, V2 curator
    const [v1Owner, v1Curator, v2Owner, v2Curator] = await Promise.all([
      gqlFetch(V1_OWNER_QUERY, vars).catch(() => null),
      gqlFetch(V1_CURATOR_QUERY, vars).catch(() => null),
      gqlFetch(V2_OWNER_QUERY, vars).catch(() => null),
      gqlFetch(V2_CURATOR_QUERY, vars).catch(() => null),
    ]);

    // Process V1 results
    const v1Items = [
      ...((v1Owner as { vaults?: { items?: unknown[] } })?.vaults?.items ?? []),
      ...((v1Curator as { vaults?: { items?: unknown[] } })?.vaults?.items ?? []),
    ] as { address: string; name?: string; chain?: { id: number }; state?: { owner?: string; curator?: string } }[];

    for (const v of v1Items) {
      const key = `${chainId}-${v.address.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isOwner = v.state?.owner?.toLowerCase() === lower;
      const isCurator = v.state?.curator?.toLowerCase() === lower;
      if (isOwner || isCurator) {
        results.push({
          address: v.address as Address,
          chainId: v.chain?.id ?? chainId,
          name: v.name ?? `Vault ${v.address.slice(0, 8)}...`,
          version: 'v1',
          role: isOwner ? 'owner' : 'curator',
        });
      }
    }

    // Process V2 results
    const v2Items = [
      ...((v2Owner as { vaultV2s?: { items?: unknown[] } })?.vaultV2s?.items ?? []),
      ...((v2Curator as { vaultV2s?: { items?: unknown[] } })?.vaultV2s?.items ?? []),
    ] as { address: string; name?: string; chain?: { id: number }; owner?: { address: string }; curator?: { address: string } }[];

    for (const v of v2Items) {
      const key = `${chainId}-${v.address.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isOwner = v.owner?.address?.toLowerCase() === lower;
      const isCurator = v.curator?.address?.toLowerCase() === lower;
      if (isOwner || isCurator) {
        results.push({
          address: v.address as Address,
          chainId: v.chain?.id ?? chainId,
          name: v.name ?? `Vault ${v.address.slice(0, 8)}...`,
          version: 'v2',
          role: isOwner ? 'owner' : 'curator',
        });
      }
    }
  }

  return results;
}

// ============================================================
// Combined hook
// ============================================================

async function fetchManagedVaults(walletAddress: Address): Promise<ManagedVault[]> {
  // Run on-chain scanning for ALL chains (supplements API results with V2 factory vaults)
  const allChainIds = Object.values(CHAIN_CONFIGS).map((c) => c.chainId);
  const onChainPromises = allChainIds.map((chainId) =>
    fetchOnChainManagedVaults(walletAddress, chainId),
  );

  const [apiResults, ...onChainResults] = await Promise.all([
    fetchApiManagedVaults(walletAddress),
    ...onChainPromises,
  ]);

  // Merge: deduplicate by chainId+address, on-chain results supplement API
  const seen = new Set<string>();
  const merged: ManagedVault[] = [];

  for (const v of apiResults) {
    const key = `${v.chainId}-${v.address.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(v);
    }
  }
  for (const v of onChainResults.flat()) {
    const key = `${v.chainId}-${v.address.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(v);
    }
  }

  return merged;
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
