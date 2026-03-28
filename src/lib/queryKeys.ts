/**
 * Hierarchical query key factories for TanStack Query.
 * Enables targeted invalidation at any level of the hierarchy.
 *
 * All factories are safe to call with undefined/empty values — they will
 * produce a stable key without throwing. This is important because React Query
 * evaluates queryKey even when `enabled: false`.
 *
 * Usage:
 *   queryClient.invalidateQueries({ queryKey: vaultKeys.list(1) })       // all vaults on chain 1
 *   queryClient.invalidateQueries({ queryKey: vaultKeys.detail(1, '0x') }) // everything about one vault
 */

const lower = (s: string | undefined | null): string => s?.toLowerCase() ?? '';

export const vaultKeys = {
  all: ['vault'] as const,
  lists: () => [...vaultKeys.all, 'list'] as const,
  list: (chainId: number) => [...vaultKeys.lists(), chainId] as const,
  details: () => [...vaultKeys.all, 'detail'] as const,
  detail: (chainId: number, address: string) =>
    [...vaultKeys.details(), chainId, lower(address)] as const,
  fullData: (chainId: number, address: string) =>
    [...vaultKeys.detail(chainId, address), 'full-data'] as const,
  role: (chainId: number, address: string, user?: string) =>
    [...vaultKeys.detail(chainId, address), 'role', lower(user)] as const,
  pending: (chainId: number, address: string) =>
    [...vaultKeys.detail(chainId, address), 'pending'] as const,
  discoveredStatuses: (chainId: number, address: string) =>
    [...vaultKeys.detail(chainId, address), 'discovered-statuses'] as const,
  adapters: (chainId: number, address: string) =>
    [...vaultKeys.detail(chainId, address), 'adapters'] as const,
  adapterPreview: (chainId: number, vaultAddress: string, adapterAddress: string) =>
    [...vaultKeys.detail(chainId, vaultAddress), 'adapter-preview', lower(adapterAddress)] as const,
  queues: (chainId: number, address: string) =>
    [...vaultKeys.detail(chainId, address), 'queues'] as const,
  publicAllocator: (chainId: number, address: string) =>
    [...vaultKeys.detail(chainId, address), 'public-allocator'] as const,
};

export const marketKeys = {
  all: ['market'] as const,
  lists: () => [...marketKeys.all, 'list'] as const,
  list: (chainId: number) => [...marketKeys.lists(), chainId] as const,
  detail: (chainId: number, marketId: string) =>
    [...marketKeys.all, 'detail', chainId, marketId] as const,
  enriched: (chainId: number, marketId: string) =>
    [...marketKeys.detail(chainId, marketId), 'enriched'] as const,
  discovered: (chainId: number) =>
    [...marketKeys.lists(), 'discovered', chainId] as const,
  scanner: (chainId: number) =>
    [...marketKeys.all, 'scanner', chainId] as const,
  curators: (chainId: number, marketId: string) =>
    [...marketKeys.detail(chainId, marketId), 'curators'] as const,
};

export const oracleKeys = {
  all: ['oracle'] as const,
  info: (chainId: number, address: string) =>
    [...oracleKeys.all, 'info', chainId, lower(address)] as const,
  health: (chainId: number, address: string) =>
    [...oracleKeys.all, 'health', chainId, lower(address)] as const,
  risk: (chainId: number, address: string) =>
    [...oracleKeys.all, 'risk', chainId, lower(address)] as const,
  healthBatch: (chainId: number, addresses: string[]) =>
    [...oracleKeys.all, 'health-batch', chainId, (addresses ?? []).map(a => lower(a)).join(',')] as const,
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  vaults: (trackedKey: string, wallet?: string) =>
    [...dashboardKeys.all, 'vaults', trackedKey, lower(wallet)] as const,
  pending: (trackedKey: string) =>
    [...dashboardKeys.all, 'pending', trackedKey] as const,
  managed: (wallet: string) =>
    [...dashboardKeys.all, 'managed', lower(wallet)] as const,
};

export const riskKeys = {
  all: ['risk'] as const,
  utilization: (chainId: number, marketIds: string) =>
    [...riskKeys.all, 'utilization', chainId, marketIds] as const,
  sharePrice: (chainId: number, address: string) =>
    [...riskKeys.all, 'share-price', chainId, lower(address)] as const,
  sharePriceHistory: (chainId: number, address: string) =>
    [...riskKeys.all, 'share-price-history', chainId, lower(address)] as const,
};

export const sdkKeys = {
  vault: (address: string, chainId: number) =>
    ['morpho-sdk', 'vault', lower(address), chainId] as const,
  allocations: (address: string, chainId: number) =>
    ['morpho-sdk', 'allocations', lower(address), chainId] as const,
  market: (marketId: string, chainId: number) =>
    ['morpho-sdk', 'market', marketId, chainId] as const,
  liquidity: (marketId: string, chainId: number) =>
    ['morpho-sdk', 'liquidity', marketId, chainId] as const,
};
