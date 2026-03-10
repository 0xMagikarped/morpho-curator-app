import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import type { VaultVersion } from '../../types';
import { CHAIN_CONFIGS, SEI_KNOWN_VAULTS, getChainConfig } from '../../config/chains';
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
  if (!config?.vaultFactories.v1) return [];

  const client = getPublicClient(chainId);
  const lower = walletAddress.toLowerCase();

  try {
    // Collect vault addresses from all available sources
    const addressSet = new Set<string>();

    // Source 1: known vaults from static config
    if (chainId === 1329) {
      for (const vault of Object.values(SEI_KNOWN_VAULTS)) {
        addressSet.add(vault.address.toLowerCase());
      }
    }

    // Source 2: factory event logs or explorer API + receipts
    try {
      const logs = await client.getLogs({
        address: config.vaultFactories.v1,
        event: metaMorphoFactoryAbi[3], // CreateMetaMorpho event
        fromBlock: BigInt(config.deploymentBlock),
        toBlock: 'latest',
      });
      for (const l of logs) {
        const addr = (l as { args: { metaMorpho: Address } }).args.metaMorpho;
        if (addr) addressSet.add(addr.toLowerCase());
      }
    } catch {
      // getLogs failed (block range limit) — try explorer + receipts
      const explorerAddrs = await discoverVaultsViaExplorerReceipts(chainId, config.vaultFactories.v1);
      for (const addr of explorerAddrs) {
        addressSet.add(addr.toLowerCase());
      }
    }

    const vaultAddresses = [...addressSet].map((a) => a as Address);
    if (vaultAddresses.length === 0) return [];

    // Multicall owner() + curator() + name() on each vault
    const calls = vaultAddresses.flatMap((addr) => [
      { address: addr, abi: ownerCuratorNameAbi, functionName: 'owner' as const },
      { address: addr, abi: ownerCuratorNameAbi, functionName: 'curator' as const },
      { address: addr, abi: ownerCuratorNameAbi, functionName: 'name' as const },
    ]);

    const results = await client.multicall({ contracts: calls });

    const detected: ManagedVault[] = [];
    for (let i = 0; i < vaultAddresses.length; i++) {
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
            : `Vault ${vaultAddresses[i].slice(0, 10)}...`;

        detected.push({
          address: vaultAddresses[i],
          chainId,
          name: vaultName,
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

// ============================================================
// Combined hook
// ============================================================

async function fetchManagedVaults(walletAddress: Address): Promise<ManagedVault[]> {
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
