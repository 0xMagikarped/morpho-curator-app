/**
 * Chains whose RPC is routed through the same-origin serverless proxy at
 * `/api/rpc/<chainId>` (see `api/rpc/[chainId].js`). The proxy injects the
 * server-side Alchemy key — it is NEVER exposed to the browser bundle. The
 * client uses a relative URL so it resolves to the current origin (no CORS,
 * nothing secret on the wire).
 *
 * Keep this set in sync with ALCHEMY_SLUGS in `api/_upstream.js`. XDC (50) is
 * omitted because Alchemy doesn't serve it — it keeps its public RPCs.
 */
export const PROXIED_CHAINS = new Set<number>([1, 8453, 56, 1329, 1672]);

export function isProxiedChain(chainId: number): boolean {
  return PROXIED_CHAINS.has(chainId);
}

/**
 * Chains that use the proxy EXCLUSIVELY — no direct public RPC fallback in the
 * browser. Pharos's only public endpoint (zan.top) caps getLogs at 1000 blocks
 * and rate-limits hard, so failing over to it just thrashes (10k-range queries
 * it can't serve). Better to fail-and-retry on the proxy. Other proxied chains
 * keep their public fallbacks (those endpoints are healthy + add resilience).
 */
export const PROXY_ONLY_CHAINS = new Set<number>([1672]);

export function isProxyOnlyChain(chainId: number): boolean {
  return PROXY_ONLY_CHAINS.has(chainId);
}

/**
 * Same-origin proxy URL for a chain. `fallbackPublicUrl` is appended as a query
 * param so the serverless function can still forward to a public endpoint if
 * `ALCHEMY_API_KEY` isn't configured yet (graceful degradation).
 */
export function proxyRpcUrl(chainId: number, fallbackPublicUrl?: string): string {
  const base = `/api/rpc/${chainId}`;
  return fallbackPublicUrl ? `${base}?fallback=${encodeURIComponent(fallbackPublicUrl)}` : base;
}
