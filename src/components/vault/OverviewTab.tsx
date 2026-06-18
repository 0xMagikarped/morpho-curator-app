import { useMemo, useEffect } from 'react';
import type { Address } from 'viem';
import { useAccount, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { useGuardedWriteContract } from '../../hooks/useGuardedWriteContract';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { AddressDisplay } from '../ui/AddressDisplay';
import { VaultOracleDashboard } from '../oracle/VaultOracleDashboard';
import { RiskAlertBanner } from '../risk/RiskAlertBanner';
import { SharePriceChart } from '../risk/SharePriceChart';
import { UsdcMigrationBanner } from '../migration/UsdcMigrationBanner';
import { RegistryAlertBanner } from './RegistryAlertBanner';
import { PendingCapsBanner } from './PendingCapsBanner';
import { OwnerActionsPanel } from './owner/OwnerActionsPanel';
import { useVaultPendingState } from './owner/useVaultPendingState';
import { useVaultInfo, useVaultRole, useVaultMarketsFromApi, useVaultAllocators } from '../../lib/hooks/useVault';
import { useSharePriceHistory } from '../../lib/hooks/useRiskMonitoring';
import { formatTokenAmount, formatWadPercent, formatDuration, truncateAddress, calcSharePrice, formatApyDisplay, getApyColorClass } from '../../lib/utils/format';
import { getChainConfig } from '../../config/chains';
import { getEmergencyRole } from '../../types';
import { metaMorphoV1Abi, metaMorphoV2Abi } from '../../lib/contracts/abis';
import type { RiskAlert } from '../../lib/risk/riskTypes';
import type { VaultInfo } from '../../types';

interface OverviewTabProps {
  chainId: number;
  vaultAddress: Address;
}

export function OverviewTab({ chainId, vaultAddress }: OverviewTabProps) {
  const chainConfig = getChainConfig(chainId);
  const { address: userAddress } = useAccount();
  const { data: vault, isLoading, error } = useVaultInfo(chainId, vaultAddress);
  const role = useVaultRole(chainId, vaultAddress);
  const { data: markets } = useVaultMarketsFromApi(chainId, vaultAddress);
  const { data: sharePriceHistory } = useSharePriceHistory(chainId, vaultAddress);
  const { data: allocators } = useVaultAllocators(chainId, vaultAddress);
  const { data: pendingState } = useVaultPendingState(chainId, vaultAddress);

  // Live RPC read for pendingOwner (Ownable2Step) — works for both V1 and V2
  const { data: pendingOwner, refetch: refetchPendingOwner } = useReadContract({
    address: vaultAddress,
    abi: metaMorphoV1Abi,
    functionName: 'pendingOwner',
    chainId,
  });

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
      if (m.utilization > 0.91) {
        alerts.push({
          id: `util-crit-${m.id}`,
          severity: 'critical',
          type: 'utilization_high',
          title: `${m.collateralToken.symbol}/${m.loanToken.symbol} utilization ${(m.utilization * 100).toFixed(0)}%`,
          description: 'Above 91% — withdrawals may be constrained',
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

      {/* V2 Registry Alert */}
      <RegistryAlertBanner vaultAddress={vaultAddress} chainId={chainId} isV2Vault={vault.version === 'v2'} />

      {/* V1 pendingCap submissions (matters on SEI where the Caps tab is
          easy to overlook; renders nothing when no pending caps exist). */}
      <PendingCapsBanner
        chainId={chainId}
        vaultAddress={vaultAddress}
        vaultAsset={vault.asset}
        assetSymbol={vault.assetInfo.symbol}
        assetDecimals={vault.assetInfo.decimals}
        isV1={vault.version === 'v1'}
      />

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
          <div>
            <span className="text-[10px] text-text-tertiary uppercase">Asset</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm font-mono text-text-primary">{vault.assetInfo.symbol}</span>
              <AddressDisplay address={vault.asset} chainId={chainId} className="text-[11px]" />
            </div>
          </div>
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
          <div>
            <span className="text-[10px] text-text-tertiary uppercase">Vault Address</span>
            <div className="mt-0.5 text-sm">
              <AddressDisplay address={vaultAddress} chainId={chainId} />
            </div>
          </div>
        </div>
      </Card>

      {/* Vault Performance */}
      <VaultPerformanceCard vault={vault} />

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
          {pendingOwner && !isZeroAddr(pendingOwner) && (
            <PendingOwnerItem
              pendingOwner={pendingOwner}
              explorerUrl={chainConfig?.blockExplorer}
              chainId={chainId}
              vaultAddress={vaultAddress}
              vaultVersion={vault.version}
              userAddress={userAddress}
              onAccepted={refetchPendingOwner}
            />
          )}
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
          {vault.version === 'v1' && (
            <div>
              <span className="text-xs text-text-tertiary">Timelock</span>
              <p className="text-sm font-mono text-text-primary mt-0.5">
                {vault.timelock === 0n ? '0 (no delay)' : formatDuration(vault.timelock)}
              </p>
            </div>
          )}
          {vault.version === 'v1' && (
            <div>
              <span className="text-xs text-text-tertiary">Pending Timelock</span>
              {pendingState?.pendingTimelock ? (
                <div>
                  <p className="text-sm font-mono text-warning mt-0.5">
                    {formatDuration(pendingState.pendingTimelock.value)}
                  </p>
                  <p className="text-xs text-text-tertiary">
                    {(() => {
                      const now = Math.floor(Date.now() / 1000);
                      const remaining = Number(pendingState.pendingTimelock.validAt) - now;
                      return remaining <= 0
                        ? 'Ready to execute'
                        : `Executable in ${formatDuration(remaining)}`;
                    })()}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-text-tertiary mt-0.5">None</p>
              )}
            </div>
          )}
        </div>

        {/* Allocators + Public Allocator Status */}
        <div className="border-t border-border-subtle pt-3 mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-text-tertiary">Allocators</span>
            {(() => {
              const paAddr = chainConfig?.periphery?.publicAllocator;
              const paEnabled = paAddr && allocators?.some(
                (a) => a.toLowerCase() === paAddr.toLowerCase(),
              );
              return (
                <span className={`inline-flex items-center gap-1 text-[10px] ${paEnabled ? 'text-success' : 'text-text-tertiary'}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${paEnabled ? 'bg-success' : 'bg-text-tertiary/40'}`} />
                  Public Allocator {paEnabled ? 'Enabled' : paAddr ? 'Disabled' : 'N/A'}
                </span>
              );
            })()}
          </div>
          {allocators && allocators.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {allocators.map((addr) => {
                const isPa = chainConfig?.periphery?.publicAllocator?.toLowerCase() === addr.toLowerCase();
                return (
                  <span key={addr} className="inline-flex items-center gap-1 text-sm font-mono text-text-primary">
                    {truncateAddress(addr)}
                    {isPa && <Badge variant="info" className="text-[9px]">PA</Badge>}
                    {userAddress && addr.toLowerCase() === userAddress.toLowerCase() && (
                      <Badge variant="success" className="text-[9px]">You</Badge>
                    )}
                  </span>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary">None</p>
          )}
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

// ============================================================
// Fee Revenue Estimates
// ============================================================

interface FeeEstimates {
  dailyFeeTokens: number;
  monthlyFeeTokens: number;
  annualFeeTokens: number;
  dailyFeeUsd: number | null;
  monthlyFeeUsd: number | null;
  annualFeeUsd: number | null;
}

function computeFeeEstimates(
  totalAssets: bigint,
  totalAssetsUsd: number | null,
  nativeApy: number,
  performanceFee: number,
  tokenDecimals: number,
): FeeEstimates {
  const tvl = Number(totalAssets) / 10 ** tokenDecimals;
  const annualYield = tvl * nativeApy;
  const annualFee = annualYield * performanceFee;

  const annualFeeUsd = totalAssetsUsd != null ? totalAssetsUsd * nativeApy * performanceFee : null;

  return {
    dailyFeeTokens: annualFee / 365,
    monthlyFeeTokens: annualFee / 12,
    annualFeeTokens: annualFee,
    dailyFeeUsd: annualFeeUsd != null ? annualFeeUsd / 365 : null,
    monthlyFeeUsd: annualFeeUsd != null ? annualFeeUsd / 12 : null,
    annualFeeUsd,
  };
}

function formatFeeAmount(amount: number): string {
  if (amount < 0.01 && amount > 0) return amount.toExponential(2);
  if (amount < 10) return amount.toFixed(4);
  if (amount < 1000) return amount.toFixed(2);
  return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// ============================================================
// Share Price Sparkline (SVG)
// ============================================================

function SharePriceSparkline({ data }: { data: Array<{ x: number; y: number }> }) {
  if (data.length < 2) return null;

  const values = data.map((d) => d.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const width = 400;
  const height = 48;
  const padding = 2;

  const points = values
    .map((v, i) => {
      const x = padding + (i / (values.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((v - min) / range) * (height - 2 * padding);
      return `${x},${y}`;
    })
    .join(' ');

  const isPositive = values[values.length - 1] >= values[0];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-12"
      role="img"
      aria-label={`Share price trend over 30 days, ${isPositive ? 'increasing' : 'decreasing'}`}
    >
      <polyline
        points={points}
        fill="none"
        stroke={isPositive ? 'var(--color-success)' : 'var(--color-danger)'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ============================================================
// Vault Performance Card
// ============================================================

function VaultPerformanceCard({ vault }: { vault: VaultInfo & { assetInfo: { symbol: string; decimals: number } } }) {
  const feeDecimal = Number(vault.fee) / 1e18;
  const symbol = vault.assetInfo.symbol;
  const decimals = vault.assetInfo.decimals;

  const feeEstimates = useMemo(() => {
    if (vault.apy == null || feeDecimal === 0) return null;
    return computeFeeEstimates(
      vault.totalAssets,
      vault.totalAssetsUsd,
      vault.apy,
      feeDecimal,
      decimals,
    );
  }, [vault.apy, vault.totalAssets, vault.totalAssetsUsd, feeDecimal, decimals]);

  const hasApy = vault.apy != null || vault.netApy != null;
  const isZeroFee = feeDecimal === 0;

  // Compute P&L from totalAssets - lastTotalAssets (accumulated yield proxy)
  const cumulativePnl = vault.pnl;
  const cumulativePnlUsd = vault.pnlUsd;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Vault Performance</CardTitle>
        {!hasApy && <Badge>RPC — APY unavailable</Badge>}
      </CardHeader>

      {/* Row 1: APY + Fee + P&L */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <span className="text-[10px] text-text-tertiary uppercase">Net APY</span>
          <p className={`text-lg font-mono font-medium mt-0.5 ${getApyColorClass(vault.netApy)}`}>
            {formatApyDisplay(vault.netApy)}
          </p>
        </div>
        <div>
          <span className="text-[10px] text-text-tertiary uppercase">Native APY</span>
          <p className="text-lg font-mono text-text-primary mt-0.5">
            {formatApyDisplay(vault.apy)}
          </p>
        </div>
        <div>
          <span className="text-[10px] text-text-tertiary uppercase">Perf. Fee</span>
          <p className="text-lg font-mono text-text-primary mt-0.5">
            {formatWadPercent(vault.fee)}
          </p>
        </div>
        {vault.version === 'v2' && vault.managementFee > 0n && (
          <div>
            <span className="text-[10px] text-text-tertiary uppercase">Mgmt. Fee</span>
            <p className="text-lg font-mono text-text-primary mt-0.5">
              {formatWadPercent(vault.managementFee)}
            </p>
          </div>
        )}
        {cumulativePnl != null && (
          <div>
            <span className="text-[10px] text-text-tertiary uppercase">Total P&L</span>
            <p className={`text-lg font-mono font-medium mt-0.5 ${cumulativePnl > 0n ? 'text-success' : cumulativePnl < 0n ? 'text-danger' : 'text-text-primary'}`}>
              {cumulativePnl > 0n ? '+' : ''}{formatTokenAmount(cumulativePnl, decimals)} {symbol}
            </p>
            {cumulativePnlUsd != null && (
              <p className="text-xs font-mono text-text-tertiary">
                (~${cumulativePnlUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })})
              </p>
            )}
          </div>
        )}
      </div>

      {/* Row 2: Fee Revenue Estimates */}
      {feeEstimates && !isZeroFee && (
        <div className="border-t border-border-subtle pt-4 mt-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <span className="text-[10px] text-text-tertiary uppercase">Est. Daily Fees</span>
              <p className="text-sm font-mono text-text-primary mt-0.5">
                ~{formatFeeAmount(feeEstimates.dailyFeeTokens)} {symbol}
              </p>
              {feeEstimates.dailyFeeUsd != null && (
                <p className="text-xs font-mono text-text-tertiary">
                  (~${formatFeeAmount(feeEstimates.dailyFeeUsd)})
                </p>
              )}
            </div>
            <div>
              <span className="text-[10px] text-text-tertiary uppercase">Est. Monthly Fees</span>
              <p className="text-sm font-mono text-text-primary mt-0.5">
                ~{formatFeeAmount(feeEstimates.monthlyFeeTokens)} {symbol}
              </p>
              {feeEstimates.monthlyFeeUsd != null && (
                <p className="text-xs font-mono text-text-tertiary">
                  (~${formatFeeAmount(feeEstimates.monthlyFeeUsd)})
                </p>
              )}
            </div>
            <div>
              <span className="text-[10px] text-text-tertiary uppercase">Est. Annual Fees</span>
              <p className="text-sm font-mono text-text-primary mt-0.5">
                ~{formatFeeAmount(feeEstimates.annualFeeTokens)} {symbol}
              </p>
              {feeEstimates.annualFeeUsd != null && (
                <p className="text-xs font-mono text-text-tertiary">
                  (~${formatFeeAmount(feeEstimates.annualFeeUsd)})
                </p>
              )}
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary mt-2">
            * Estimates based on current APY x TVL x performance fee. Actual fees depend on realized yield.
          </p>
        </div>
      )}
      {isZeroFee && hasApy && (
        <div className="border-t border-border-subtle pt-3 mt-4">
          <p className="text-xs text-text-tertiary">No performance fee — all yield accrues to depositors.</p>
        </div>
      )}

      {/* Row 3: Share Price Sparkline (from API historical data) */}
      {vault.historicalSharePrice && vault.historicalSharePrice.length >= 2 && (
        <div className="border-t border-border-subtle pt-4 mt-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[10px] text-text-tertiary uppercase">Share Price (30d)</span>
            <span className="text-sm font-mono text-text-primary">
              {calcSharePrice(vault.totalAssets, vault.totalSupply, decimals).toFixed(6)}
            </span>
          </div>
          <SharePriceSparkline data={vault.historicalSharePrice} />
        </div>
      )}
    </Card>
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

function PendingOwnerItem({
  pendingOwner,
  explorerUrl,
  chainId,
  vaultAddress,
  vaultVersion,
  userAddress,
  onAccepted,
}: {
  pendingOwner: string;
  explorerUrl?: string;
  chainId: number;
  vaultAddress: Address;
  vaultVersion: 'v1' | 'v2';
  userAddress?: Address;
  onAccepted: () => void;
}) {
  const isPendingOwner = userAddress && pendingOwner.toLowerCase() === userAddress.toLowerCase();
  const queryClient = useQueryClient();
  const abi = vaultVersion === 'v2' ? metaMorphoV2Abi : metaMorphoV1Abi;
  const { writeContract, data: hash, isPending, error: txError } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      queryClient.invalidateQueries({ queryKey: ['vault-full-data', chainId, vaultAddress] });
      onAccepted();
    }
  }, [isSuccess, queryClient, chainId, vaultAddress, onAccepted]);

  const handleAccept = () => {
    writeContract({
      address: vaultAddress,
      abi,
      functionName: 'acceptOwnership',
      chainId,
    });
  };

  const isBusy = isPending || isConfirming;

  return (
    <div className="flex items-center justify-between py-1">
      <div>
        <span className="text-xs text-text-tertiary flex items-center gap-1.5">
          Pending Owner
          <Badge variant="warning" className="text-[9px]">Awaiting acceptance</Badge>
        </span>
        <a
          href={explorerUrl ? `${explorerUrl}/address/${pendingOwner}` : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-sm font-mono text-text-primary hover:text-info mt-0.5"
        >
          {truncateAddress(pendingOwner)}
        </a>
      </div>
      <div className="flex items-center gap-2">
        {isPendingOwner && <Badge variant="success">You</Badge>}
        {isPendingOwner && (
          <Button
            size="sm"
            onClick={handleAccept}
            disabled={isBusy}
            loading={isBusy}
          >
            {isPending ? 'Confirm...' : isConfirming ? 'Confirming...' : 'Accept Ownership'}
          </Button>
        )}
      </div>
      {txError && (
        <p className="text-[10px] text-danger mt-1 max-h-20 overflow-y-auto">{(txError as Error).message}</p>
      )}
    </div>
  );
}
