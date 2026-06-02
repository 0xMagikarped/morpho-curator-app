import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import * as Sentry from '@sentry/react';
import {
  fetchVaultBasicInfo,
  fetchVaultQueues,
  fetchV2Adapters,
  fetchMarketCap,
  fetchPendingCap,
  fetchMarketState,
  fetchMarketParams,
  fetchTokenInfo,
  fetchVaultMarketPosition,
  fetchPendingTimelock,
  fetchPendingGuardian,
  checkIsAllocator,
} from '../data/rpcClient';
import type { V2AdapterData } from '../data/rpcClient';
import { isApiSupportedChain, fetchVaultFromApi, type ApiVaultData } from '../data/morphoApi';
import { isChainDeployed } from '../../config/chains';
import type { VaultRole, AllocationState, MarketInfo, PendingAction, MarketCap, PendingCap } from '../../types';
import type { VaultInfoV1 } from '../../types';
import { calcUtilization } from '../utils/format';
import { vaultKeys } from '../queryKeys';

// ============================================================
// Shared: fetch full vault data (API with RPC fallback)
// ============================================================

/**
 * Single query that fetches all vault data. For Ethereum/Base, uses the
 * Morpho GraphQL API (1 request). Falls back to RPC on API failure or
 * for unsupported chains (SEI).
 */
export type DataSource = 'api' | 'rpc';

interface VaultFullDataResult extends ApiVaultData {
  dataSource: DataSource;
}

function useVaultFullData(chainId: number | undefined, vaultAddress: Address | undefined) {
  return useQuery({
    queryKey: vaultKeys.fullData(chainId!, vaultAddress!),
    queryFn: async (): Promise<VaultFullDataResult> => {
      if (!chainId || !vaultAddress) throw new Error('Missing params');
      if (!isChainDeployed(chainId)) throw new Error(`Chain ${chainId} contracts not yet deployed`);

      // Try API first for supported chains
      if (isApiSupportedChain(chainId)) {
        try {
          const data = await fetchVaultFromApi(chainId, vaultAddress);
          return { ...data, dataSource: 'api' as const };
        } catch (apiError) {
          console.warn('[useVaultFullData] API failed, falling back to RPC:', apiError);
          Sentry.addBreadcrumb({
            category: 'data',
            message: `API failed for vault ${vaultAddress}, falling back to RPC`,
            level: 'warning',
          });
          // Fall through to RPC
        }
      }

      // RPC fallback
      const data = await fetchVaultDataViaRpc(chainId, vaultAddress);
      return { ...data, dataSource: 'rpc' as const };
    },
    enabled: !!chainId && !!vaultAddress && isChainDeployed(chainId),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Fetch full vault data from RPC (used for SEI and as API fallback). */
async function fetchVaultDataViaRpc(
  chainId: number,
  vaultAddress: Address,
): Promise<ApiVaultData> {
  const vaultInfo = await fetchVaultBasicInfo(chainId, vaultAddress);
  const assetInfo = await fetchTokenInfo(chainId, vaultInfo.asset);

  const queues = await fetchVaultQueues(chainId, vaultAddress, vaultInfo.version);
  const allMarketIds = [
    ...new Set([...queues.supplyQueue, ...queues.withdrawQueue]),
  ];

  // Fetch per-market data in parallel
  const [allocations, markets] = await Promise.all([
    Promise.all(
      allMarketIds.map(async (marketId) => {
        const [cap, state, position] = await Promise.all([
          fetchMarketCap(chainId, vaultAddress, marketId),
          fetchMarketState(chainId, marketId),
          fetchVaultMarketPosition(chainId, vaultAddress, marketId),
        ]);
        const supplyAssets =
          state.totalSupplyShares > 0n
            ? (position.supplyShares * state.totalSupplyAssets) / state.totalSupplyShares
            : 0n;
        return {
          marketId,
          supplyAssets,
          supplyCap: cap.cap,
          availableLiquidity: state.totalSupplyAssets - state.totalBorrowAssets,
        } as AllocationState;
      }),
    ),
    Promise.all(
      allMarketIds.map(async (id) => {
        const [params, state] = await Promise.all([
          fetchMarketParams(chainId, id),
          fetchMarketState(chainId, id),
        ]);
        const [loanToken, collateralToken] = await Promise.all([
          fetchTokenInfo(chainId, params.loanToken),
          fetchTokenInfo(chainId, params.collateralToken),
        ]);
        return {
          id,
          params,
          state,
          loanToken,
          collateralToken,
          supplyAPY: 0,
          borrowAPY: 0,
          utilization: calcUtilization(state.totalBorrowAssets, state.totalSupplyAssets),
          rewards: [],
        } as MarketInfo;
      }),
    ),
  ]);

  const info = { ...vaultInfo, assetInfo };

  return {
    info,
    allocation: {
      ...queues,
      allocations,
      totalAllocated: allocations.reduce((sum, a) => sum + a.supplyAssets, 0n),
    },
    markets,
  };
}

// ============================================================
// useVaultInfo
// ============================================================

export function useVaultInfo(chainId: number | undefined, vaultAddress: Address | undefined) {
  const query = useVaultFullData(chainId, vaultAddress);
  return {
    ...query,
    data: query.data?.info,
    dataSource: query.data?.dataSource,
  };
}

// ============================================================
// useVaultAllocation
// ============================================================

export function useVaultAllocation(chainId: number | undefined, vaultAddress: Address | undefined) {
  const query = useVaultFullData(chainId, vaultAddress);
  return {
    ...query,
    data: query.data?.allocation,
  };
}

/**
 * Returns markets from the shared full-data query (works for all chains).
 */
export function useVaultMarketsFromApi(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
) {
  const query = useVaultFullData(chainId, vaultAddress);
  return {
    ...query,
    data: query.data?.markets,
  };
}

// ============================================================
// useV2Adapters
// ============================================================

export function useV2Adapters(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
) {
  return useQuery<V2AdapterData[]>({
    queryKey: vaultKeys.adapters(chainId!, vaultAddress!),
    queryFn: () => fetchV2Adapters(chainId!, vaultAddress!),
    enabled: !!chainId && !!vaultAddress,
    staleTime: 30_000,
  });
}

// ============================================================
// useVaultRole
// ============================================================

export function useVaultRole(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
): VaultRole & { isLoading: boolean } {
  const { address: userAddress } = useAccount();
  const fullData = useVaultFullData(chainId, vaultAddress);

  const { data, isLoading } = useQuery({
    queryKey: vaultKeys.role(chainId!, vaultAddress!, userAddress),
    queryFn: async () => {
      if (!chainId || !vaultAddress || !userAddress || !fullData.data) {
        return { isOwner: false, isCurator: false, isAllocator: false, isEmergencyRole: false };
      }

      const info = fullData.data.info;
      // isAllocator requires an on-chain call (not available in API)
      let isAllocator = false;
      try {
        isAllocator = await checkIsAllocator(chainId, vaultAddress, userAddress);
      } catch {
        // RPC call failed — skip allocator check
      }

      const lowerUser = userAddress.toLowerCase();
      const emergencyAddr = info.version === 'v1'
        ? (info as VaultInfoV1).guardian
        : info.version === 'v2'
          ? info.sentinel
          : ('0x0000000000000000000000000000000000000000' as Address);
      return {
        isOwner: info.owner.toLowerCase() === lowerUser,
        isCurator: info.curator.toLowerCase() === lowerUser,
        isAllocator,
        isEmergencyRole: emergencyAddr.toLowerCase() === lowerUser,
      };
    },
    enabled: !!chainId && !!vaultAddress && !!userAddress && !!fullData.data,
    staleTime: 10 * 60 * 1000, // Roles rarely change
  });

  return {
    isOwner: data?.isOwner ?? false,
    isCurator: data?.isCurator ?? false,
    isAllocator: data?.isAllocator ?? false,
    isEmergencyRole: data?.isEmergencyRole ?? false,
    isLoading,
  };
}

// ============================================================
// useVaultAllocators — discover allocator addresses
// ============================================================

const SET_IS_ALLOCATOR_SELECTOR = '0xb192a84a';
const SET_IS_ALLOCATOR_EVENT = '0x74dc60cbc81a9472d04ad1d20e151d369c41104d655ed3f2f3091166a502cd8d';

/** Blockscout-style explorer API base for chains that have one, else null. */
function explorerBaseFor(chainId: number): string | null {
  switch (chainId) {
    case 1329: return 'https://seitrace.com/pacific-1/api/v2';
    case 1: return 'https://eth.blockscout.com/api/v2';
    case 8453: return 'https://base.blockscout.com/api/v2';
    default: return null;
  }
}

/**
 * localStorage cache for discovered allocators on RPC-scanned chains. The
 * SetIsAllocator full-history scan is expensive on range-limited RPCs
 * (Pharos: ~700 paginated requests, ~100s in-browser). We persist the
 * verified set + the last-scanned block so subsequent loads return instantly
 * (via `placeholderData`) and only scan the *delta* since `lastBlock`.
 */
interface AllocatorCache {
  allocators: string[];
  lastBlock: string;
}
function allocCacheKey(chainId: number, vault: string): string {
  return `morpho.allocators.${chainId}.${vault.toLowerCase()}`;
}
function readAllocCache(chainId?: number, vault?: string): AllocatorCache | null {
  if (!chainId || !vault) return null;
  try {
    const raw = localStorage.getItem(allocCacheKey(chainId, vault));
    return raw ? (JSON.parse(raw) as AllocatorCache) : null;
  } catch {
    return null;
  }
}
function writeAllocCache(chainId: number, vault: string, value: AllocatorCache): void {
  try {
    localStorage.setItem(allocCacheKey(chainId, vault), JSON.stringify(value));
  } catch {
    // quota / disabled storage — non-fatal, just lose the cache.
  }
}

/**
 * Discover all current allocator addresses for a vault.
 *
 * Strategy (multi-source, verify on-chain):
 * 1. Scan explorer event logs for SetIsAllocator events (works for Safe/multicall)
 * 2. Scan explorer tx history for direct setIsAllocator calls (fallback)
 * 3. Add known addresses: Public Allocator, connected wallet
 * 4. Verify ALL candidates on-chain via isAllocator()
 */
export function useVaultAllocators(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
) {
  const { address: userAddress } = useAccount();

  return useQuery({
    queryKey: [...vaultKeys.fullData(chainId!, vaultAddress!), 'allocators', userAddress],
    queryFn: async (): Promise<Address[]> => {
      if (!chainId || !vaultAddress) return [];

      const candidates = new Set<string>();

      const { getChainConfig } = await import('../../config/chains');
      const chainConfig = getChainConfig(chainId);

      // Seed from the localStorage cache so previously-found allocators are
      // re-verified (and re-displayed) instantly even before the delta scan.
      const cache = readAllocCache(chainId, vaultAddress);
      for (const a of cache?.allocators ?? []) candidates.add(a.toLowerCase());
      // Track how far the RPC scan covered, to persist as the next cursor.
      let scannedTo: bigint | null = null;

      // Source 1: Explorer event logs (SetIsAllocator events)
      // This catches allocators set via Safe multisig, multicall, or direct calls
      try {
        const explorerBase = explorerBaseFor(chainId);

        if (explorerBase) {
          const logsUrl = `${explorerBase}/addresses/${vaultAddress}/logs?topic0=${SET_IS_ALLOCATOR_EVENT}`;
          const logsResp = await fetch(logsUrl).catch(() => null);
          if (logsResp?.ok) {
            const logsData = await logsResp.json();
            for (const log of logsData.items ?? []) {
              // SetIsAllocator(address indexed allocator, bool isAllocator)
              // topic[1] = allocator address (padded to 32 bytes)
              if (log.topics?.[1]) {
                const addr = '0x' + log.topics[1].slice(26);
                candidates.add(addr.toLowerCase());
              }
            }
          }

          // Source 2: Direct transaction calls (catches EOA-direct calls)
          const txUrl = `${explorerBase}/addresses/${vaultAddress}/transactions?filter=to`;
          const txResp = await fetch(txUrl).catch(() => null);
          if (txResp?.ok) {
            const txData = await txResp.json();
            for (const tx of txData.items ?? []) {
              const input = (tx.raw_input ?? tx.input ?? '') as string;
              if (input.startsWith(SET_IS_ALLOCATOR_SELECTOR) && input.length >= 138) {
                const addrHex = '0x' + input.slice(34, 74);
                candidates.add(addrHex.toLowerCase());
              }
            }
          }
        }
      } catch {
        // Explorer APIs failed — continue with known addresses
      }

      // Source 2b: RPC event scan — for chains without a blockscout-style
      // explorer (Pharos, XDC), discover SetIsAllocator events directly via
      // `eth_getLogs`, paginated for range-limited RPCs (Pharos caps at 1000
      // blocks/request). Without this, allocators set during vault init never
      // surface in the Parameters tab on those chains.
      if (!explorerBaseFor(chainId)) {
        try {
          const { getPublicClient } = await import('../data/rpcClient');
          const { scanContractEvent } = await import('../data/eventScan');
          const { parseAbiItem } = await import('viem');
          const event = parseAbiItem(
            'event SetIsAllocator(address indexed account, bool isAllocator)',
          );
          const client = getPublicClient(chainId);
          const latest = await client.getBlockNumber();
          // Incremental: if we've scanned before, only cover new blocks.
          const since = cache ? BigInt(cache.lastBlock) + 1n : undefined;
          const logs = await scanContractEvent(client, chainId, vaultAddress, event, since, latest);
          for (const log of logs) {
            const acct = (log as { args?: { account?: string } }).args?.account;
            if (acct) candidates.add(acct.toLowerCase());
          }
          scannedTo = latest;
        } catch {
          // RPC scan failed — fall back to known addresses below.
        }
      }

      // Source 3: Known addresses
      if (chainConfig?.periphery?.publicAllocator) {
        candidates.add(chainConfig.periphery.publicAllocator.toLowerCase());
      }
      if (userAddress) {
        candidates.add(userAddress.toLowerCase());
      }

      // Step 2: Verify ALL candidates on-chain via isAllocator(). (A cached
      // allocator that's since been revoked fails here and drops out.)
      const verified: Address[] = [];
      const checks = await Promise.allSettled(
        [...candidates].map(async (addr) => {
          const isAlloc = await checkIsAllocator(chainId, vaultAddress, addr as Address);
          return { addr: addr as Address, isAlloc };
        }),
      );

      for (const r of checks) {
        if (r.status === 'fulfilled' && r.value.isAlloc) {
          verified.push(r.value.addr);
        }
      }

      // Persist the verified set + scan cursor so the next load is instant
      // and only scans the delta. Only when we actually advanced the cursor.
      if (scannedTo !== null) {
        writeAllocCache(chainId, vaultAddress, {
          allocators: verified,
          lastBlock: scannedTo.toString(),
        });
      }

      return verified;
    },
    enabled: !!chainId && !!vaultAddress,
    staleTime: 5 * 60_000,
    // Show the cached allocators immediately while the (delta) scan runs.
    placeholderData: () => {
      const c = readAllocCache(chainId, vaultAddress);
      return c ? (c.allocators as Address[]) : undefined;
    },
  });
}

// ============================================================
// useVaultPendingActions
// ============================================================

export function useVaultPendingActions(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  marketIds: `0x${string}`[] | undefined,
) {
  return useQuery({
    queryKey: [...vaultKeys.pending(chainId!, vaultAddress!), marketIds],
    queryFn: async () => {
      if (!chainId || !vaultAddress) return [];

      const actions: PendingAction[] = [];

      const pendingTimelock = await fetchPendingTimelock(chainId, vaultAddress);
      if (pendingTimelock) {
        actions.push({
          type: 'timelock',
          description: `Timelock change to ${Number(pendingTimelock.value)}s`,
          validAt: pendingTimelock.validAt,
          value: pendingTimelock.value,
        });
      }

      const pendingGuardian = await fetchPendingGuardian(chainId, vaultAddress);
      if (pendingGuardian) {
        actions.push({
          type: 'guardian',
          description: `Guardian change to ${pendingGuardian.value}`,
          validAt: pendingGuardian.validAt,
          value: pendingGuardian.value,
        });
      }

      if (marketIds) {
        const pendingCaps = await Promise.all(
          marketIds.map((id) => fetchPendingCap(chainId, vaultAddress, id)),
        );
        for (const pc of pendingCaps) {
          if (pc) {
            actions.push({
              type: 'cap',
              description: `Cap increase to ${pc.value}`,
              validAt: pc.validAt,
              marketId: pc.marketId,
              value: pc.value,
            });
          }
        }
      }

      return actions.sort((a, b) => Number(a.validAt - b.validAt));
    },
    enabled: !!chainId && !!vaultAddress,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ============================================================
// useDiscoveredMarketStatuses — Read config + pendingCap for
// discovered markets that are NOT already in the vault queues.
// This detects PENDING/ENABLED states for markets added via submitCap.
// ============================================================

export interface DiscoveredMarketStatus {
  marketId: `0x${string}`;
  config: MarketCap;
  pendingCap: PendingCap | null;
}

export function useDiscoveredMarketStatuses(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  discoveredMarketIds: `0x${string}`[] | undefined,
) {
  return useQuery({
    queryKey: [...vaultKeys.discoveredStatuses(chainId!, vaultAddress!), discoveredMarketIds],
    queryFn: async (): Promise<DiscoveredMarketStatus[]> => {
      if (!chainId || !vaultAddress || !discoveredMarketIds?.length) return [];

      // Fetch each market independently — one RPC failure shouldn't block all
      const settled = await Promise.allSettled(
        discoveredMarketIds.map(async (marketId) => {
          const [config, pendingCap] = await Promise.all([
            fetchMarketCap(chainId, vaultAddress, marketId),
            fetchPendingCap(chainId, vaultAddress, marketId),
          ]);
          return { marketId, config, pendingCap };
        }),
      );

      const results: DiscoveredMarketStatus[] = [];
      for (const s of settled) {
        if (s.status === 'rejected') {
          console.warn('[useDiscoveredMarketStatuses] RPC call failed:', s.reason);
          continue;
        }
        const r = s.value;
        // Only include markets that have on-chain state (enabled or pending)
        if (r.config.enabled || r.config.cap > 0n || r.pendingCap !== null) {
          results.push(r);
        }
      }

      return results;
    },
    enabled: !!chainId && !!vaultAddress && !!discoveredMarketIds?.length,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
