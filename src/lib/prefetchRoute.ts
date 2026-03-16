const prefetchedRoutes = new Set<string>();

const routeImports: Record<string, () => Promise<unknown>> = {
  '/': () => import('../pages/DashboardPage'),
  '/markets': () => import('../pages/MarketsPage'),
  '/create': () => import('../pages/CreateVaultPage'),
  '/market/create': () => import('../pages/CreateMarketPage'),
  '/oracle/decode': () => import('../pages/OracleDecoderPage'),
  '/oracle/deploy': () => import('../pages/OracleDeployerPage'),
  '/settings': () => import('../pages/SettingsPage'),
  'vault-detail': () => import('../pages/VaultPage'),
  'set-registry': () => import('../pages/SetRegistryPage'),
  'add-market': () => import('../pages/AddMarketPage'),
  'caps': () => import('../pages/CapsPage'),
};

/**
 * Prefetch a route's chunk on hover/focus so navigation is instant.
 * Safe to call multiple times — each route is only fetched once.
 */
export function prefetchRoute(routeKey: string) {
  if (prefetchedRoutes.has(routeKey)) return;
  const importFn = routeImports[routeKey];
  if (importFn) {
    prefetchedRoutes.add(routeKey);
    importFn().catch(() => {
      prefetchedRoutes.delete(routeKey);
    });
  }
}
