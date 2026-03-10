import { useMemo } from 'react';
import type { Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { VaultOracleDashboard } from '../oracle/VaultOracleDashboard';
import { RiskAlertBanner } from '../risk/RiskAlertBanner';
import { SharePriceChart } from '../risk/SharePriceChart';
import { UsdcMigrationBanner } from '../migration/UsdcMigrationBanner';
import { OwnerActionsPanel } from './owner/OwnerActionsPanel';
import { useVaultInfo, useVaultRole, useVaultMarketsFromApi } from '../../lib/hooks/useVault';
import { useSharePriceHistory } from '../../lib/hooks/useRiskMonitoring';
import { formatTokenAmount, formatWadPercent, formatDuration, truncateAddress, calcSharePrice } from '../../lib/utils/format';
import { getChainConfig } from '../../config/chains';
import { getEmergencyRole } from '../../types';
import type { RiskAlert } from '../../lib/risk/riskTypes';

interface OverviewTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function OverviewTab({ chainId, vaultAddress }: OverviewTabProps) {
  const chainConfig = getChainConfig(chainId);
  const { data: vault, isLoading, error } = useVaultInfo(chainId, vaultAddress);
  const role = useVaultRole(chainId, vaultAddress);
  const { data: markets } = useVaultMarketsFromApi(chainId, vaultAddress);
  const { data: sharePriceHistory } = useSharePriceHistory(chainId, vaultAddress);

  const oracleAddresses = useMemo(() => {
    if (!markets) return [];
    return markets.map((m) => m.params.oracle);
  }, [markets]);

  const oracleMarketLabels = useMemo(() => {
    if (!markets) return undefined;
    const map = new Map<Address, string>();
    for (const m of markets) {
      map.set(m.params.oracle, `${m.collateralToken.symbol}/${m.loanToken.symbol}`);
    }
    return map;
  }, [markets]);

  // Build risk alerts from market data (must be before conditional return — Rules of Hooks)
  const riskAlerts = useMemo<RiskAlert[]>(() => {
    if (!markets) return [];
    const now = Date.now();
    const alerts: RiskAlert[] = [];
    for (const m of markets) {
      if (m.utilization > 0.9) {
        alerts.push({
          id: `util-crit-${m.id}`,
          severity: 'critical',
          type: 'utilization_high',
          title: `${m.collateralToken.symbol}/${m.loanToken.symbol} utilization ${(m.utilization * 100).toFixed(0)}%`,
          description: 'Above 90% — withdrawals may be delayed',
          chainId,
          marketId: m.id,
          timestamp: now,
        });
      } else if (m.utilization > 0.8) {
        alerts.push({
          id: `util-warn-${m.id}`,
          severity: 'warning',
          type: 'utilization_high',
          title: `${m.collateralToken.symbol}/${m.loanToken.symbol} utilization ${(m.utilization * 100).toFixed(0)}%`,
          description: 'Above 80% — monitor closely',
          chainId,
          marketId: m.id,
          timestamp: now,
        });
      }
    }
    return alerts.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });
  }, [markets, chainId]);

  if (isLoading || !vault) {
    return <div className="animate-shimmer space-y-4"><div className="h-24 bg-bg-hover" /><div className="h-24 bg-bg-hover" /></div>;
  }

  if (error && !vault) {
    return (
      <Card className="py-8 text-center">
        <p className="text-danger text-sm">Failed to load vault overview</p>
        <p className="text-text-tertiary text-xs mt-1">
          {error instanceof Error ? error.message : 'Data fetch failed — try refreshing.'}
        </p>
      </Card>
    );
  }

  const sharePrice = calcSharePrice(vault.totalAssets, vault.totalSupply, vault.assetInfo.decimals);
  const isZeroAddr = (a: string) => a === '0x0000000000000000000000000000000000000000';

  return (
    <div className="space-y-4">
      {/* USDC Migration Banner (SEI only) */}
      <UsdcMigrationBanner chainId={chainId} vaultAddress={vaultAddress} vaultAsset={vault.asset} />

      {/* Risk Alerts */}
      <RiskAlertBanner alerts={riskAlerts} />

      {/* Vault Identity */}
      <Card>
        <CardHeader>
          <CardTitle>Vault Parameters</CardTitle>
          <div className="flex gap-2">
            <Badge variant="info">{chainConfig?.name}</Badge>
            <Badge>{vault.version.toUpperCase()}</Badge>
          </div>
        </CardHeader>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoItem label="Name" value={vault.name} />
          <InfoItem label="Symbol" value={vault.symbol} />
          <InfoItem label="Asset" value={vault.assetInfo.symbol} />
          <InfoItem label="Decimals" value={vault.assetInfo.decimals.toString()} />
          <InfoItem label="Performance Fee" value={formatWadPercent(vault.fee)} />
          {vault.version === 'v2' && vault.managementFee > 0n && (
            <InfoItem label="Management Fee" value={formatWadPercent(vault.managementFee)} />
          )}
          <InfoItem
            label={vault.version === 'v2' ? 'Timelock' : 'Timelock'}
            value={vault.version === 'v2' ? 'Per-function' : formatDuration(vault.timelock)}
          />
          <div>
            <span className="text-[10px] text-text-tertiary uppercase">Share Price</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm font-mono text-text-primary">{sharePrice.toFixed(6)}</span>
              {sharePriceHistory && sharePriceHistory.length >= 2 && (
                <SharePriceChart history={sharePriceHistory} height={24} width={80} />
              )}
            </div>
          </div>
          <InfoItem
            label="Vault Address"
            value={truncateAddress(vaultAddress)}
            href={`${chainConfig?.blockExplorer}/address/${vaultAddress}`}
          />
        </div>
      </Card>

      {/* ERC-4626 Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>ERC-4626 State</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <InfoItem
            label="Total Assets"
            value={`${formatTokenAmount(vault.totalAssets, vault.assetInfo.decimals)} ${vault.assetInfo.symbol}`}
          />
          <InfoItem
            label="Total Supply"
            value={`${formatTokenAmount(vault.totalSupply, 18)} shares`}
          />
          <InfoItem
            label="Last Total Assets"
            value={`${formatTokenAmount(vault.lastTotalAssets, vault.assetInfo.decimals)} ${vault.assetInfo.symbol}`}
          />
        </div>
      </Card>

      {/* Roles */}
      <Card>
        <CardHeader>
          <CardTitle>Role Assignments</CardTitle>
          {role.isOwner && <Badge variant="purple">You are Owner</Badge>}
        </CardHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RoleItem
            label="Owner"
            address={vault.owner}
            explorerUrl={chainConfig?.blockExplorer}
            isConnected={role.isOwner}
          />
          <RoleItem
            label="Curator"
            address={vault.curator}
            explorerUrl={chainConfig?.blockExplorer}
            isConnected={role.isCurator}
            isEmpty={isZeroAddr(vault.curator)}
          />
          {vault.version === 'v1' ? (
            <RoleItem
              label="Guardian"
              address={getEmergencyRole(vault)}
              explorerUrl={chainConfig?.blockExplorer}
              isConnected={role.isEmergencyRole}
              isEmpty={isZeroAddr(getEmergencyRole(vault))}
            />
          ) : (
            <div>
              <span className="text-xs text-text-tertiary">Sentinel</span>
              <p className="text-sm text-text-tertiary mt-0.5">Per-address (isSentinel)</p>
            </div>
          )}
          <div>
            <span className="text-xs text-text-tertiary">Fee Recipient</span>
            <p className="text-sm font-mono text-text-primary mt-0.5">
              {isZeroAddr(vault.feeRecipient) ? (
                <span className="text-text-tertiary">Not set</span>
              ) : (
                truncateAddress(vault.feeRecipient)
              )}
            </p>
          </div>
        </div>
      </Card>

      {/* Oracle Health Dashboard */}
      {oracleAddresses.length > 0 && (
        <VaultOracleDashboard
          chainId={chainId}
          oracleAddresses={oracleAddresses}
          marketLabels={oracleMarketLabels}
        />
      )}

      {/* Morpho Blue Reference */}
      <Card>
        <CardHeader>
          <CardTitle>Morpho Blue</CardTitle>
        </CardHeader>
        <InfoItem
          label="Morpho Blue Address"
          value={truncateAddress(vault.morphoBlue)}
          href={`${chainConfig?.blockExplorer}/address/${vault.morphoBlue}`}
        />
      </Card>

      {/* Owner Management Panels (V1 only, owner only) */}
      {vault.version === 'v1' && (
        <OwnerActionsPanel
          chainId={chainId}
          vaultAddress={vaultAddress}
          isOwner={role.isOwner}
        />
      )}
    </div>
  );
}

function InfoItem({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div>
      <span className="text-[10px] text-text-tertiary uppercase">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-sm font-mono text-info hover:text-info/80 mt-0.5"
        >
          {value}
        </a>
      ) : (
        <p className="text-sm font-mono text-text-primary mt-0.5">{value}</p>
      )}
    </div>
  );
}

function RoleItem({
  label,
  address,
  explorerUrl,
  isConnected,
  isEmpty,
}: {
  label: string;
  address: string;
  explorerUrl?: string;
  isConnected: boolean;
  isEmpty?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <span className="text-xs text-text-tertiary">{label}</span>
        {isEmpty ? (
          <p className="text-sm text-text-tertiary mt-0.5">Not assigned</p>
        ) : (
          <a
            href={explorerUrl ? `${explorerUrl}/address/${address}` : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-mono text-text-primary hover:text-info mt-0.5"
          >
            {truncateAddress(address)}
          </a>
        )}
      </div>
      {isConnected && <Badge variant="success">You</Badge>}
    </div>
  );
}
