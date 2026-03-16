import { http, fallback } from 'wagmi';
import { mainnet, base } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import type { Chain } from 'wagmi/chains';

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
    default: { name: 'SeiTrace', url: 'https://seitrace.com' },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
};

// Build transport lists — env-configured RPCs (e.g. Infura) get priority
const seiTransports = [
  ...(import.meta.env.VITE_SEI_RPC_URL ? [http(import.meta.env.VITE_SEI_RPC_URL)] : []),
  http('https://sei-evm-rpc.publicnode.com'),
  http('https://evm-rpc.sei-apis.com'),
];
const ethTransports = [
  ...(import.meta.env.VITE_ETH_RPC_URL ? [http(import.meta.env.VITE_ETH_RPC_URL)] : []),
  http('https://ethereum-rpc.publicnode.com'),
  http('https://eth.public-rpc.com'),
  http('https://rpc.ankr.com/eth'),
];
const baseTransports = [
  ...(import.meta.env.VITE_BASE_RPC_URL ? [http(import.meta.env.VITE_BASE_RPC_URL)] : []),
  http('https://mainnet.base.org'),
  http('https://base-rpc.publicnode.com'),
  http('https://rpc.ankr.com/base'),
];

export const config = getDefaultConfig({
  appName: 'Morpho Curator Dashboard',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '',
  chains: [sei, mainnet, base],
  transports: {
    [sei.id]: fallback(seiTransports),
    [mainnet.id]: fallback(ethTransports),
    [base.id]: fallback(baseTransports),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
