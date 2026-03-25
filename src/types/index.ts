import type { Address } from 'viem';

// ============================================================
// Chain Configuration
// ============================================================

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrls: string[];
  /** Separate RPC for getLogs if the primary RPC doesn't support it (e.g., SEI) */
  eventRpcUrl?: string;
  blockExplorer: string;
  morphoBlue: Address;
  vaultFactories: {
    v1?: Address;
    v2?: Address;
  };
  periphery: {
    bundler3?: Address;
    publicAllocator?: Address;
    adaptiveCurveIrm?: Address;
    oracleV2Factory?: Address;
    /** Morpho V2 Adapter Registry — required for V2 vaults to manage adapters */
    v2AdapterRegistry?: Address;
    /** MorphoMarketV1AdapterV2 factory — deploys market adapters for V2 vaults */
    morphoMarketV1AdapterV2Factory?: Address;
    /** MorphoVaultV1Adapter factory — deploys vault adapters for V2 vaults */
    morphoVaultV1AdapterFactory?: Address;
  };
  apiSupported: boolean;
  blockTime: number;
  finality: 'instant' | 'probabilistic';
  gasConfig: {
    blockGasLimit: number;
    sstoreCost: number;
  };
  nativeToken: { symbol: string; decimals: number; wrapped: Address };
  stablecoins: TokenInfo[];
  oracleProviders: OracleProvider[];
  deploymentBlock: number;
  verified: boolean;
  scanner: {
    batchSize: number;
    pollIntervalMs: number;
  };
  migration?: {
    usdcBridgedToNative?: {
      status: 'pending' | 'live' | 'completed';
      bridgedAddress: Address;
      nativeAddress: Address | null;
      announcementUrl: string | null;
    };
  };
}

export type OracleProvider =
  | 'chainlink-push'
  | 'chainlink-data-streams'
  | 'pyth'
  | 'redstone'
  | 'api3'
  | 'custom';

export interface TokenInfo {
  symbol: string;
  address: Address;
  decimals: number;
  name?: string;
  logoUrl?: string;
}

// ============================================================
// Vault Types
// ============================================================

export type VaultVersion = 'v1' | 'v2';

/** Fields shared by both V1 and V2 vaults */
interface VaultInfoBase {
  address: Address;
  chainId: number;
  name: string;
  symbol: string;
  asset: Address;
  morphoBlue: Address;
  owner: Address;
  pendingOwner: Address;
  curator: Address;
  allocators: Address[];
  timelock: bigint;
  fee: bigint; // Performance fee (WAD)
  feeRecipient: Address;
  totalAssets: bigint;
  totalSupply: bigint;
  lastTotalAssets: bigint;
}

/** V1 (MetaMorpho) vault — uses supply/withdraw queues and guardian */
export interface VaultInfoV1 extends VaultInfoBase {
  version: 'v1';
  guardian: Address;
}

/** V2 vault — uses adapters, per-address sentinels, gates, dual fee model */
export interface VaultInfoV2 extends VaultInfoBase {
  version: 'v2';
  /** V2 has isSentinel(address) not a single sentinel — this is ZERO */
  sentinel: Address;
  managementFee: bigint;
  managementFeeRecipient: Address;
  adapters: AdapterInfo[];
  adaptersLength: number;
  gates: GateConfig;
}

export type VaultInfo = VaultInfoV1 | VaultInfoV2;

/** Get the emergency role address regardless of vault version */
export function getEmergencyRole(vault: VaultInfo): Address {
  return vault.version === 'v1' ? vault.guardian : vault.sentinel;
}

/** Get the emergency role label for display */
export function getEmergencyRoleLabel(version: VaultVersion): string {
  return version === 'v1' ? 'Guardian' : 'Sentinel';
}

export interface VaultRole {
  isOwner: boolean;
  isCurator: boolean;
  isAllocator: boolean;
  /** True if the wallet is the guardian (V1) or sentinel (V2) */
  isEmergencyRole: boolean;
}

// ============================================================
// Market Types
// ============================================================

export interface MarketParams {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

export type MarketId = `0x${string}`;

export interface MarketState {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
}

export interface MarketInfo {
  id: MarketId;
  params: MarketParams;
  state: MarketState;
  loanToken: TokenInfo;
  collateralToken: TokenInfo;
  supplyAPY: number;
  borrowAPY: number;
  utilization: number;
}

// ============================================================
// Cap Types
// ============================================================

export interface MarketCap {
  marketId: MarketId;
  cap: bigint;
  enabled: boolean;
  removableAt: bigint; // 0 if not pending removal
}

export interface PendingCap {
  marketId: MarketId;
  value: bigint;
  validAt: bigint;
}

// V2 Cap Types
export type CapLevel = 'adapter' | 'collateral' | 'market';

export interface V2Cap {
  id: `0x${string}`;
  level: CapLevel;
  absoluteCap: bigint;
  relativeCap: bigint;
  currentUsage: bigint;
}

// ============================================================
// Allocation Types
// ============================================================

export interface MarketAllocation {
  marketParams: MarketParams;
  assets: bigint;
}

export interface AllocationState {
  marketId: MarketId;
  supplyAssets: bigint;
  supplyCap: bigint;
  availableLiquidity: bigint;
}

// ============================================================
// V2 Adapter Types
// ============================================================

export interface AdapterInfo {
  address: Address;
  protocol: string;
  realAssets: bigint;
  isActive: boolean;
  isPending: boolean;
  pendingValidAt?: bigint;
}

export interface GateConfig {
  receiveShares: Address;
  sendShares: Address;
  receiveAssets: Address;
  sendAssets: Address;
}

/** Per-market position data for a Market V1 adapter on a V2 vault */
export interface AdapterMarketPosition {
  marketId: MarketId;
  supplyAssets: bigint;
  supplyShares: bigint;
  params: MarketParams | null;
  marketState: MarketState | null;
  loanToken: TokenInfo | null;
  collateralToken: TokenInfo | null;
}

// ============================================================
// Pending Actions
// ============================================================

export interface PendingTimelock {
  value: bigint;
  validAt: bigint;
}

export interface PendingGuardian {
  value: Address;
  validAt: bigint;
}

export interface PendingAction {
  type: 'cap' | 'timelock' | 'guardian' | 'marketRemoval' | 'v2Submit';
  description: string;
  validAt: bigint;
  data?: `0x${string}`; // V2: encoded submit data
  marketId?: MarketId;
  value?: bigint | Address;
}

// ============================================================
// Alert Types
// ============================================================

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  vaultAddress?: Address;
  marketId?: MarketId;
  timestamp: number;
  dismissed: boolean;
}

// ============================================================
// Data Layer Types
// ============================================================

export type DataMode = 'rpc' | 'local-indexer' | 'graphql-api';

export interface DataSourceConfig {
  modes: DataMode[];
  rpcUrl: string;
  apiUrl?: string;
  indexerDbName?: string;
}
