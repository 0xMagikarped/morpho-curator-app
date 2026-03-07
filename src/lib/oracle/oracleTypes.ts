import type { Address } from 'viem';

// ============================================================
// Oracle Type Classification
// ============================================================

export type OracleType =
  | 'chainlink-push'            // Chainlink aggregator (Ethereum, Base)
  | 'chainlink-data-streams'    // Chainlink Data Streams / pull-based (SEI)
  | 'chainlink-v2'              // MorphoChainlinkOracleV2 (pure Chainlink feeds)
  | 'chainlink-erc4626-hybrid'  // Chainlink + ERC-4626 vault hybrid
  | 'erc4626-exchange-rate'     // ERC-4626 exchange rate only (no Chainlink)
  | 'pyth'                      // Pyth Network
  | 'redstone'                  // RedStone
  | 'api3'                      // API3
  | 'morpho-oracle-v2'          // Morpho OracleV2 (wraps underlying feeds)
  | 'morpho-oracle-unknown'     // Morpho oracle with unknown feed configuration
  | 'custom'                    // Unknown / custom oracle
  | 'none';                     // Zero address (no oracle)

export type OracleModel = 'push' | 'pull' | 'hybrid' | 'none';

// ============================================================
// Oracle Info (classification result)
// ============================================================

export interface OracleInfo {
  address: Address;
  chainId: number;
  type: OracleType;
  model: OracleModel;
  label: string;             // Human-readable label e.g. "Chainlink ETH/USD"
  underlyingFeeds?: Address[]; // For MorphoOracleV2, the base/quote feeds
  feedInfo?: OracleFeedInfo; // Detailed feed introspection result
  isMorphoWrapper: boolean;  // True if deployed via Morpho OracleV2Factory
}

// ============================================================
// Oracle Health (monitoring result)
// ============================================================

export interface OracleHealth {
  address: Address;
  chainId: number;
  currentPrice: bigint | null;
  lastCheckedAt: number;       // Unix timestamp ms
  isResponding: boolean;
  latencyMs: number;           // RPC call latency
  error?: string;
}

// ============================================================
// Oracle Risk Score
// ============================================================

export interface OracleRiskDimension {
  name: string;
  score: number;     // 0-100 (100 = safest)
  weight: number;    // 0-1
  rationale: string;
}

export interface OracleRiskScore {
  address: Address;
  chainId: number;
  overall: number;   // Weighted average 0-100
  grade: OracleGrade;
  dimensions: OracleRiskDimension[];
  computedAt: number;
}

export type OracleGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export function gradeFromScore(score: number): OracleGrade {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

// ============================================================
// Oracle Feed Introspection Result
// ============================================================

export interface OracleFeedInfo {
  baseFeed1: Address | null;
  baseFeed2: Address | null;
  quoteFeed1: Address | null;
  quoteFeed2: Address | null;
  baseVault: Address | null;
  quoteVault: Address | null;
  scaleFactor: bigint | null;
}
