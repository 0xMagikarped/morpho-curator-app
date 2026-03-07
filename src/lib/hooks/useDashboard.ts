import { useQuery } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { createPublicClient, http, type Address } from 'viem';
import { useAppStore } from '../../store/appStore';
import { getChainConfig } from '../../config/chains';
import { metaMorphoV1Abi } from '../contracts/abis';
import type { VaultVersion, PendingAction } from '../../types';
import {
  fetchVaultQueues,
  fetchPendingTimelock,
  fetchPendingGuardian,
  fetchPendingCap,
} from '../data/rpcClient';

// ============================================================
// Vault Summary (enriched from on-chain data)
// ============================================================

export interface VaultSummary {
  address: Address;
  chainId: number;
  name: string;
  symbol: string;
  version: VaultVersion;
  tvl: bigint;
  fee: bigint;
  timelock: bigint;
  sharePrice: bigint;
  role: 'owner' | 'curator' | 'allocator' | 'none';
  supplyQueueLength: number;
}

// ============================================================
// useDashboardVaults — Enrich tracked vaults with on-chain data
// ============================================================

export function useDashboardVaults() {
  const { address: walletAddress } = useAccount();
  const { trackedVaults } = useAppStore();

  return useQuery<VaultSummary[]>({
    queryKey: ['dashboard-vaults', trackedVaults.map((v) => `${v.chainId}-${v.address}`).join(','), walletAddress],
    queryFn: async () => {
      if (trackedVaults.length === 0) return [];

      const summaries = await Promise.allSettled(
        trackedVaults.map((tv) => enrichVaultSummary(tv.chainId, tv.address, tv.name, tv.version, walletAddress)),
      );

      return summaries
        .filter((r): r is PromiseFulfilledResult<VaultSummary> => r.status === 'fulfilled')
        .map((r) => r.value);
    },
    enabled: trackedVaults.length > 0,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });
}

// ============================================================
// useDashboardPendingActions — Aggregate pending actions from all tracked vaults
// ============================================================

export function useDashboardPendingActions() {
  const { trackedVaults } = useAppStore();

  return useQuery<Array<PendingAction & { vaultName?: string; chainId: number }>>({
    queryKey: ['dashboard-pending', trackedVaults.map((v) => `${v.chainId}-${v.address}`).join(',')],
    queryFn: async () => {
      if (trackedVaults.length === 0) return [];

      const results = await Promise.allSettled(
        trackedVaults.map(async (tv) => {
          const actions: Array<PendingAction & { vaultName?: string; chainId: number }> = [];

          const pendingTimelock = await fetchPendingTimelock(tv.chainId, tv.address as Address).catch(() => null);
          if (pendingTimelock) {
            actions.push({
              ...pendingTimelock,
              type: 'timelock',
              description: `Timelock change to ${Number(pendingTimelock.value)}s`,
              vaultName: tv.name,
              chainId: tv.chainId,
            });
          }

          const pendingGuardian = await fetchPendingGuardian(tv.chainId, tv.address as Address).catch(() => null);
          if (pendingGuardian) {
            actions.push({
              type: 'guardian',
              description: `Guardian change to ${pendingGuardian.value}`,
              validAt: pendingGuardian.validAt,
              value: pendingGuardian.value,
              vaultName: tv.name,
              chainId: tv.chainId,
            });
          }

          // Check pending caps for markets in the vault
          try {
            const queues = await fetchVaultQueues(tv.chainId, tv.address as Address);
            const marketIds = [...new Set([...queues.supplyQueue, ...queues.withdrawQueue])];
            const caps = await Promise.all(
              marketIds.map((id) => fetchPendingCap(tv.chainId, tv.address as Address, id).catch(() => null)),
            );
            for (const pc of caps) {
              if (pc) {
                actions.push({
                  type: 'cap',
                  description: `Cap increase to ${pc.value}`,
                  validAt: pc.validAt,
                  marketId: pc.marketId,
                  value: pc.value,
                  vaultName: tv.name,
                  chainId: tv.chainId,
                });
              }
            }
          } catch { /* ignore queue fetch errors */ }

          return actions;
        }),
      );

      return results
        .filter((r): r is PromiseFulfilledResult<typeof results extends Array<infer T> ? T extends PromiseFulfilledResult<infer V> ? V : never : never> => r.status === 'fulfilled')
        .flatMap((r) => r.value)
        .sort((a, b) => Number(a.validAt - b.validAt));
    },
    enabled: trackedVaults.length > 0,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });
}

async function enrichVaultSummary(
  chainId: number,
  vaultAddress: Address,
  name: string,
  version: VaultVersion,
  walletAddress?: Address,
): Promise<VaultSummary> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unknown chain: ${chainId}`);

  const client = createPublicClient({
    transport: http(chainConfig.rpcUrls[0]),
  });

  const ONE_SHARE = 10n ** 18n;

  const [vaultName, symbol, totalAssets, fee, timelock, sharePrice, sqLen, owner, curator] = await Promise.all([
    client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'name' }).catch(() => name),
    client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'symbol' }).catch(() => '???'),
    client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'totalAssets' }).catch(() => 0n),
    client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'fee' }).catch(() => 0n),
    client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'timelock' }).catch(() => 0n),
    client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'convertToAssets', args: [ONE_SHARE] }).catch(() => ONE_SHARE),
    client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'supplyQueueLength' }).catch(() => 0n),
    client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'owner' }).catch(() => '0x0'),
    client.readContract({ address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'curator' }).catch(() => '0x0'),
  ]);

  let role: VaultSummary['role'] = 'none';
  if (walletAddress) {
    const lowerWallet = walletAddress.toLowerCase();
    if ((owner as string).toLowerCase() === lowerWallet) role = 'owner';
    else if ((curator as string).toLowerCase() === lowerWallet) role = 'curator';
    else {
      try {
        const isAlloc = await client.readContract({
          address: vaultAddress,
          abi: metaMorphoV1Abi,
          functionName: 'isAllocator',
          args: [walletAddress],
        });
        if (isAlloc) role = 'allocator';
      } catch { /* ignore */ }
    }
  }

  return {
    address: vaultAddress,
    chainId,
    name: vaultName as string,
    symbol: symbol as string,
    version,
    tvl: totalAssets as bigint,
    fee: fee as bigint,
    timelock: timelock as bigint,
    sharePrice: sharePrice as bigint,
    role,
    supplyQueueLength: Number(sqLen as bigint),
  };
}
