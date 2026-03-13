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

export const config = getDefaultConfig({
  appName: 'Morpho Curator Dashboard',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '',
  chains: [sei, mainnet, base],
  transports: {
    [sei.id]: fallback([
      http('https://sei-evm-rpc.publicnode.com'),
      http('https://evm-rpc.sei-apis.com'),
    ]),
    [mainnet.id]: fallback([
      http('https://ethereum-rpc.publicnode.com'),
      http('https://eth.public-rpc.com'),
      http('https://rpc.ankr.com/eth'),
    ]),
    [base.id]: fallback([
      http('https://mainnet.base.org'),
      http('https://base-rpc.publicnode.com'),
      http('https://rpc.ankr.com/base'),
    ]),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
