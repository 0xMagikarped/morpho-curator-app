import { useState, useEffect, useMemo, useCallback } from 'react';
import { isHex, type Address } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { useVaultWrite } from '../../hooks/useVaultWrite';
import { Clock, CheckCircle, Circle, ArrowRight, AlertTriangle, Plus } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ProgressBar } from '../ui/ProgressBar';
import { useVaultInfo, useVaultAllocation, useVaultMarketsFromApi, useVaultRole, useVaultPendingActions, useDiscoveredMarketStatuses } from '../../lib/hooks/useVault';
import { useVaultPermissions } from '../../hooks/useVaultPermissions';
import { useMarketScanner } from '../../lib/hooks/useMarketScanner';
import { fetchMarketParams, fetchTokenInfo } from '../../lib/data/rpcClient';
import { formatTokenAmount, formatCountdown, parseTokenAmount, formatPercent, formatDuration } from '../../lib/utils/format';
import { useChainGuard } from '../../lib/hooks/useChainGuard';
import { vaultKeys } from '../../lib/queryKeys';
import { MarketTypeBadge } from '../ui/MarketTypeBadge';
import type { MarketInfo, PendingAction, PendingCap } from '../../types';
import type { MarketRecord } from '../../lib/indexer/indexedDB';

interface CapsTabProps {
  chainId: number;
  vaultAddress: Address;
}

type MarketStatus = 'available' | 'pending' | 'enabled' | 'in_supply_queue';

interface MarketLifecycleItem {
  marketId: string;
  status: MarketStatus;
  label: string;
  collateralSymbol: string;
  loanSymbol: string;
  irmAddress: `0x${string}`;
  lltv: number;
  supplyCap: bigint;
  supplyAssets: bigint;
  capUsedPct: number;
  pendingAction?: PendingAction;
  /** Pending cap from on-chain read (for discovered markets) */
  discoveredPendingCap?: PendingCap;
  /** Set when from discovered markets — needed for submitCap/acceptCap with market params */
  discoveredMarket?: MarketRecord;
  /** Set when from vault market list — existing vault market */
  vaultMarket?: MarketInfo;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const STATUS_CONFIG: Record<MarketStatus, { label: string; variant: 'default' | 'warning' | 'info' | 'success'; icon: typeof Circle }> = {
  available: { label: 'Available', variant: 'default', icon: Circle },
  pending: { label: 'Pending', variant: 'warning', icon: Clock },
  enabled: { label: 'Enabled', variant: 'info', icon: CheckCircle },
  in_supply_queue: { label: 'In Queue', variant: 'success', icon: ArrowRight },
};

export function CapsTab({ chainId, vaultAddress }: CapsTabProps) {
  const queryClient = useQueryClient();
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const { isMismatch, requestSwitch } = useChainGuard(chainId);
  const role = useVaultRole(chainId, vaultAddress);
  const permissions = useVaultPermissions(chainId, vaultAddress);
  const { data: allocation, isLoading: allocLoading, error: allocError } = useVaultAllocation(chainId, vaultAddress);
  const { data: markets, isLoading: marketsLoading, error: marketsError } = useVaultMarketsFromApi(chainId, vaultAddress);
  const { data: allChainMarkets, error: scannerError } = useMarketScanner(chainId);
  const marketIds = useMemo(
    () => allocation
      ? [...new Set([...allocation.supplyQueue, ...allocation.withdrawQueue])]
      : undefined,
    [allocation],
  );
  const { data: pendingActions } = useVaultPendingActions(chainId, vaultAddress, marketIds);
  const { submit, mode, isPending, isConfirming, isSuccess, disabled: writeDisabled, disabledTooltip } =
    useVaultWrite(chainId, vaultAddress);
  const isMoolah = mode === 'timelocked';

  // Compute discovered market IDs that are NOT already in vault queues
  const vaultAssetLower = vault?.asset?.toLowerCase();
  const existingMarketIds = useMemo(() => new Set(marketIds ?? []), [marketIds]);
  const discoveredMarketIds = useMemo(() => {
    if (!allChainMarkets || !vaultAssetLower) return [];
    return allChainMarkets
      .filter((m) => m.loanToken.toLowerCase() === vaultAssetLower && !existingMarketIds.has(m.marketId))
      .map((m) => m.marketId);
  }, [allChainMarkets, vaultAssetLower, existingMarketIds]);

  // Read on-chain config + pendingCap for discovered markets
  const { data: discoveredStatuses } = useDiscoveredMarketStatuses(chainId, vaultAddress, discoveredMarketIds);

  const [expandedMarket, setExpandedMarket] = useState<string | null>(null);
  const [newCapValue, setNewCapValue] = useState('');
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  const [statusFilter, setStatusFilter] = useState<MarketStatus | 'all'>('all');

  // Manual "Add market by ID" — lets the curator paste a bytes32 market
  // ID instead of relying on the scanner to discover it.
  const [manualMarketId, setManualMarketId] = useState('');
  const [manualMarketLoading, setManualMarketLoading] = useState(false);
  const [manualMarketError, setManualMarketError] = useState<string | null>(null);
  const [manualMarkets, setManualMarkets] = useState<MarketLifecycleItem[]>([]);

  const handleAddManualMarket = useCallback(async () => {
    const id = manualMarketId.trim();
    if (!id || !isHex(id) || id.length !== 66) {
      setManualMarketError('Enter a valid 32-byte market ID (0x…, 66 chars).');
      return;
    }
    if (!chainId) return;
    // Already in the list?
    if (lifecycleItems.some((li) => li.marketId.toLowerCase() === id.toLowerCase()) ||
        manualMarkets.some((m) => m.marketId.toLowerCase() === id.toLowerCase())) {
      setManualMarketError('Market already in the list.');
      return;
    }
    setManualMarketError(null);
    setManualMarketLoading(true);
    try {
      const params = await fetchMarketParams(chainId, id as `0x${string}`);
      const ZERO = '0x0000000000000000000000000000000000000000' as Address;
      if (params.loanToken === ZERO) {
        setManualMarketError('Market ID not found on-chain (loanToken is zero).');
        setManualMarketLoading(false);
        return;
      }
      const [loanToken, collateralToken] = await Promise.all([
        fetchTokenInfo(chainId, params.loanToken).catch(() => ({ symbol: '???', decimals: 18, name: '???' })),
        fetchTokenInfo(chainId, params.collateralToken).catch(() => ({ symbol: '???', decimals: 18, name: '???' })),
      ]);
      setManualMarkets((prev) => [
        ...prev,
        {
          marketId: id,
          status: 'available' as MarketStatus,
          label: `${collateralToken.symbol} / ${loanToken.symbol}`,
          collateralSymbol: collateralToken.symbol,
          loanSymbol: loanToken.symbol,
          irmAddress: params.irm as `0x${string}`,
          lltv: Number(params.lltv) / 1e18,
          supplyCap: 0n,
          supplyAssets: 0n,
          capUsedPct: 0,
          discoveredMarket: {
            chainId,
            marketId: id as `0x${string}`,
            loanToken: params.loanToken,
            collateralToken: params.collateralToken,
            oracle: params.oracle,
            irm: params.irm,
            lltv: params.lltv.toString(),
            discoveredAtBlock: 0,
            loanTokenSymbol: loanToken.symbol,
            loanTokenDecimals: loanToken.decimals,
            collateralTokenSymbol: collateralToken.symbol,
            collateralTokenDecimals: collateralToken.decimals,
          } as MarketRecord,
        },
      ]);
      setManualMarketId('');
    } catch (err) {
      setManualMarketError(
        err instanceof Error ? err.message : 'Failed to read market params from on-chain.',
      );
    }
    setManualMarketLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualMarketId, chainId, manualMarkets]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowSeconds(BigInt(Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Invalidate vault + discovered statuses when tx confirms
  useEffect(() => {
    if (isSuccess && chainId && vaultAddress) {
      queryClient.invalidateQueries({ queryKey: vaultKeys.fullData(chainId, vaultAddress) });
      queryClient.invalidateQueries({ queryKey: vaultKeys.pending(chainId, vaultAddress) });
      queryClient.invalidateQueries({ queryKey: vaultKeys.discoveredStatuses(chainId, vaultAddress) });
    }
  }, [isSuccess, chainId, vaultAddress, queryClient]);

  const pendingCaps = useMemo(
    () => pendingActions?.filter((a) => a.type === 'cap') ?? [],
    [pendingActions],
  );
  const pendingCapsByMarket = useMemo(() => {
    const map = new Map<string, PendingAction>();
    for (const pc of pendingCaps) {
      if (pc.marketId) map.set(pc.marketId, pc);
    }
    return map;
  }, [pendingCaps]);

  const decimals = vault?.assetInfo.decimals ?? 18;

  // Index discovered statuses by marketId for fast lookup
  const discoveredStatusMap = useMemo(() => {
    const map = new Map<string, NonNullable<typeof discoveredStatuses>[number]>();
    if (discoveredStatuses) {
      for (const ds of discoveredStatuses) map.set(ds.marketId, ds);
    }
    return map;
  }, [discoveredStatuses]);

  // Build unified market lifecycle list
  const lifecycleItems: MarketLifecycleItem[] = useMemo(() => {
    const items: MarketLifecycleItem[] = [];
    const supplyQueueSet = new Set(allocation?.supplyQueue ?? []);

    // 1. Vault markets (enabled or in supply queue)
    if (markets && allocation) {
      for (const market of markets) {
        const alloc = allocation.allocations.find((a) => a.marketId === market.id);
        const inSupplyQueue = supplyQueueSet.has(market.id);
        const hasPending = pendingCapsByMarket.has(market.id);
        const supplyCap = alloc?.supplyCap ?? 0n;
        const supplyAssets = alloc?.supplyAssets ?? 0n;
        const capUsedPct = supplyCap > 0n
          ? Number((supplyAssets * 10000n) / supplyCap) / 100
          : 0;

        let status: MarketStatus;
        if (hasPending) {
          status = 'pending';
        } else if (inSupplyQueue) {
          status = 'in_supply_queue';
        } else {
          status = 'enabled';
        }

        const lltv = Number(market.params.lltv) / 1e18;

        items.push({
          marketId: market.id,
          status,
          label: `${market.collateralToken.symbol} / ${market.loanToken.symbol}`,
          collateralSymbol: market.collateralToken.symbol,
          loanSymbol: market.loanToken.symbol,
          irmAddress: market.params.irm,
          lltv,
          supplyCap,
          supplyAssets,
          capUsedPct,
          pendingAction: pendingCapsByMarket.get(market.id),
          vaultMarket: market,
        });
      }
    }

    // 2. Discovered markets not yet in vault queues
    if (allChainMarkets && vaultAssetLower) {
      for (const m of allChainMarkets) {
        if (m.loanToken.toLowerCase() !== vaultAssetLower) continue;
        if (existingMarketIds.has(m.marketId)) continue;

        const isIdle = m.collateralToken.toLowerCase() === ZERO_ADDRESS && (m.lltv === '0' || m.lltv === '0n');
        const lltv = Number(m.lltv) / 1e18;

        // Check on-chain state for this discovered market
        const onChain = discoveredStatusMap.get(m.marketId);
        let status: MarketStatus = 'available';
        let supplyCap = 0n;
        let discoveredPendingCap: PendingCap | undefined;

        if (onChain) {
          if (onChain.pendingCap) {
            // Has a pending cap → PENDING
            status = 'pending';
            discoveredPendingCap = onChain.pendingCap;
          } else if (onChain.config.enabled || onChain.config.cap > 0n) {
            // Cap accepted but not in supply queue yet → ENABLED
            status = 'enabled';
            supplyCap = onChain.config.cap;
          }
        }

        const collateralLabel = isIdle ? 'IDLE' : (m.collateralTokenSymbol || m.collateralToken.slice(0, 10));
        const loanLabel = m.loanTokenSymbol || m.loanToken.slice(0, 10);

        items.push({
          marketId: m.marketId,
          status,
          label: `${collateralLabel} / ${loanLabel}`,
          collateralSymbol: collateralLabel,
          loanSymbol: loanLabel,
          irmAddress: m.irm as `0x${string}`,
          lltv,
          supplyCap,
          supplyAssets: 0n,
          capUsedPct: 0,
          discoveredMarket: m,
          discoveredPendingCap,
        });
      }
    }

    return items;
  }, [markets, allocation, allChainMarkets, vaultAssetLower, existingMarketIds, pendingCapsByMarket, discoveredStatusMap]);

  // Merge manually-added markets (by ID) with scanner-discovered ones.
  // Dedup by marketId so a manual add that the scanner later discovers
  // doesn't appear twice.
  const allItems = useMemo(() => {
    const ids = new Set(lifecycleItems.map((li) => li.marketId.toLowerCase()));
    const unique = manualMarkets.filter((m) => !ids.has(m.marketId.toLowerCase()));
    return [...lifecycleItems, ...unique];
  }, [lifecycleItems, manualMarkets]);

  const filteredItems = statusFilter === 'all'
    ? allItems
    : allItems.filter((item) => item.status === statusFilter);

  const statusCounts = useMemo(() => {
    const counts: Record<MarketStatus, number> = { available: 0, pending: 0, enabled: 0, in_supply_queue: 0 };
    for (const item of allItems) counts[item.status]++;
    return counts;
  }, [allItems]);

  // ---- Handlers ----

  const handleSubmitCap = (item: MarketLifecycleItem) => {
    if (!newCapValue) return;
    const capWei = parseTokenAmount(newCapValue, decimals);

    const marketParams =
      item.vaultMarket?.params ??
      (item.discoveredMarket && {
        loanToken: item.discoveredMarket.loanToken as Address,
        collateralToken: item.discoveredMarket.collateralToken as Address,
        oracle: item.discoveredMarket.oracle as Address,
        irm: item.discoveredMarket.irm as Address,
        lltv: BigInt(item.discoveredMarket.lltv),
      });
    if (!marketParams) return;
    void submit({ kind: 'setCap', marketParams, newSupplyCap: capWei });
    setNewCapValue('');
  };

  const handleAcceptCap = (item: MarketLifecycleItem) => {
    const marketParams =
      item.vaultMarket?.params ??
      (item.discoveredMarket && {
        loanToken: item.discoveredMarket.loanToken as Address,
        collateralToken: item.discoveredMarket.collateralToken as Address,
        oracle: item.discoveredMarket.oracle as Address,
        irm: item.discoveredMarket.irm as Address,
        lltv: BigInt(item.discoveredMarket.lltv),
      });
    if (!marketParams) return;
    void submit({ kind: 'acceptCap', marketParams });
  };

  const handleRevokeCap = (marketId: string) => {
    void submit({ kind: 'removeCap', marketId: marketId as `0x${string}` });
  };

  if (allocLoading || marketsLoading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-16 bg-bg-hover animate-shimmer" />)}</div>;
  }

  if (allocError || marketsError) {
    const err = allocError || marketsError;
    return (
      <Card className="py-8 text-center">
        <p className="text-danger text-sm">Failed to load caps data</p>
        <p className="text-text-tertiary text-xs mt-1">{err instanceof Error ? err.message : 'Data fetch failed.'}</p>
      </Card>
    );
  }

  const canSubmit = permissions.canCurate || permissions.isAdmin;
  const timelockSeconds = vault ? Number(vault.timelock) : 0;
  const isZeroTimelock = timelockSeconds === 0;

  return (
    <div className="space-y-4">
      {/* Chain Mismatch Warning */}
      {isMismatch && (
        <div className="flex items-center justify-between bg-warning/10 border border-warning/20 px-3 py-2">
          <span className="text-xs text-warning">Wallet is on the wrong network. Switch to continue.</span>
          <Button size="sm" variant="secondary" onClick={requestSwitch}>Switch Network</Button>
        </div>
      )}

      {/* Success Banner */}
      {isSuccess && (
        <div className="bg-success/10 border border-success/20 px-3 py-2 text-xs text-success">
          Transaction confirmed. Data will refresh shortly.
        </div>
      )}

      {/* Timelock Info */}
      <div className="flex items-center gap-2 text-xs text-text-tertiary">
        <Clock size={12} />
        <span>
          Vault timelock: <span className="font-mono text-text-secondary">{isZeroTimelock ? 'None (instant)' : formatDuration(timelockSeconds)}</span>
        </span>
        {isZeroTimelock && (
          <Badge variant="success">Zero timelock</Badge>
        )}
      </div>

      {/* Write-disabled banner (blacklist / pause) */}
      {writeDisabled && disabledTooltip && (
        <div className="px-3 py-2 bg-danger/10 border border-danger/30 text-[11px] text-danger">
          <span className="font-semibold">Writes disabled.</span> {disabledTooltip}
        </div>
      )}

      {/* Moolah propose-mode note */}
      {isMoolah && (
        <div className="px-3 py-2 bg-[#F0B90B]/5 border border-[#F0B90B]/20 text-[11px] text-text-secondary">
          <span className="font-mono text-[#F0B90B]">[Moolah]</span>{' '}
          Cap changes on Lista vaults go through the curatorTimeLock. Buttons here
          <span className="font-mono"> propose → wait → execute</span> — review the queued op in
          <span className="font-mono"> Pending Proposals</span> to fire once ready.
        </div>
      )}

      {/* Pending Caps Alert — includes both vault queue pending caps and discovered market pending caps */}
      {(() => {
        // Combine pending caps from vault queues + discovered markets
        const allPendingItems = allItems.filter((li) => li.status === 'pending');
        if (allPendingItems.length === 0) return null;
        return (
          <Card className="border-warning/20">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-warning" />
                <CardTitle>Pending Cap Changes</CardTitle>
              </div>
              <Badge variant="warning">{allPendingItems.length}</Badge>
            </CardHeader>
            <div className="space-y-2">
              {allPendingItems.map((item) => {
                // Get pending cap info from either source
                const pc = item.pendingAction ?? (item.discoveredPendingCap ? {
                  type: 'cap' as const,
                  description: '',
                  validAt: item.discoveredPendingCap.validAt,
                  marketId: item.discoveredPendingCap.marketId,
                  value: item.discoveredPendingCap.value,
                } : null);
                if (!pc) return null;
                const isReady = pc.validAt <= nowSeconds;
                return (
                  <div key={item.marketId} className="flex items-center justify-between py-2 px-3 bg-bg-hover/50">
                    <div>
                      <p className="text-sm text-text-primary">{item.label}</p>
                      <p className="text-xs text-text-tertiary">
                        New cap: <span className="font-mono">{pc.value ? formatTokenAmount(pc.value as bigint, decimals) : '?'}</span>
                        {' · '}
                        {isReady
                          ? <span className="text-success">Ready to accept</span>
                          : <span>Available in <span className="font-mono">{formatCountdown(pc.validAt)}</span></span>
                        }
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {isReady && canSubmit && (
                        <Button
                          size="sm"
                          onClick={() => handleAcceptCap(item)}
                          disabled={isMismatch || isPending || isConfirming || writeDisabled}
                          loading={isPending || isConfirming}
                          title={writeDisabled ? disabledTooltip ?? undefined : undefined}
                        >
                          {isMoolah ? 'Propose Accept' : 'Accept'}
                        </Button>
                      )}
                      {(permissions.canCancel || role.isEmergencyRole) && pc.marketId && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleRevokeCap(pc.marketId!)}
                          disabled={isMismatch || isPending || isConfirming || writeDisabled}
                          loading={isPending || isConfirming}
                          title={writeDisabled ? disabledTooltip ?? undefined : undefined}
                        >
                          {isMoolah ? 'Propose Revoke' : 'Revoke'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })()}

      {/* Add market by ID */}
      {canSubmit && (
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] text-text-tertiary uppercase tracking-wider block mb-1">
              <Plus size={10} className="inline mr-1" />
              Add market by ID
            </label>
            <input
              type="text"
              value={manualMarketId}
              onChange={(e) => { setManualMarketId(e.target.value); setManualMarketError(null); }}
              placeholder="0x… (32-byte market ID)"
              className="w-full bg-bg-hover border border-border-subtle px-2 py-1.5 text-xs text-text-primary font-mono placeholder-text-tertiary min-w-0 focus:outline-none focus:border-border-focus"
            />
          </div>
          <Button
            size="sm"
            onClick={handleAddManualMarket}
            disabled={!manualMarketId.trim() || manualMarketLoading}
            loading={manualMarketLoading}
          >
            Look up
          </Button>
        </div>
      )}
      {manualMarketError && (
        <p className="text-[10px] text-danger -mt-2">{manualMarketError}</p>
      )}

      {/* Market Lifecycle Table */}
      <Card>
        <CardHeader>
          <CardTitle>Market Supply Caps</CardTitle>
          <div className="flex gap-1">
            {(['all', 'in_supply_queue', 'enabled', 'pending', 'available'] as const).map((filter) => {
              const count = filter === 'all' ? allItems.length : statusCounts[filter];
              if (count === 0 && filter !== 'all') return null;
              return (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  className={`px-2 py-1 text-[10px] uppercase tracking-wider border transition-colors ${
                    statusFilter === filter
                      ? 'border-accent-primary text-accent-primary bg-accent-primary-muted'
                      : 'border-border-subtle text-text-tertiary hover:text-text-secondary'
                  }`}
                >
                  {filter === 'all' ? 'All' : STATUS_CONFIG[filter].label} ({count})
                </button>
              );
            })}
          </div>
        </CardHeader>

        {filteredItems.length === 0 ? (
          <p className="text-text-tertiary text-sm py-4 text-center">
            {statusFilter === 'all'
              ? 'No markets discovered. Run the market scanner first.'
              : `No markets with status "${STATUS_CONFIG[statusFilter as MarketStatus].label}".`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
                  <th className="text-left py-2 px-2">Market</th>
                  <th className="text-right py-2 px-2">LLTV</th>
                  <th className="text-right py-2 px-2">Cap</th>
                  <th className="text-right py-2 px-2">Supply</th>
                  <th className="text-right py-2 px-2">Used</th>
                  <th className="text-center py-2 px-2">Status</th>
                  {canSubmit && <th className="text-right py-2 px-2">Action</th>}
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const StatusIcon = STATUS_CONFIG[item.status].icon;
                  const isExpanded = expandedMarket === item.marketId;

                  return (
                    <MarketRow
                      key={item.marketId}
                      item={item}
                      chainId={chainId}
                      StatusIcon={StatusIcon}
                      isExpanded={isExpanded}
                      canSubmit={canSubmit}
                      decimals={decimals}
                      timelockSeconds={timelockSeconds}
                      isMismatch={isMismatch}
                      isPending={isPending}
                      isConfirming={isConfirming}
                      isMoolah={isMoolah}
                      writeDisabled={writeDisabled}
                      writeDisabledTooltip={disabledTooltip}
                      newCapValue={newCapValue}
                      onToggleExpand={() => {
                        setExpandedMarket(isExpanded ? null : item.marketId);
                        setNewCapValue('');
                      }}
                      onCapValueChange={setNewCapValue}
                      onSubmitCap={() => handleSubmitCap(item)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Lifecycle Legend */}
      <div className="flex flex-wrap gap-4 text-[10px] text-text-tertiary">
        <span className="flex items-center gap-1"><Circle size={10} /> Available — discoverable on-chain, not yet in vault</span>
        <span className="flex items-center gap-1"><Clock size={10} className="text-warning" /> Pending — cap submitted, waiting for timelock</span>
        <span className="flex items-center gap-1"><CheckCircle size={10} className="text-info" /> Enabled — cap accepted, not yet in supply queue</span>
        <span className="flex items-center gap-1"><ArrowRight size={10} className="text-success" /> In Queue — actively receiving deposits</span>
      </div>

      {/* Scanner Error */}
      {scannerError && (
        <p className="text-xs text-warning mt-2">
          Could not scan for discoverable markets: {scannerError instanceof Error ? scannerError.message : 'Unknown error'}
        </p>
      )}
    </div>
  );
}

// ---- Market Row Sub-component ----

function MarketRow({
  item,
  chainId,
  StatusIcon,
  isExpanded,
  canSubmit,
  decimals,
  timelockSeconds,
  isMismatch,
  isPending,
  isConfirming,
  isMoolah,
  writeDisabled,
  writeDisabledTooltip,
  newCapValue,
  onToggleExpand,
  onCapValueChange,
  onSubmitCap,
}: {
  item: MarketLifecycleItem;
  chainId: number;
  StatusIcon: typeof Circle;
  isExpanded: boolean;
  canSubmit: boolean;
  decimals: number;
  timelockSeconds: number;
  isMismatch: boolean;
  isPending: boolean;
  isConfirming: boolean;
  isMoolah: boolean;
  writeDisabled: boolean;
  writeDisabledTooltip: string | null;
  newCapValue: string;
  onToggleExpand: () => void;
  onCapValueChange: (v: string) => void;
  onSubmitCap: () => void;
}) {
  const config = STATUS_CONFIG[item.status];

  return (
    <>
      <tr
        className="border-b border-border-subtle/50 hover:bg-bg-hover/30 cursor-pointer"
        onClick={canSubmit ? onToggleExpand : undefined}
      >
        <td className="py-2.5 px-2">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary">{item.collateralSymbol}</span>
            <span className="text-text-tertiary text-xs">/ {item.loanSymbol}</span>
            <MarketTypeBadge irmAddress={item.irmAddress} chainId={chainId} />
          </div>
          <p className="text-[10px] text-text-tertiary font-mono mt-0.5">{item.marketId.slice(0, 10)}...</p>
        </td>
        <td className="text-right py-2.5 px-2 font-mono text-text-primary">
          {formatPercent(item.lltv)}
        </td>
        <td className="text-right py-2.5 px-2 font-mono text-text-secondary">
          {item.supplyCap > 0n ? formatTokenAmount(item.supplyCap, decimals) : '—'}
          {item.discoveredPendingCap && (
            <span className="block text-[10px] text-warning">
              ({formatTokenAmount(item.discoveredPendingCap.value, decimals)} pending)
            </span>
          )}
        </td>
        <td className="text-right py-2.5 px-2 font-mono text-text-primary">
          {item.supplyAssets > 0n ? formatTokenAmount(item.supplyAssets, decimals) : '—'}
        </td>
        <td className="text-right py-2.5 px-2 w-24">
          {item.supplyCap > 0n ? (
            <div className="flex items-center justify-end gap-2">
              <span className="text-text-primary text-xs font-mono">{item.capUsedPct.toFixed(0)}%</span>
              <ProgressBar value={item.capUsedPct} className="w-12 h-1.5" />
            </div>
          ) : (
            <span className="text-text-tertiary text-xs">—</span>
          )}
        </td>
        <td className="text-center py-2.5 px-2">
          <Badge variant={config.variant}>
            <StatusIcon size={10} className="mr-1 inline" />
            {config.label}
          </Badge>
        </td>
        {canSubmit && (
          <td className="text-right py-2.5 px-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
            >
              {isExpanded ? 'Close' : item.status === 'available' ? 'Add' : 'Edit Cap'}
            </Button>
          </td>
        )}
      </tr>

      {/* Expanded inline cap editor */}
      {isExpanded && canSubmit && (
        <tr>
          <td colSpan={canSubmit ? 7 : 6} className="p-0">
            <div className="bg-bg-hover/50 px-4 py-3 border-b border-border-subtle space-y-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs text-text-tertiary">
                    {item.status === 'available' ? 'Initial Supply Cap' : 'New Supply Cap'} (in asset tokens)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={newCapValue}
                    onChange={(e) => onCapValueChange(e.target.value)}
                    placeholder="e.g., 1000000"
                    className="w-full mt-1 bg-bg-surface border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary font-mono"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSubmitCap();
                  }}
                  disabled={!newCapValue || isMismatch || isPending || isConfirming || writeDisabled}
                  loading={isPending || isConfirming}
                  title={writeDisabled ? writeDisabledTooltip ?? undefined : undefined}
                >
                  {isMoolah
                    ? (item.status === 'available' ? 'Propose Cap (Add Market)' : 'Propose Cap Change')
                    : (item.status === 'available' ? 'Submit Cap (Add Market)' : 'Submit Cap Change')}
                </Button>
              </div>
              {item.supplyCap > 0n && (
                <p className="text-xs text-text-tertiary">
                  Current cap: <span className="font-mono text-text-secondary">{formatTokenAmount(item.supplyCap, decimals)}</span>
                </p>
              )}
              {item.status === 'available' && (
                <p className="text-xs text-info bg-info/10 p-2">
                  This market is not yet in the vault. Submitting a cap will register it.
                  {timelockSeconds > 0 && (
                    <span className="block mt-1 text-warning">
                      This vault has a <span className="font-mono">{formatDuration(timelockSeconds)}</span> timelock.
                      After submitting, you must wait before accepting the cap.
                    </span>
                  )}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
