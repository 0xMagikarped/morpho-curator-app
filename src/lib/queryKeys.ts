/**
 * Hierarchical query key factories for TanStack Query.
 * Enables targeted invalidation at any level of the hierarchy.
 *
 * Usage:
 *   queryClient.invalidateQueries({ queryKey: vaultKeys.list(1) })       // all vaults on chain 1
 *   queryClient.invalidateQueries({ queryKey: vaultKeys.detail(1, '0x') }) // everything about one vault
 */

export const vaultKeys = {
  all: ['vault'] as const,
  lists: () => [...vaultKeys.all, 'list'] as const,
  list: (chainId: number) => [...vaultKeys.lists(), chainId] as const,
  details: () => [...vaultKeys.all, 'detail'] as const,
  detail: (chainId: number, address: string) =>
    [...vaultKeys.details(), chainId, address.toLowerCase()] as const,
  fullData: (chainId: number, address: string) =>
    [...vaultKeys.detail(chainId, address), 'full-data'] as const,
  role: (chainId: number, address: string, user?: string) =>
    [...vaultKeys.detail(chainId, address), 'role', user ?? ''] as const,
  pending: (chainId: number, address: string) =>
    [...vaultKeys.detail(chainId, address), 'pending'] as const,
  adapters: (chainId: number, address: string) =>
    [...vaultKeys.detail(chainId, address), 'adapters'] as const,
  adapterPreview: (chainId: number, vaultAddress: string, adapterAddress: string) =>
    [...vaultKeys.detail(chainId, vaultAddress), 'adapter-preview', adapterAddress.toLowerCase()] as const,
  queues: (chainId: number, address: string) =>
    [...vaultKeys.detail(chainId, address), 'queues'] as const,
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
};

export const oracleKeys = {
  all: ['oracle'] as const,
  info: (chainId: number, address: string) =>
    [...oracleKeys.all, 'info', chainId, address.toLowerCase()] as const,
  health: (chainId: number, address: string) =>
    [...oracleKeys.all, 'health', chainId, address.toLowerCase()] as const,
  risk: (chainId: number, address: string) =>
    [...oracleKeys.all, 'risk', chainId, address.toLowerCase()] as const,
  healthBatch: (chainId: number, addresses: string[]) =>
    [...oracleKeys.all, 'health-batch', chainId, addresses.map(a => a.toLowerCase()).join(',')] as const,
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  vaults: (trackedKey: string, wallet?: string) =>
    [...dashboardKeys.all, 'vaults', trackedKey, wallet ?? ''] as const,
  pending: (trackedKey: string) =>
    [...dashboardKeys.all, 'pending', trackedKey] as const,
  managed: (wallet: string) =>
    [...dashboardKeys.all, 'managed', wallet.toLowerCase()] as const,
};

export const riskKeys = {
  all: ['risk'] as const,
  utilization: (chainId: number, marketIds: string) =>
    [...riskKeys.all, 'utilization', chainId, marketIds] as const,
  sharePrice: (chainId: number, address: string) =>
    [...riskKeys.all, 'share-price', chainId, address.toLowerCase()] as const,
  sharePriceHistory: (chainId: number, address: string) =>
    [...riskKeys.all, 'share-price-history', chainId, address.toLowerCase()] as const,
};

export const sdkKeys = {
  vault: (address: string, chainId: number) =>
    ['morpho-sdk', 'vault', address.toLowerCase(), chainId] as const,
  allocations: (address: string, chainId: number) =>
    ['morpho-sdk', 'allocations', address.toLowerCase(), chainId] as const,
  market: (marketId: string, chainId: number) =>
    ['morpho-sdk', 'market', marketId, chainId] as const,
  liquidity: (marketId: string, chainId: number) =>
    ['morpho-sdk', 'liquidity', marketId, chainId] as const,
};
