import type { MarketRecord } from '../../lib/indexer/indexedDB';
import { useEnrichedMarketState } from '../../lib/hooks/useMarketScanner';
import { Badge } from '../ui/Badge';
import { ProgressBar } from '../ui/ProgressBar';
import { OracleRiskCard } from '../oracle/OracleRiskCard';
import {
  truncateAddress,
  formatTokenAmount,
  formatWadPercent,
  formatPercent,
} from '../../lib/utils/format';

interface MarketDetailProps {
  chainId: number;
  market: MarketRecord;
  onClose: () => void;
}

export function MarketDetail({ chainId, market, onClose }: MarketDetailProps) {
  const { data: state, isLoading } = useEnrichedMarketState(chainId, market);

  const lltv = BigInt(market.lltv);

  return (
    <div className="bg-bg-hover/50 border border-border-default rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">
            {market.loanTokenSymbol ?? truncateAddress(market.loanToken)} /{' '}
            {market.collateralTokenSymbol ?? truncateAddress(market.collateralToken)}
          </span>
          <Badge>{formatWadPercent(lltv)} LLTV</Badge>
        </div>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary text-sm"
        >
          Close
        </button>
      </div>

      {isLoading ? (
        <div className="text-text-tertiary text-sm animate-shimmer">
          Loading on-chain state...
        </div>
      ) : state ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-[10px] text-text-tertiary uppercase">Total Supply</p>
            <p className="text-text-primary font-mono">
              {formatTokenAmount(
                state.totalSupplyAssets,
                state.loanToken.decimals,
              )}{' '}
              {state.loanToken.symbol}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary uppercase">Total Borrow</p>
            <p className="text-text-primary font-mono">
              {formatTokenAmount(
                state.totalBorrowAssets,
                state.loanToken.decimals,
              )}{' '}
              {state.loanToken.symbol}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary uppercase">Utilization</p>
            <p className="text-text-primary">{formatPercent(state.utilization)}</p>
            <ProgressBar value={state.utilization * 100} className="mt-1" />
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary uppercase">Oracle Price</p>
            {state.oraclePrice != null ? (
              <p className="text-text-primary font-mono text-xs">
                {state.oraclePrice.toString().slice(0, 12)}...
              </p>
            ) : (
              <Badge variant="warning">Stale</Badge>
            )}
          </div>
        </div>
      ) : null}

      {/* Oracle Risk Card */}
      {market.oracle !== '0x0000000000000000000000000000000000000000' && (
        <OracleRiskCard chainId={chainId} oracleAddress={market.oracle} />
      )}

      {/* Contract addresses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-text-tertiary">Market ID: </span>
          <span className="text-text-secondary font-mono">{truncateAddress(market.marketId, 8)}</span>
        </div>
        <div>
          <span className="text-text-tertiary">Oracle: </span>
          <span className="text-text-secondary font-mono">{truncateAddress(market.oracle)}</span>
        </div>
        <div>
          <span className="text-text-tertiary">IRM: </span>
          <span className="text-text-secondary font-mono">{truncateAddress(market.irm)}</span>
        </div>
        <div>
          <span className="text-text-tertiary">Discovered at block: </span>
          <span className="text-text-secondary">{market.discoveredAtBlock || 'N/A'}</span>
        </div>
      </div>
    </div>
  );
}
