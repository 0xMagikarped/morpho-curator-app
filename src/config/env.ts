export const env = {
  walletConnectProjectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '',
  sentryDsn: import.meta.env.VITE_SENTRY_DSN ?? '',
  ethRpcUrl: import.meta.env.VITE_ETH_RPC_URL ?? '',
  baseRpcUrl: import.meta.env.VITE_BASE_RPC_URL ?? '',
  seiRpcUrl: import.meta.env.VITE_SEI_RPC_URL ?? '',
} as const;

if (!env.walletConnectProjectId) {
  console.warn('[env] VITE_WALLETCONNECT_PROJECT_ID is not set — WalletConnect will not work');
}
