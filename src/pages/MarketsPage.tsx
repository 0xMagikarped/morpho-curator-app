import { useState, useMemo, useEffect, useCallback } from 'react';
import type { Address } from 'viem';
import {
  Search,
  ChevronUp,
  ChevronDown,
  Eye,
  RefreshCw,
  Filter,
  AlertCircle,
  X,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Drawer } from '../components/ui/Drawer';
import { OracleHealthIndicator } from '../components/oracle/OracleHealthIndicator';
import { MarketDrawerContent } from '../components/market/MarketDrawerContent';
import { MarketSearchOverlay } from '../components/market/MarketSearchOverlay';
import { getChainConfig, getSupportedChainIds } from '../config/chains';
import { truncateAddress, formatWadPercent } from '../lib/utils/format';
import { useMarketScanner, useScannerState } from '../lib/hooks/useMarketScanner';
import { useOracleHealthBatch } from '../lib/hooks/useOracle';
import { cn } from '../lib/utils/cn';
import type { MarketRecord } from '../lib/indexer/indexedDB';

type SortKey = 'market' | 'collateral' | 'lltv' | 'oracle';
type SortDir = 'asc' | 'desc';

export function MarketsPage() {
  const [selectedChainId, setSelectedChainId] = useState<number>(1329);
  const [selectedTokens, setSelectedTokens] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('market');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [drawerMarket, setDrawerMarket] = useState<MarketRecord | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const supportedChains = getSupportedChainIds();

  const {
    data: markets,
    isLoading,
    isFetching,
    error,
    scanProgress,
    rescan,
    isApiChain,
  } = useMarketScanner(selectedChainId);

  useScannerState(selectedChainId);

  // Cmd+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Oracle health
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

  // Unique loan tokens for filter chips
  const loanTokenOptions = useMemo(() => {
    if (!markets) return [];
    const tokens = new Map<string, string>();
    for (const m of markets) {
      const addr = m.loanToken.toLowerCase();
      if (!tokens.has(addr)) {
        tokens.set(addr, m.loanTokenSymbol ?? truncateAddress(m.loanToken));
      }
    }
    return Array.from(tokens.entries()).map(([addr, label]) => ({ address: addr, label }));
  }, [markets]);

  // Filter and sort
  const filteredMarkets = useMemo(() => {
    if (!markets) return [];
    let result = [...markets];

    if (selectedTokens.length > 0) {
      result = result.filter((m) =>
        selectedTokens.includes(m.loanToken.toLowerCase()),
      );
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'market':
          cmp = (a.loanTokenSymbol ?? a.loanToken).localeCompare(b.loanTokenSymbol ?? b.loanToken);
          break;
        case 'collateral':
          cmp = (a.collateralTokenSymbol ?? a.collateralToken).localeCompare(b.collateralTokenSymbol ?? b.collateralToken);
          break;
        case 'lltv':
          cmp = Number(BigInt(b.lltv) - BigInt(a.lltv));
          break;
        default:
          cmp = 0;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [markets, selectedTokens, sortKey, sortDir]);

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  }, []);

  const toggleToken = (addr: string) => {
    setSelectedTokens((prev) =>
      prev.includes(addr) ? prev.filter((a) => a !== addr) : [...prev, addr],
    );
  };

  const clearFilters = () => {
    setSelectedTokens([]);
  };

  const hasFilters = selectedTokens.length > 0;

  // Scan progress
  const scanPercent = useMemo(() => {
    if (!scanProgress || scanProgress.isComplete) return 100;
    const total = scanProgress.toBlock - scanProgress.fromBlock;
    if (total === 0) return 100;
    const done = scanProgress.currentBlock - scanProgress.fromBlock;
    return Math.round((done / total) * 100);
  }, [scanProgress]);

  const isScanning = isFetching && !scanProgress?.isComplete;

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* ── PAGE HEADER ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-text-primary">Markets</h1>
          {markets && (
            <Badge>{markets.length} market{markets.length !== 1 ? 's' : ''}</Badge>
          )}
        </div>
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-bg-hover border border-border-subtle rounded text-xs text-text-tertiary hover:text-text-secondary hover:border-border-default transition-colors min-h-[36px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
          aria-label="Search markets"
        >
          <Search size={14} />
          <span>Search...</span>
          <kbd className="text-[10px] bg-bg-surface px-1.5 py-0.5 rounded font-mono ml-2">⌘K</kbd>
        </button>
      </div>

      {/* ── FILTER BAR ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Chain selector */}
        <select
          value={selectedChainId}
          onChange={(e) => {
            setSelectedChainId(Number(e.target.value));
            setDrawerMarket(null);
            clearFilters();
          }}
          className="bg-bg-hover border border-border-subtle rounded px-2 py-1.5 text-xs text-text-primary font-mono"
          disabled={isLoading}
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

        {/* Token filter chips */}
        {loanTokenOptions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {loanTokenOptions.map((opt) => {
              const isActive = selectedTokens.includes(opt.address);
              return (
                <button
                  key={opt.address}
                  onClick={() => toggleToken(opt.address)}
                  disabled={isLoading}
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary',
                    isActive
                      ? 'bg-bg-active border-accent-primary/30 text-accent-primary'
                      : 'bg-transparent border-border-subtle text-text-secondary hover:border-border-default',
                  )}
                >
                  {opt.label}
                  {isActive && <X size={10} />}
                </button>
              );
            })}
          </div>
        )}

        {/* Source badge */}
        <Badge variant={isApiChain ? 'success' : 'info'} className="text-[10px]">
          {isApiChain ? 'API' : 'RPC'}
        </Badge>

        {/* Rescan */}
        <Button
          variant="ghost"
          size="sm"
          onClick={rescan}
          loading={isFetching}
          className="text-[11px]"
        >
          <RefreshCw size={12} className={cn('mr-1', isScanning && 'animate-spin')} />
          Rescan
        </Button>

        {/* Clear filters */}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs font-mono text-text-tertiary hover:text-text-secondary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary rounded"
          >
            Clear filters
          </button>
        )}

        {/* Count */}
        <span className="text-[11px] text-text-tertiary ml-auto font-mono">
          Showing {filteredMarkets.length} of {markets?.length ?? 0}
        </span>
      </div>

      {/* ── SCAN PROGRESS ── */}
      {isScanning && (
        <div className="h-0.5 w-full bg-bg-hover rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-primary transition-all duration-300 rounded-full"
            style={{ width: `${scanPercent}%` }}
          />
        </div>
      )}

      {/* ── TABLE ── */}
      <Card className="!p-0 overflow-hidden">
        {/* Error state */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-3 bg-danger/10 border-b border-danger/20 text-xs text-danger">
            <AlertCircle size={14} />
            <span className="flex-1">{error instanceof Error ? error.message : 'Failed to load markets'}</span>
            <Button variant="ghost" size="sm" onClick={rescan} className="text-danger text-[11px]">
              Retry
            </Button>
          </div>
        )}

        {/* Loading state */}
        {isLoading ? (
          <div className="divide-y divide-border-subtle/30">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <div className="h-4 w-24 bg-bg-hover rounded animate-shimmer" />
                <div className="h-4 w-20 bg-bg-hover rounded animate-shimmer" />
                <div className="flex-1" />
                <div className="h-4 w-12 bg-bg-hover rounded animate-shimmer" />
                <div className="h-4 w-16 bg-bg-hover rounded animate-shimmer" />
              </div>
            ))}
          </div>
        ) : filteredMarkets.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Filter size={24} className="text-text-tertiary" />
            <p className="text-sm text-text-tertiary">
              {markets?.length === 0
                ? 'No markets found on this chain.'
                : 'No markets match your filters.'}
            </p>
            {markets?.length === 0 ? (
              <Button variant="secondary" size="sm" onClick={rescan}>
                <RefreshCw size={12} className="mr-1" />
                Rescan
              </Button>
            ) : (
              <button
                onClick={clearFilters}
                className="text-xs font-mono text-accent-primary hover:text-accent-primary-hover transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-bg-elevated border-b border-border-subtle">
                    <SortHeader label="Market" sortKey="market" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Collateral" sortKey="collateral" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <th className="text-left py-2 px-3 text-[10px] uppercase text-text-tertiary tracking-wider">Oracle</th>
                    <SortHeader label="LLTV" sortKey="lltv" current={sortKey} dir={sortDir} onSort={toggleSort} />
                    <th className="text-right py-2 px-3 text-[10px] uppercase text-text-tertiary tracking-wider w-10" />
                  </tr>
                </thead>
                <tbody>
                  {filteredMarkets.map((market) => (
                    <tr
                      key={market.marketId}
                      onClick={() => setDrawerMarket(market)}
                      className={cn(
                        'border-b border-border-subtle/30 cursor-pointer transition-colors group',
                        drawerMarket?.marketId === market.marketId
                          ? 'bg-bg-active border-l-2 border-l-accent-primary'
                          : 'hover:bg-bg-hover border-l-2 border-l-transparent hover:border-l-accent-primary',
                      )}
                    >
                      <td className="py-2.5 px-3">
                        <div>
                          <span className="text-[13px] text-text-primary font-medium">
                            {market.loanTokenSymbol ?? truncateAddress(market.loanToken)}
                          </span>
                          <p className="text-[10px] font-mono text-text-tertiary mt-0.5">
                            {truncateAddress(market.marketId, 4)}
                          </p>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-text-primary text-[13px]">
                        {market.collateralTokenSymbol ?? truncateAddress(market.collateralToken)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 text-xs font-mono text-text-secondary">
                          {market.oracle === '0x0000000000000000000000000000000000000000' ? (
                            <Badge variant="warning" className="text-[10px]">None</Badge>
                          ) : (
                            <>
                              <OracleHealthIndicator health={oracleHealthMap?.get(market.oracle as Address) ?? null} />
                              {truncateAddress(market.oracle)}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-text-primary text-right">
                        {formatWadPercent(BigInt(market.lltv))}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawerMarket(market);
                          }}
                          className="p-1.5 text-text-tertiary hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100 min-w-[44px] min-h-[44px] flex items-center justify-center -my-2"
                          aria-label={`View ${market.loanTokenSymbol ?? 'market'} details`}
                        >
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y divide-border-subtle/30">
              {filteredMarkets.map((market) => (
                <button
                  key={market.marketId}
                  onClick={() => setDrawerMarket(market)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-bg-hover transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] text-text-primary font-medium">
                      {market.collateralTokenSymbol ?? truncateAddress(market.collateralToken)}
                      {' / '}
                      {market.loanTokenSymbol ?? truncateAddress(market.loanToken)}
                    </span>
                    <p className="text-[10px] font-mono text-text-tertiary mt-0.5">
                      LLTV {formatWadPercent(BigInt(market.lltv))}
                    </p>
                  </div>
                  <Eye size={14} className="text-text-tertiary shrink-0" />
                </button>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* ── DETAIL DRAWER ── */}
      <Drawer
        open={!!drawerMarket}
        onClose={() => setDrawerMarket(null)}
        title={
          drawerMarket
            ? `${drawerMarket.collateralTokenSymbol ?? truncateAddress(drawerMarket.collateralToken)} / ${drawerMarket.loanTokenSymbol ?? truncateAddress(drawerMarket.loanToken)}`
            : ''
        }
        subtitle={drawerMarket ? truncateAddress(drawerMarket.marketId, 8) : undefined}
        footer={
          drawerMarket ? (
            <div className="flex gap-2">
              <Button size="sm" className="flex-1">Allocate to Vault</Button>
              <Button size="sm" variant="ghost">Add to Watchlist</Button>
            </div>
          ) : undefined
        }
      >
        {drawerMarket && (
          <MarketDrawerContent chainId={selectedChainId} market={drawerMarket} />
        )}
      </Drawer>

      {/* ── SEARCH OVERLAY ── */}
      <MarketSearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        markets={markets ?? []}
        onSelect={(m) => setDrawerMarket(m)}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Sortable table header
// ────────────────────────────────────────────────────────────

function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const isActive = current === sortKey;
  return (
    <th
      className="text-left py-2 px-3 cursor-pointer select-none group"
      onClick={() => onSort(sortKey)}
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-tertiary group-hover:text-text-secondary transition-colors">
        {label}
        <span className={cn('transition-colors', isActive ? 'text-accent-primary' : 'text-text-tertiary/30')}>
          {isActive && dir === 'desc' ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronUp size={12} />
          )}
        </span>
      </span>
    </th>
  );
}
