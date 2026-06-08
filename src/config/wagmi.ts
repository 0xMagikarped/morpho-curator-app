import { http, fallback } from 'wagmi';
import { mainnet, base, bsc, xdc, avalanche } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  rabbyWallet,
  phantomWallet,
  rainbowWallet,
  metaMaskWallet,
  coinbaseWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import type { Chain } from 'wagmi/chains';
import { env } from './env';
import { isProxiedChain, isProxyOnlyChain, proxyRpcUrl } from './rpcProxy';

/**
 * Build a chain's transport. Proxied chains (Alchemy via the same-origin
 * /api/rpc proxy) put the proxy FIRST in an ordered fallback so it's always
 * preferred — the public RPCs are failover only, not rank-balanced (we don't
 * want viem drifting back onto a flaky/ratelimited public endpoint). The
 * proxy carries the first public URL as its own server-side fallback.
 */
function chainTransport(
  chainId: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicTransports: any[],
  firstPublicUrl: string,
) {
  if (isProxiedChain(chainId)) {
    const proxy = http(proxyRpcUrl(chainId, firstPublicUrl));
    // Proxy-only chains (Pharos): no public fallback — see rpcProxy.ts.
    return isProxyOnlyChain(chainId)
      ? fallback([proxy])
      : fallback([proxy, ...publicTransports]);
  }
  return fallback(publicTransports, { rank: true });
}

/**
 * SEI chain definition for wagmi (not included in wagmi/chains).
 */
export const sei: Chain = {
  id: 1329,
  name: 'SEI',
  nativeCurrency: { name: 'SEI', symbol: 'SEI', decimals: 18 },
  rpcUrls: {
    // sei-apis is the official Sei Labs endpoint; publicnode tends to
    // throttle under burst load and was timing out wagmi's writeContract
    // preflights, leaving the wallet popup hanging. Keep publicnode as
    // a fallback in the wagmi transport list, but advertise sei-apis as
    // the canonical chain URL.
    default: {
      http: ['https://evm-rpc.sei-apis.com'],
    },
  },
  blockExplorers: {
    default: { name: 'SeiScan', url: 'https://seiscan.io' },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
};

/**
 * Pharos chain definition (RWA-focused L1, chainId 1672).
 * Not in wagmi/chains — defined manually.
 */
export const pharos: Chain = {
  id: 1672,
  name: 'Pharos',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.pharos.xyz'],
    },
  },
  blockExplorers: {
    default: { name: 'PharosScan', url: 'https://pharosscan.xyz' },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
  testnet: false,
};

// Build transport lists — env-configured RPCs (e.g. Infura) get priority.
//
// 3s was too aggressive: SEI reads on a healthy public endpoint can spike
// to 4-5s under load (multicall batches, getLogs) and a tight timeout
// just bounces between endpoints faster than they can warm up. 8s gives
// each leaf a fair shot before failing over, and fallback() will still
// switch to a different endpoint if one is truly down.
const LEAF_TIMEOUT_MS = 8_000;
const seiTransports = [
  ...(env.seiRpcUrl ? [http(env.seiRpcUrl, { timeout: LEAF_TIMEOUT_MS })] : []),
  // sei-apis FIRST — the official Sei Labs endpoint.
  http('https://evm-rpc.sei-apis.com', { timeout: LEAF_TIMEOUT_MS }),
  // Diversify the fallback set. publicnode has been throttling under
  // burst load (the "RPC error" the user reported); the additional
  // community endpoints below pick up the slack so reads/simulates
  // keep moving if any single host is down.
  http('https://sei.drpc.org', { timeout: LEAF_TIMEOUT_MS }),
  http('https://evm-rpc.sei.basementnodes.ca', { timeout: LEAF_TIMEOUT_MS }),
  http('https://sei-evm-rpc.publicnode.com', { timeout: LEAF_TIMEOUT_MS }),
];
const ethTransports = [
  ...(env.ethRpcUrl ? [http(env.ethRpcUrl)] : []),
  http('https://ethereum-rpc.publicnode.com'),
  http('https://eth.public-rpc.com'),
  http('https://rpc.ankr.com/eth'),
];
const baseTransports = [
  ...(env.baseRpcUrl ? [http(env.baseRpcUrl)] : []),
  http('https://mainnet.base.org'),
  http('https://base-rpc.publicnode.com'),
  http('https://rpc.ankr.com/base'),
];
const bnbTransports = [
  ...(env.bnbRpcUrl ? [http(env.bnbRpcUrl)] : []),
  http('https://bsc.publicnode.com'),
  http('https://bsc-dataseed1.binance.org'),
  http('https://bsc-dataseed2.binance.org'),
];
const pharosTransports = [
  ...(env.pharosRpcUrl ? [http(env.pharosRpcUrl)] : []),
  http('https://rpc.pharos.xyz'),
];
const xdcTransports = [
  ...(env.xdcRpcUrl ? [http(env.xdcRpcUrl)] : []),
  http('https://rpc.xinfin.network'),
  http('https://erpc.xdcrpc.com'),
  http('https://rpc.xdc.network'),
];
const avalancheTransports = [
  ...(env.avalancheRpcUrl ? [http(env.avalancheRpcUrl)] : []),
  http('https://api.avax.network/ext/bc/C/rpc'),
  http('https://avalanche-c-chain-rpc.publicnode.com'),
];

export const config = getDefaultConfig({
  appName: 'Morpho Curator Dashboard',
  projectId: env.walletConnectProjectId,
  chains: [sei, mainnet, base, bsc, pharos, xdc, avalanche],
  transports: {
    // Proxied chains: Alchemy proxy primary (ordered), publics as failover.
    // Non-proxied (XDC): `rank: true` health-ranks the public endpoints.
    [sei.id]: chainTransport(sei.id, seiTransports, 'https://evm-rpc.sei-apis.com'),
    [mainnet.id]: chainTransport(mainnet.id, ethTransports, 'https://ethereum-rpc.publicnode.com'),
    [base.id]: chainTransport(base.id, baseTransports, 'https://mainnet.base.org'),
    [bsc.id]: chainTransport(bsc.id, bnbTransports, 'https://bsc.publicnode.com'),
    [pharos.id]: chainTransport(pharos.id, pharosTransports, 'https://rpc.pharos.xyz'),
    [xdc.id]: fallback(xdcTransports, { rank: true }),
    [avalanche.id]: chainTransport(avalanche.id, avalancheTransports, 'https://api.avax.network/ext/bc/C/rpc'),
  },
  wallets: [
    {
      groupName: 'Popular',
      wallets: [
        rabbyWallet,
        metaMaskWallet,
        coinbaseWallet,
        phantomWallet,
        rainbowWallet,
        walletConnectWallet,
      ],
    },
  ],
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
