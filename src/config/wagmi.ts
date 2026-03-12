import { http } from 'wagmi';
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
};

export const config = getDefaultConfig({
  appName: 'Morpho Curator Dashboard',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '',
  chains: [sei, mainnet, base],
  transports: {
    [sei.id]: http('https://sei-evm-rpc.publicnode.com'),
    [mainnet.id]: http('https://ethereum-rpc.publicnode.com'),
    [base.id]: http('https://mainnet.base.org'),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
