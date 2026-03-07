import type { OracleHealth } from '../oracle/oracleTypes';
import type { UtilizationData, SharePriceData, RiskAlert, RiskAlertSeverity } from './riskTypes';
import type { PendingAction } from '../../types';

interface PendingActionWithVault extends PendingAction {
  vaultAddress?: `0x${string}`;
  vaultName?: string;
  chainId: number;
}

export function generateAlerts(
  oracleHealth: Map<string, OracleHealth>,
  utilization: Map<string, UtilizationData>,
  sharePrice: Map<string, SharePriceData>,
  pendingActions: PendingActionWithVault[],
): RiskAlert[] {
  const alerts: RiskAlert[] = [];

  // Oracle alerts
  for (const [key, health] of oracleHealth) {
    if (!health.isResponding) {
      alerts.push({
        id: `oracle-${key}`,
        severity: 'critical',
        type: 'oracle_stale',
        title: 'Oracle not responding',
        description: health.error ?? 'Oracle call failed',
        chainId: health.chainId,
        timestamp: Date.now(),
      });
    }
  }

  // Utilization alerts
  for (const [key, data] of utilization) {
    if (data.status === 'critical') {
      alerts.push({
        id: `util-${key}`,
        severity: 'warning',
        type: 'utilization_high',
        title: `High utilization: ${data.utilization.toFixed(1)}%`,
        description: 'Market approaching full utilization',
        marketId: data.marketId,
        chainId: data.chainId,
        timestamp: Date.now(),
      });
    }
  }

  // Share price alerts
  for (const [key, data] of sharePrice) {
    if (data.status !== 'normal') {
      alerts.push({
        id: `price-${key}`,
        severity: data.status === 'critical' ? 'critical' : 'warning',
        type: 'share_price_deviation',
        title: `Share price decreased: ${data.priceChange.toFixed(4)}%`,
        description: 'Possible bad debt event',
        vaultAddress: data.vaultAddress,
        chainId: data.chainId,
        timestamp: Date.now(),
      });
    }
  }

  // Pending action alerts
  const now = Math.floor(Date.now() / 1000);
  for (const action of pendingActions) {
    const validAt = Number(action.validAt);
    if (validAt > 0 && validAt <= now) {
      alerts.push({
        id: `pending-${action.type}-${action.marketId ?? 'global'}-${action.chainId}`,
        severity: 'info',
        type: 'pending_action_ready',
        title: `Ready: ${action.description}`,
        description: 'Timelock elapsed — can be accepted now',
        vaultAddress: action.vaultAddress,
        chainId: action.chainId,
        timestamp: Date.now(),
      });
    }
  }

  // Sort by severity
  const order: Record<RiskAlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}
