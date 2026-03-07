// ============================================================
// Risk Monitoring Types
// ============================================================

export interface UtilizationData {
  marketId: `0x${string}`;
  chainId: number;
  totalSupply: bigint;
  totalBorrow: bigint;
  utilization: number; // 0-100
  timestamp: number;
  status: 'normal' | 'elevated' | 'critical';
}

export interface SharePriceData {
  vaultAddress: `0x${string}`;
  chainId: number;
  sharePrice: bigint; // assets per 1e18 shares
  timestamp: number;
  previousPrice: bigint | null;
  priceChange: number; // percentage (negative = decrease)
  status: 'normal' | 'warning' | 'critical';
}

export interface SharePriceRecord {
  vaultAddress: `0x${string}`;
  chainId: number;
  sharePrice: string; // bigint serialized
  totalAssets: string;
  timestamp: number;
}

export type RiskAlertType =
  | 'oracle_stale'
  | 'utilization_high'
  | 'share_price_deviation'
  | 'pending_action_ready';

export type RiskAlertSeverity = 'critical' | 'warning' | 'info';

export interface RiskAlert {
  id: string;
  severity: RiskAlertSeverity;
  type: RiskAlertType;
  title: string;
  description: string;
  vaultAddress?: `0x${string}`;
  marketId?: `0x${string}`;
  chainId: number;
  timestamp: number;
  actionLabel?: string;
  actionRoute?: string;
}

// Thresholds
export const UTILIZATION_ELEVATED = 80;
export const UTILIZATION_CRITICAL = 90;
export const SHARE_PRICE_WARNING = -0.01;  // -0.01%
export const SHARE_PRICE_CRITICAL = -0.1;  // -0.1%

export function utilizationStatus(pct: number): 'normal' | 'elevated' | 'critical' {
  if (pct >= UTILIZATION_CRITICAL) return 'critical';
  if (pct >= UTILIZATION_ELEVATED) return 'elevated';
  return 'normal';
}

export function sharePriceStatus(changePct: number): 'normal' | 'warning' | 'critical' {
  if (changePct <= SHARE_PRICE_CRITICAL) return 'critical';
  if (changePct <= SHARE_PRICE_WARNING) return 'warning';
  return 'normal';
}
