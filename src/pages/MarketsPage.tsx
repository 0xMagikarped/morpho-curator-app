import { useState, useMemo } from 'react';
import type { Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/ProgressBar';
import { MarketDetail } from '../components/market/MarketDetail';
import { OracleHealthIndicator } from '../components/oracle/OracleHealthIndicator';
import { getChainConfig, getSupportedChainIds } from '../config/chains';
import { truncateAddress, formatWadPercent } from '../lib/utils/format';
import { useMarketScanner, useScannerState } from '../lib/hooks/useMarketScanner';
import { useOracleHealthBatch } from '../lib/hooks/useOracle';
import type { MarketRecord } from '../lib/indexer/indexedDB';

type SortKey = 'loanToken' | 'collateral' | 'lltv';

export function MarketsPage() {
  // Default to SEI (1329) — the primary target chain
  const [selectedChainId, setSelectedChainId] = useState<number>(1329);
  const [loanTokenFilter, setLoanTokenFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('loanToken');
  const [expandedMarketId, setExpandedMarketId] = useState<`0x${string}` | null>(null);

  const chainConfig = getChainConfig(selectedChainId);
  const supportedChains = getSupportedChainIds();

  const {
    data: markets,
    isLoading,
    isFetching,
    scanProgress,
    rescan,
    isApiChain,
  } = useMarketScanner(selectedChainId);

  const { data: scannerState } = useScannerState(selectedChainId);

  // Get unique oracle addresses for batch health check
  const oracleAddresses = useMemo(() => {
    if (!markets) return undefined;
    const addrs = new Set<Address>();
    for (const m of markets) {
      if (m.oracle !== '0x0000000000000000000000000000000000000000') {
        addrs.add(m.oracle as Address);
      }
    }
    return addrs.size > 0 ? [...addrs] : undefined;
  }, [markets]);

  const { data: oracleHealthMap } = useOracleHealthBatch(selectedChainId, oracleAddresses);

  // Compute unique loan tokens for filter dropdown
  const loanTokenOptions = useMemo(() => {
    if (!markets) return [];
    const tokens = new Map<string, string>();
    for (const m of markets) {
      const addr = m.loanToken.toLowerCase();
      if (!tokens.has(addr)) {
        tokens.set(addr, m.loanTokenSymbol ?? truncateAddress(m.loanToken));
      }
    }
    return Array.from(tokens.entries()).map(([addr, label]) => ({
      address: addr,
      label,
    }));
  }, [markets]);

  // Filter and sort
  const filteredMarkets = useMemo(() => {
    if (!markets) return [];
    let result = [...markets];

    if (loanTokenFilter) {
      result = result.filter(
        (m) => m.loanToken.toLowerCase() === loanTokenFilter.toLowerCase(),
      );
    }

    result.sort((a, b) => {
      switch (sortKey) {
        case 'loanToken':
          return (a.loanTokenSymbol ?? a.loanToken).localeCompare(
            b.loanTokenSymbol ?? b.loanToken,
          );
        case 'collateral':
          return (a.collateralTokenSymbol ?? a.collateralToken).localeCompare(
            b.collateralTokenSymbol ?? b.collateralToken,
          );
        case 'lltv':
          return Number(BigInt(b.lltv) - BigInt(a.lltv));
        default:
          return 0;
      }
    });

    return result;
  }, [markets, loanTokenFilter, sortKey]);

  // Scanner progress percentage (for RPC-only chains)
  const scanPercent = useMemo(() => {
    if (!scanProgress || scanProgress.isComplete) return 100;
    const total = scanProgress.toBlock - scanProgress.fromBlock;
    if (total === 0) return 100;
    const done = scanProgress.currentBlock - scanProgress.fromBlock;
    return Math.round((done / total) * 100);
  }, [scanProgress]);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Market Scanner</h1>
          <p className="text-sm text-text-tertiary mt-0.5">
            Discover Morpho Blue markets on-chain
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={isApiChain ? 'success' : 'info'}>
            {isApiChain ? 'API' : 'RPC'}
          </Badge>
          <select
            value={selectedChainId}
            onChange={(e) => {
              setSelectedChainId(Number(e.target.value));
              setExpandedMarketId(null);
              setLoanTokenFilter('');
            }}
            className="bg-bg-hover border border-border-default rounded px-3 py-1.5 text-sm text-text-primary"
          >
            {supportedChains.map((id) => {
              const cfg = getChainConfig(id);
              return (
                <option key={id} value={id}>
                  {cfg?.name ?? `Chain ${id}`}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Scanner Status */}
      {!isApiChain && (
        <Card>
          <CardHeader>
            <CardTitle>Scanner Status</CardTitle>
            {isFetching && !scanProgress?.isComplete && (
              <Badge variant="warning">Scanning...</Badge>
            )}
            {scanProgress?.isComplete && (
              <Badge variant="success">Complete</Badge>
            )}
          </CardHeader>
          <div className="space-y-2">
            <ProgressBar value={scanPercent} variant="default" />
            <div className="flex justify-between text-xs text-text-tertiary">
              <span>
                {scanProgress
                  ? `Block ${scanProgress.currentBlock.toLocaleString()} / ${scanProgress.toBlock.toLocaleString()}`
                  : scannerState
                    ? `Last scanned: block ${scannerState.lastScannedBlock.toLocaleString()}`
                    : 'Not scanned yet'}
              </span>
              <span>
                Markets found: {markets?.length ?? scannerState?.totalMarketsFound ?? 0}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={rescan}
                loading={isFetching}
              >
                Full Rescan
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <select
          value={loanTokenFilter}
          onChange={(e) => setLoanTokenFilter(e.target.value)}
          className="bg-bg-hover border border-border-default rounded px-3 py-1.5 text-sm text-text-primary"
        >
          <option value="">All loan tokens</option>
          {loanTokenOptions.map((opt) => (
            <option key={opt.address} value={opt.address}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="bg-bg-hover border border-border-default rounded px-3 py-1.5 text-sm text-text-primary"
        >
          <option value="loanToken">Sort: Loan Token</option>
          <option value="collateral">Sort: Collateral</option>
          <option value="lltv">Sort: LLTV</option>
        </select>

        <span className="text-xs text-text-tertiary ml-auto">
          {filteredMarkets.length} market{filteredMarkets.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Markets Table */}
      <Card>
        <CardHeader>
          <CardTitle>Markets</CardTitle>
          {chainConfig && (
            <span className="text-xs text-text-tertiary">
              {chainConfig.name} &middot; Morpho Blue {truncateAddress(chainConfig.morphoBlue)}
            </span>
          )}
        </CardHeader>

        {isLoading ? (
          <div className="text-text-tertiary text-sm animate-shimmer py-8 text-center">
            Loading markets...
          </div>
        ) : filteredMarkets.length === 0 ? (
          <div className="text-text-tertiary text-sm py-8 text-center">
            {markets?.length === 0
              ? 'No markets found. Try running a full scan.'
              : 'No markets match the current filter.'}
          </div>
        ) : (
          <div className="space-y-1">
            {/* Header row */}
            <div className="grid grid-cols-12 gap-2 text-[10px] uppercase text-text-tertiary px-3 py-1">
              <div className="col-span-3">Loan Token</div>
              <div className="col-span-3">Collateral</div>
              <div className="col-span-2">LLTV</div>
              <div className="col-span-2">Oracle</div>
              <div className="col-span-2">Block</div>
            </div>

            {filteredMarkets.map((market) => (
              <MarketRow
                key={market.marketId}
                market={market}
                chainId={selectedChainId}
                isExpanded={expandedMarketId === market.marketId}
                oracleHealth={oracleHealthMap?.get(market.oracle as Address) ?? null}
                onToggle={() =>
                  setExpandedMarketId(
                    expandedMarketId === market.marketId ? null : market.marketId,
                  )
                }
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ============================================================
// Market Row Component
// ============================================================

function MarketRow({
  market,
  chainId,
  isExpanded,
  oracleHealth,
  onToggle,
}: {
  market: MarketRecord;
  chainId: number;
  isExpanded: boolean;
  oracleHealth: import('../lib/oracle/oracleTypes').OracleHealth | null;
  onToggle: () => void;
}) {
  const lltv = BigInt(market.lltv);
  const oracleIsZero =
    market.oracle === '0x0000000000000000000000000000000000000000';

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full grid grid-cols-12 gap-2 px-3 py-2 text-sm hover:bg-bg-hover/40 rounded transition-colors text-left"
      >
        <div className="col-span-3 text-text-primary font-medium">
          {market.loanTokenSymbol ?? truncateAddress(market.loanToken)}
        </div>
        <div className="col-span-3 text-text-primary">
          {market.collateralTokenSymbol ?? truncateAddress(market.collateralToken)}
        </div>
        <div className="col-span-2">
          <Badge>{formatWadPercent(lltv)}</Badge>
        </div>
        <div className="col-span-2 text-text-secondary font-mono text-xs flex items-center gap-1.5">
          {oracleIsZero ? (
            <Badge variant="warning">None</Badge>
          ) : (
            <>
              <OracleHealthIndicator health={oracleHealth} />
              {truncateAddress(market.oracle)}
            </>
          )}
        </div>
        <div className="col-span-2 text-text-tertiary text-xs">
          {market.discoveredAtBlock || '—'}
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-2">
          <MarketDetail
            chainId={chainId}
            market={market}
            onClose={onToggle}
          />
        </div>
      )}
    </div>
  );
}
