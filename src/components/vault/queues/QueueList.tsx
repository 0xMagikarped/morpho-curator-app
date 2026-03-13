import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { Badge } from '../../ui/Badge';
import { ProgressBar } from '../../ui/ProgressBar';
import { formatTokenAmount } from '../../../lib/utils/format';

export interface QueueMarketItem {
  marketId: `0x${string}`;
  label: string; // e.g. "wstETH/USDC 86% LLTV"
  supplyAssets: bigint;
  supplyCap: bigint;
  availableLiquidity: bigint;
  supplyAPY: number;
  utilization: number;
}

interface QueueListProps {
  items: QueueMarketItem[];
  editing: boolean;
  mode: 'supply' | 'withdraw';
  decimals: number;
  assetSymbol: string;
  onMove?: (fromIndex: number, toIndex: number) => void;
  onRemove?: (index: number) => void;
  /** Markets that can be removed from withdraw queue (0 supply or pending removal) */
  removableMarkets?: Set<string>;
}

export function QueueList({
  items,
  editing,
  mode,
  decimals,
  assetSymbol,
  onMove,
  onRemove,
  removableMarkets,
}: QueueListProps) {
  if (items.length === 0) {
    return <p className="text-text-tertiary text-sm py-4 text-center">Queue is empty.</p>;
  }

  return (
    <div className="space-y-0.5">
      {/* Header */}
      <div className="grid grid-cols-12 gap-2 text-[10px] text-text-tertiary uppercase px-2 py-1">
        <div className="col-span-1">#</div>
        <div className="col-span-4">Market</div>
        {mode === 'supply' ? (
          <>
            <div className="col-span-2 text-right">Cap</div>
            <div className="col-span-2 text-right">Supplied</div>
            <div className="col-span-1 text-right">APY</div>
          </>
        ) : (
          <>
            <div className="col-span-2 text-right">Supplied</div>
            <div className="col-span-2 text-right">Available</div>
            <div className="col-span-1 text-right">Liq %</div>
          </>
        )}
        <div className="col-span-2" />
      </div>

      {items.map((item, i) => {
        const capPct = item.supplyCap > 0n
          ? (Number(item.supplyAssets) / Number(item.supplyCap)) * 100
          : 0;
        const liqPct = item.supplyAssets > 0n
          ? (Number(item.availableLiquidity) / Number(item.supplyAssets)) * 100
          : 0;
        const highCap = capPct > 90;
        const canRemoveFromWithdraw = mode === 'withdraw' && removableMarkets?.has(item.marketId);

        return (
          <div
            key={`${item.marketId}-${i}`}
            className="grid grid-cols-12 gap-2 items-center px-2 py-2 bg-bg-hover/30 hover:bg-bg-hover/60 text-xs"
          >
            {/* Position */}
            <div className="col-span-1 font-mono text-text-tertiary">{i + 1}</div>

            {/* Market label */}
            <div className="col-span-4">
              <span className="text-text-primary">{item.label}</span>
              {highCap && mode === 'supply' && (
                <Badge variant="warning" className="ml-1 text-[9px]">NEAR CAP</Badge>
              )}
            </div>

            {mode === 'supply' ? (
              <>
                {/* Cap */}
                <div className="col-span-2 text-right font-mono text-text-primary">
                  {item.supplyCap > 0n
                    ? formatTokenAmount(item.supplyCap, decimals)
                    : '--'}
                </div>
                {/* Supplied + bar */}
                <div className="col-span-2 text-right">
                  <span className="font-mono text-text-primary">
                    {formatTokenAmount(item.supplyAssets, decimals)}
                  </span>
                  {item.supplyCap > 0n && (
                    <ProgressBar value={capPct} height="sm" className="mt-0.5" />
                  )}
                </div>
                {/* APY */}
                <div className="col-span-1 text-right font-mono text-text-secondary">
                  {item.supplyAPY > 0 ? `${(item.supplyAPY * 100).toFixed(1)}%` : '--'}
                </div>
              </>
            ) : (
              <>
                {/* Supplied */}
                <div className="col-span-2 text-right font-mono text-text-primary">
                  {formatTokenAmount(item.supplyAssets, decimals)}
                </div>
                {/* Available liquidity */}
                <div className="col-span-2 text-right font-mono text-text-primary">
                  {formatTokenAmount(item.availableLiquidity, decimals)}
                </div>
                {/* Liquidity ratio */}
                <div className="col-span-1 text-right font-mono text-text-secondary">
                  {liqPct.toFixed(0)}%
                </div>
              </>
            )}

            {/* Actions */}
            <div className="col-span-2 flex justify-end gap-0.5">
              {editing && onMove && (
                <>
                  <button
                    onClick={() => onMove(i, i - 1)}
                    disabled={i === 0}
                    className="p-1 text-text-tertiary hover:text-text-primary disabled:opacity-30 min-w-[28px] min-h-[28px] flex items-center justify-center"
                    aria-label="Move up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => onMove(i, i + 1)}
                    disabled={i === items.length - 1}
                    className="p-1 text-text-tertiary hover:text-text-primary disabled:opacity-30 min-w-[28px] min-h-[28px] flex items-center justify-center"
                    aria-label="Move down"
                  >
                    <ChevronDown size={14} />
                  </button>
                </>
              )}
              {editing && onRemove && (mode === 'supply' || canRemoveFromWithdraw) && (
                <button
                  onClick={() => onRemove(i)}
                  className="p-1 text-danger/60 hover:text-danger min-w-[28px] min-h-[28px] flex items-center justify-center"
                  aria-label="Remove from queue"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
