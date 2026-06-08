/**
 * Provider-key URL patterns. A `VITE_*` env var is inlined into the public
 * client bundle by Vite — so an RPC URL with an embedded API key would ship
 * the key to every visitor. These RPCs must never be used client-side; a
 * keyed/paid RPC belongs behind a server-side proxy instead.
 */
const KEYED_RPC_PATTERNS: RegExp[] = [
  /infura\.io\/v3\//i,
  /alchemy\.com\/v2\//i,
  /g\.alchemy\.com\//i,
  /\.quiknode\.pro\//i,
  /\.quicknode\.com\//i,
];

/**
 * Reject any `VITE_*_RPC_URL` that embeds a provider API key — it would be
 * publicly exposed in the client bundle. Returns `''` on rejection so the app
 * falls back to the unkeyed public RPCs in `chains.ts`.
 */
export function sanitizeRpcUrl(name: string, url: string): string {
  if (!url) return '';
  if (KEYED_RPC_PATTERNS.some((re) => re.test(url))) {
    console.error(
      `[env] ${name} contains an embedded provider API key. VITE_* vars are ` +
        `inlined into the public client bundle, so the key would be exposed to ` +
        `every visitor. Ignoring this RPC and falling back to public endpoints. ` +
        `Use a server-side proxy for keyed RPCs.`,
    );
    return '';
  }
  return url;
}

export const env = {
  walletConnectProjectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '',
  sentryDsn: import.meta.env.VITE_SENTRY_DSN ?? '',
  ethRpcUrl: sanitizeRpcUrl('VITE_ETH_RPC_URL', import.meta.env.VITE_ETH_RPC_URL ?? ''),
  baseRpcUrl: sanitizeRpcUrl('VITE_BASE_RPC_URL', import.meta.env.VITE_BASE_RPC_URL ?? ''),
  seiRpcUrl: sanitizeRpcUrl('VITE_SEI_RPC_URL', import.meta.env.VITE_SEI_RPC_URL ?? ''),
  bnbRpcUrl: sanitizeRpcUrl('VITE_BNB_RPC_URL', import.meta.env.VITE_BNB_RPC_URL ?? ''),
  pharosRpcUrl: sanitizeRpcUrl('VITE_PHAROS_RPC_URL', import.meta.env.VITE_PHAROS_RPC_URL ?? ''),
  xdcRpcUrl: sanitizeRpcUrl('VITE_XDC_RPC_URL', import.meta.env.VITE_XDC_RPC_URL ?? ''),
  avalancheRpcUrl: sanitizeRpcUrl('VITE_AVALANCHE_RPC_URL', import.meta.env.VITE_AVALANCHE_RPC_URL ?? ''),
} as const;

if (!env.walletConnectProjectId) {
  console.warn('[env] VITE_WALLETCONNECT_PROJECT_ID is not set — WalletConnect will not work');
}
