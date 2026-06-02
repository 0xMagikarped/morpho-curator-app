/**
 * Browse Morpho Blue markets filtered by vault's loan token.
 * Groups markets by collateral token. Supports single-select click.
 */
import { useState, useMemo } from 'react';
import type { Address } from 'viem';
import { Search, ChevronDown, ChevronRight, ArrowUpRight, Check } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { useMorphoMarkets } from '../../../hooks/useMorphoMarkets';
import { useMarketLookup, parseMarketIdInput } from '../../../hooks/useMarketLookup';
import { isApiSupportedChain } from '../../../lib/data/morphoApi';
import { truncateAddress } from '../../../lib/utils/format';
import type { MarketInfo } from '../../../types';

interface MarketBrowserProps {
  chainId: number;
  loanToken: Address;
  assetSymbol: string;
  onSelect: (market: MarketInfo) => void;
  excludeMarketIds?: Set<string>;
  /** Enable multi-select mode with checkboxes */
  multiSelect?: boolean;
  /** Currently selected market IDs (for multi-select) */
  selectedMarketIds?: Set<string>;
}

interface CollateralGroup {
  symbol: string;
  address: Address;
  markets: MarketInfo[];
}

export function MarketBrowser({
  chainId,
  loanToken,
  assetSymbol,
  onSelect,
  excludeMarketIds,
  multiSelect,
  selectedMarketIds,
}: MarketBrowserProps) {
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const { data: markets, isLoading, error } = useMorphoMarkets(chainId, loanToken);

  // On chains without Morpho API coverage (Pharos, XDC, SEI) there's no
  // market index to list — the only way to add a market is to paste its
  // 32-byte ID, which we resolve via RPC. Surface that guidance instead of
  // a bare "No markets found".
  const apiUnsupported = !isApiSupportedChain(chainId);

  // PR 19 — direct lookup-by-ID fallback. On chains without Morpho API
  // coverage (XDC, SEI) the GraphQL-backed `useMorphoMarkets` is empty,
  // and even on supported chains a brand-new market may not have been
  // indexed yet. If the search input looks like a 32-byte market ID, we
  // resolve it via RPC (`idToMarketParams` on Morpho Blue) and synthesize
  // a `MarketInfo` to merge into the displayed list.
  const lookup = useMarketLookup({
    chainId,
    input: search,
    expectedLoanToken: loanToken,
    enabled: parseMarketIdInput(search) !== null,
  });

  const filtered = useMemo(() => {
    const apiList = markets ?? [];

    // Merge the manual-lookup result if present and not already in the
    // API-derived list. Dedupe by ID.
    const merged: MarketInfo[] = [...apiList];
    if (lookup.kind === 'found') {
      const exists = merged.some((m) => m.id.toLowerCase() === lookup.market.id.toLowerCase());
      if (!exists) merged.push(lookup.market);
    }

    let result = merged;

    if (excludeMarketIds?.size) {
      result = result.filter((m) => !excludeMarketIds.has(m.id));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.collateralToken.symbol.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.collateralToken.address.toLowerCase().includes(q),
      );
    }

    return result;
  }, [markets, search, excludeMarketIds, lookup]);

  // Group by collateral token
  const groups = useMemo(() => {
    const map = new Map<string, CollateralGroup>();
    for (const m of filtered) {
      const key = m.collateralToken.address.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          symbol: m.collateralToken.symbol,
          address: m.collateralToken.address,
          markets: [],
        });
      }
      map.get(key)!.markets.push(m);
    }
    // Sort groups by total supply descending
    return Array.from(map.values()).sort((a, b) => {
      const aSupply = a.markets.reduce((s, m) => s + Number(m.state.totalSupplyAssets), 0);
      const bSupply = b.markets.reduce((s, m) => s + Number(m.state.totalSupplyAssets), 0);
      return bSupply - aSupply;
    });
  }, [filtered]);

  const toggleGroup = (addr: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr);
      else next.add(addr);
      return next;
    });
  };

  // Auto-expand all groups when few
  const allExpanded = groups.length <= 5;

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-shimmer h-16 bg-bg-hover" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="py-6 text-center">
        <p className="text-danger text-xs">Failed to load markets</p>
        <p className="text-text-tertiary text-[10px] mt-1">
          {error instanceof Error ? error.message : 'API error'}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by collateral, or paste a 0x… market ID"
          className="w-full pl-9 pr-3 py-2 text-xs bg-bg-hover border border-border-subtle text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
        />
      </div>

      <p className="text-[10px] text-text-tertiary">
        {filtered.length} market{filtered.length !== 1 ? 's' : ''} with {assetSymbol} as loan token
        {groups.length > 0 && ` · ${groups.length} collateral${groups.length !== 1 ? 's' : ''}`}
      </p>

      {/* PR 19 — lookup-by-ID feedback. Only renders when the search box
          contains a valid bytes32 shape, so it doesn't crowd the regular
          filter case. */}
      {lookup.kind === 'loading' && (
        <p className="text-[10px] text-text-tertiary italic">Resolving market ID via RPC…</p>
      )}
      {lookup.kind === 'not-found' && (
        <p className="text-[10px] text-warning">
          No Morpho Blue market with this ID on chain {chainId}.
        </p>
      )}
      {lookup.kind === 'loan-token-mismatch' && (
        <p className="text-[10px] text-warning">
          Market exists but its loan token ({truncateAddress(lookup.actual)}) ≠ vault asset ({assetSymbol}).
        </p>
      )}
      {lookup.kind === 'error' && (
        <p className="text-[10px] text-danger">Lookup error: {lookup.message}</p>
      )}

      {/* Grouped market list */}
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {groups.length === 0 ? (
          apiUnsupported && !search.trim() ? (
            <div className="text-center py-6 px-4 space-y-1">
              <p className="text-xs text-text-secondary">
                Automatic market discovery isn't available on this chain.
              </p>
              <p className="text-[10px] text-text-tertiary">
                Paste a Morpho Blue market ID (0x… 32 bytes) in the search box above to add it.
                Create one first on the Markets page if none exist yet.
              </p>
            </div>
          ) : (
            <p className="text-xs text-text-tertiary text-center py-4">
              No markets found.
            </p>
          )
        ) : (
          groups.map((group) => {
            const key = group.address.toLowerCase();
            const isOpen = allExpanded || expandedGroups.has(key);

            return (
              <div key={key}>
                {/* Collateral group header */}
                <button
                  onClick={() => toggleGroup(key)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-bg-hover border border-border-subtle text-left hover:border-border-default transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
                >
                  <div className="flex items-center gap-2">
                    {isOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
                    )}
                    <span className="text-xs font-medium text-text-primary">{group.symbol}</span>
                    <Badge>{group.markets.length}</Badge>
                  </div>
                  <span className="text-[10px] font-mono text-text-tertiary">
                    {truncateAddress(group.address)}
                  </span>
                </button>

                {/* Markets in group */}
                {isOpen && (
                  <div className="ml-5 border-l border-border-subtle">
                    {group.markets.map((market) => (
                      <MarketRow
                        key={market.id}
                        market={market}
                        assetSymbol={assetSymbol}
                        onSelect={() => onSelect(market)}
                        multiSelect={multiSelect}
                        isSelected={selectedMarketIds?.has(market.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function MarketRow({
  market,
  assetSymbol,
  onSelect,
  multiSelect,
  isSelected,
}: {
  market: MarketInfo;
  assetSymbol: string;
  onSelect: () => void;
  multiSelect?: boolean;
  isSelected?: boolean;
}) {
  const supplyUsd = Number(market.state.totalSupplyAssets) / 10 ** market.loanToken.decimals;
  const lltvPct = (Number(market.params.lltv) / 1e18) * 100;

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center justify-between p-3 border-b border-border-subtle hover:bg-bg-hover transition-colors text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary ${
        isSelected ? 'bg-accent-primary/5 border-l-2 border-l-accent-primary' : ''
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {multiSelect && (
          <div className={`w-4 h-4 border flex items-center justify-center shrink-0 ${
            isSelected ? 'bg-accent-primary border-accent-primary' : 'border-border-subtle'
          }`}>
            {isSelected && <Check className="w-3 h-3 text-bg-root" />}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-text-primary">
              {market.collateralToken.symbol}/{assetSymbol}
            </span>
            <Badge variant="info">{lltvPct.toFixed(0)}%</Badge>
          </div>
          <span className="text-[10px] font-mono text-text-tertiary">
            {truncateAddress(market.id)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right">
          <p className="text-[10px] text-text-tertiary">Supply APY</p>
          <p className="text-xs font-mono text-accent-primary">
            {(market.supplyAPY * 100).toFixed(2)}%
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-text-tertiary">TVL</p>
          <p className="text-xs font-mono text-text-primary">
            {supplyUsd >= 1_000_000
              ? `${(supplyUsd / 1_000_000).toFixed(1)}M`
              : supplyUsd >= 1_000
                ? `${(supplyUsd / 1_000).toFixed(0)}K`
                : supplyUsd.toFixed(0)}
          </p>
        </div>
        {!multiSelect && <ArrowUpRight className="w-3.5 h-3.5 text-text-tertiary" />}
      </div>
    </button>
  );
}
