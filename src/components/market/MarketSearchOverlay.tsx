import { useState, useEffect, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { truncateAddress, formatWadPercent } from '../../lib/utils/format';
import type { MarketRecord } from '../../lib/indexer/indexedDB';

interface MarketSearchOverlayProps {
  open: boolean;
  onClose: () => void;
  markets: MarketRecord[];
  onSelect: (market: MarketRecord) => void;
}

export function MarketSearchOverlay({ open, onClose, markets, onSelect }: MarketSearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? markets.filter((m) => {
        const q = query.toLowerCase();
        return (
          (m.loanTokenSymbol?.toLowerCase().includes(q) ?? false) ||
          (m.collateralTokenSymbol?.toLowerCase().includes(q) ?? false) ||
          m.marketId.toLowerCase().includes(q) ||
          m.loanToken.toLowerCase().includes(q) ||
          m.collateralToken.toLowerCase().includes(q)
        );
      })
    : markets.slice(0, 20);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    const active = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && filtered[activeIndex]) {
        onSelect(filtered[activeIndex]);
        onClose();
      }
    },
    [filtered, activeIndex, onClose, onSelect],
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
        role="combobox"
        aria-expanded="true"
        aria-haspopup="listbox"
      >
        <div
          className="w-full max-w-[560px] bg-bg-elevated border border-border-default overflow-hidden"
          onKeyDown={handleKeyDown}
        >
          {/* Search input */}
          <div className="flex items-center gap-2 p-3 border-b border-border-subtle">
            <Search size={16} className="text-text-tertiary shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets by token, name, or ID..."
              className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-tertiary outline-none font-mono"
              aria-label="Search markets"
              aria-controls="search-results"
              aria-activedescendant={filtered[activeIndex] ? `result-${activeIndex}` : undefined}
            />
            <kbd className="text-[10px] text-text-tertiary bg-bg-hover px-1.5 py-0.5 font-mono">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div
            ref={listRef}
            id="search-results"
            role="listbox"
            className="max-h-[400px] overflow-y-auto"
          >
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Search size={20} className="text-text-tertiary" />
                <p className="text-xs text-text-tertiary">No markets match</p>
              </div>
            ) : (
              filtered.slice(0, 20).map((market, i) => (
                <button
                  key={market.marketId}
                  id={`result-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                    i === activeIndex ? 'bg-bg-active' : 'hover:bg-bg-hover'
                  }`}
                  onClick={() => {
                    onSelect(market);
                    onClose();
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] text-text-primary">
                      {market.collateralTokenSymbol ?? truncateAddress(market.collateralToken)}
                      {' / '}
                      {market.loanTokenSymbol ?? truncateAddress(market.loanToken)}
                    </span>
                    <span className="text-[10px] font-mono text-text-tertiary ml-2">
                      {truncateAddress(market.marketId, 4)}
                    </span>
                  </div>
                  <Badge className="text-[10px]">{formatWadPercent(BigInt(market.lltv))} LLTV</Badge>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
