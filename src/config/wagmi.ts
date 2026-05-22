import { http, fallback } from 'wagmi';
import { mainnet, base, bsc, xdc } from 'wagmi/chains';
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

/**
 * SEI chain definition for wagmi (not included in wagmi/chains).
 */
export const sei: Chain = {
  id: 1329,
  name: 'SEI',
  nativeCurrency: { name: 'SEI', symbol: 'SEI', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://sei-evm-rpc.publicnode.com'],
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

// Build transport lists — env-configured RPCs (e.g. Infura) get priority
const seiTransports = [
  ...(env.seiRpcUrl ? [http(env.seiRpcUrl)] : []),
  http('https://sei-evm-rpc.publicnode.com'),
  http('https://evm-rpc.sei-apis.com'),
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

export const config = getDefaultConfig({
  appName: 'Morpho Curator Dashboard',
  projectId: env.walletConnectProjectId,
  chains: [sei, mainnet, base, bsc, pharos, xdc],
  transports: {
    [sei.id]: fallback(seiTransports),
    [mainnet.id]: fallback(ethTransports),
    [base.id]: fallback(baseTransports),
    [bsc.id]: fallback(bnbTransports),
    [pharos.id]: fallback(pharosTransports),
    [xdc.id]: fallback(xdcTransports),
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
