// Chain ID → Alchemy network slug. Single source of truth for the RPC proxy,
// imported by both the serverless function (api/rpc/[chainId].js) and the Vite
// dev middleware (vite.config.ts). XDC (50) is intentionally absent — Alchemy
// doesn't serve it, so it stays on its public RPCs in the client config.
// Keep the chain-id set in sync with PROXIED_CHAINS in src/config/rpcProxy.ts.
export const ALCHEMY_SLUGS = {
  1: 'eth-mainnet',
  8453: 'base-mainnet',
  56: 'bnb-mainnet',
  1329: 'sei-mainnet',
  1672: 'pharos-mainnet',
  43114: 'avax-mainnet',
};

/** Build the upstream Alchemy URL for a chain, or null if unsupported / no key. */
export function alchemyUrl(chainId, key) {
  const slug = ALCHEMY_SLUGS[Number(chainId)];
  if (!slug || !key) return null;
  return `https://${slug}.g.alchemy.com/v2/${key}`;
}
