import { http, fallback } from 'wagmi';
import { mainnet, base } from 'wagmi/chains';
import { getDefaultConfig, getWalletConnectConnector } from '@rainbow-me/rainbowkit';
import {
  rabbyWallet,
  phantomWallet,
  rainbowWallet,
  metaMaskWallet,
  coinbaseWallet,
} from '@rainbow-me/rainbowkit/wallets';
import type { Chain } from 'wagmi/chains';
import type { Wallet } from '@rainbow-me/rainbowkit';

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

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';
if (!walletConnectProjectId) {
  console.warn('[wagmi] VITE_WALLETCONNECT_PROJECT_ID is not set — WalletConnect will not work. Get one at https://cloud.walletconnect.com/');
}

/**
 * Custom WalletConnect wallet that uses RainbowKit's built-in QR code + copy link UI
 * instead of the Reown AppKit modal (whose dynamic chunks fail to load on Vercel).
 *
 * RainbowKit forces `showQrModal: true` for any wallet with id === "walletConnect",
 * so we use a different id to keep RainbowKit's native QR rendering.
 */
const walletConnectNativeQr = (): Wallet => ({
  id: 'walletConnect-qr',
  name: 'WalletConnect',
  iconUrl: 'https://explorer-api.walletconnect.com/v3/logo/lg/09a83110-5fc3-45e1-65ab-8f7df2d6a400?projectId=2f05ae7f1116030fde2d36508f472bfb',
  iconBackground: '#3b99fc',
  qrCode: {
    getUri: (uri: string) => uri,
  },
  createConnector: getWalletConnectConnector({
    projectId: walletConnectProjectId,
  }),
});

export const config = getDefaultConfig({
  appName: 'Morpho Curator Dashboard',
  projectId: walletConnectProjectId,
  chains: [sei, mainnet, base],
  transports: {
    [sei.id]: fallback(seiTransports),
    [mainnet.id]: fallback(ethTransports),
    [base.id]: fallback(baseTransports),
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
        walletConnectNativeQr,
      ],
    },
  ],
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
