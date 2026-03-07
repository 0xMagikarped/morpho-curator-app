/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WALLETCONNECT_PROJECT_ID: string;
  readonly VITE_SEI_RPC_URL: string;
  readonly VITE_ETH_RPC_URL: string;
  readonly VITE_BASE_RPC_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
