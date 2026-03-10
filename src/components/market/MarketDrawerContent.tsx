import { useState, useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { ProgressBar } from '../ui/ProgressBar';
import { OracleRiskCard } from '../oracle/OracleRiskCard';
import { useEnrichedMarketState } from '../../lib/hooks/useMarketScanner';
import { truncateAddress, formatTokenAmount, formatWadPercent, formatPercent } from '../../lib/utils/format';
import { cn } from '../../lib/utils/cn';
import type { MarketRecord } from '../../lib/indexer/indexedDB';

type Tab = 'overview' | 'risk' | 'notes';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'risk', label: 'Risk' },
  { id: 'notes', label: 'Notes' },
];

interface MarketDrawerContentProps {
  chainId: number;
  market: MarketRecord;
}

export function MarketDrawerContent({ chainId, market }: MarketDrawerContentProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const { data: state, isLoading } = useEnrichedMarketState(chainId, market);

  const lltv = BigInt(market.lltv);
  const lltvPct = Number(lltv) / 1e18;

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-0 border-b border-border-subtle">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary',
              activeTab === tab.id
                ? 'text-text-primary border-accent-primary'
                : 'text-text-tertiary border-transparent hover:text-text-secondary',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <OverviewTab market={market} state={state} isLoading={isLoading} lltv={lltv} />
      )}
      {activeTab === 'risk' && (
        <RiskTab market={market} chainId={chainId} lltvPct={lltvPct} state={state} />
      )}
      {activeTab === 'notes' && (
        <NotesTab marketId={market.marketId} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Overview Tab
// ────────────────────────────────────────────────────────────

function OverviewTab({
  market,
  state,
  isLoading,
  lltv,
}: {
  market: MarketRecord;
  state: any;
  isLoading: boolean;
  lltv: bigint;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-10 bg-bg-hover animate-shimmer" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Token pair */}
      <div className="grid grid-cols-2 gap-2">
        <DataPair
          label="Loan Token"
          value={market.loanTokenSymbol ?? truncateAddress(market.loanToken)}
          sub={truncateAddress(market.loanToken)}
        />
        <DataPair
          label="Collateral"
          value={market.collateralTokenSymbol ?? truncateAddress(market.collateralToken)}
          sub={truncateAddress(market.collateralToken)}
        />
      </div>

      <DataPair label="LLTV" value={formatWadPercent(lltv)} />

      {state && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <DataPair
              label="Total Supply"
              value={`${formatTokenAmount(state.totalSupplyAssets, state.loanToken.decimals)} ${state.loanToken.symbol}`}
            />
            <DataPair
              label="Total Borrow"
              value={`${formatTokenAmount(state.totalBorrowAssets, state.loanToken.decimals)} ${state.loanToken.symbol}`}
            />
          </div>

          <div>
            <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Utilization</span>
            <div className="flex items-center gap-2 mt-1">
              <ProgressBar value={state.utilization * 100} className="flex-1" />
              <span className="text-xs font-mono text-text-primary">{formatPercent(state.utilization)}</span>
            </div>
          </div>

          {state.oraclePrice != null && (
            <DataPair label="Oracle Price" value={state.oraclePrice.toString().slice(0, 16)} mono />
          )}
        </>
      )}

      {/* Contract addresses */}
      <div className="pt-2 border-t border-border-subtle space-y-1.5">
        <DataPair label="Market ID" value={truncateAddress(market.marketId, 8)} mono />
        <DataPair label="Oracle" value={truncateAddress(market.oracle)} mono />
        <DataPair label="IRM" value={truncateAddress(market.irm)} mono />
        <DataPair label="Discovered Block" value={market.discoveredAtBlock?.toString() || 'N/A'} />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Risk Tab
// ────────────────────────────────────────────────────────────

function RiskTab({
  market,
  chainId,
  lltvPct,
  state,
}: {
  market: MarketRecord;
  chainId: number;
  lltvPct: number;
  state: any;
}) {
  const currentUtil = state?.utilization ?? 0;

  return (
    <div className="space-y-4">
      {/* LTV waterfall */}
      <div>
        <span className="text-[10px] text-text-tertiary uppercase tracking-wider">LTV Waterfall</span>
        <div className="relative h-3 mt-2 bg-bg-hover overflow-hidden">
          {/* Utilization fill */}
          <div
            className="absolute top-0 left-0 h-full"
            style={{
              width: `${Math.min(currentUtil * 100, 100)}%`,
              backgroundColor: 'var(--color-success)',
              opacity: 0.6,
            }}
          />
          {/* LLTV marker */}
          <div
            className="absolute top-0 h-full w-0.5"
            style={{
              left: `${Math.min(lltvPct * 100, 100)}%`,
              backgroundColor: 'var(--color-warning)',
            }}
          />
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-text-tertiary">
          <span>0%</span>
          <span className="text-warning">LLTV {(lltvPct * 100).toFixed(1)}%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Liquidation scenarios */}
      <div>
        <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Liquidation Scenarios</span>
        <table className="w-full mt-2 text-xs">
          <thead>
            <tr className="text-[10px] text-text-tertiary uppercase border-b border-border-subtle">
              <th className="text-left py-1">Price Drop</th>
              <th className="text-right py-1">Effective LTV</th>
              <th className="text-right py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {[10, 20, 30, 50, 70].map((drop) => {
              const effectiveLtv = currentUtil / (1 - drop / 100);
              const isLiquidated = effectiveLtv > lltvPct;
              return (
                <tr key={drop} className="border-b border-border-subtle/30">
                  <td className="py-1.5 font-mono text-text-primary">-{drop}%</td>
                  <td className="py-1.5 text-right font-mono text-text-primary">
                    {(effectiveLtv * 100).toFixed(1)}%
                  </td>
                  <td className="py-1.5 text-right">
                    <Badge variant={isLiquidated ? 'danger' : 'success'} className="text-[10px]">
                      {isLiquidated ? 'Liquidated' : 'Safe'}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Oracle risk card */}
      {market.oracle !== '0x0000000000000000000000000000000000000000' && (
        <OracleRiskCard chainId={chainId} oracleAddress={market.oracle} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Notes Tab
// ────────────────────────────────────────────────────────────

function NotesTab({ marketId }: { marketId: string }) {
  const storageKey = `morpho-curator-notes-${marketId}`;
  const [notes, setNotes] = useState(() => localStorage.getItem(storageKey) ?? '');
  const [saved, setSaved] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  const handleBlur = () => {
    localStorage.setItem(storageKey, notes);
    setSaved(true);
    timeoutRef.current = setTimeout(() => setSaved(false), 1500);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-tertiary uppercase tracking-wider">Curator Notes</span>
        {saved && (
          <span className="inline-flex items-center gap-1 text-[10px] text-success animate-[fade-in_200ms_ease-out]">
            <Check size={12} />
            Saved
          </span>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={handleBlur}
        placeholder="Add notes about this market..."
        className="w-full h-40 bg-bg-hover border border-border-subtle p-2 text-sm text-text-primary placeholder-text-tertiary resize-none outline-none focus:border-border-focus font-mono"
      />
      <p className="text-[10px] text-text-tertiary text-right">{notes.length} characters</p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Shared DataPair
// ────────────────────────────────────────────────────────────

function DataPair({
  label,
  value,
  sub,
  mono,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-[10px] text-text-tertiary uppercase tracking-wider">{label}</span>
      <p className={cn('text-sm text-text-primary mt-0.5', mono && 'font-mono text-xs')}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] font-mono text-text-tertiary mt-0.5">{sub}</p>
      )}
    </div>
  );
}
