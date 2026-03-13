import { Lightbulb } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import type { QueueMarketItem } from './QueueList';

interface QueueSuggestionsProps {
  supplyQueue: QueueMarketItem[];
  withdrawQueue: QueueMarketItem[];
  onApplySupply: (reordered: QueueMarketItem[]) => void;
  onApplyWithdraw: (reordered: QueueMarketItem[]) => void;
  editing: boolean;
}

export function QueueSuggestions({
  supplyQueue,
  withdrawQueue,
  onApplySupply,
  onApplyWithdraw,
  editing,
}: QueueSuggestionsProps) {
  if (!editing) return null;

  // APY-optimized supply: highest APY first
  const apySorted = [...supplyQueue].sort((a, b) => b.supplyAPY - a.supplyAPY);
  const supplyChanged = apySorted.some((m, i) => m.marketId !== supplyQueue[i]?.marketId);

  // Liquidity-optimized withdraw: highest available liquidity first
  const liqSorted = [...withdrawQueue].sort(
    (a, b) => Number(b.availableLiquidity) - Number(a.availableLiquidity),
  );
  const withdrawChanged = liqSorted.some((m, i) => m.marketId !== withdrawQueue[i]?.marketId);

  if (!supplyChanged && !withdrawChanged) return null;

  return (
    <Card className="!p-3 bg-bg-hover/30">
      <div className="flex items-start gap-2 mb-2">
        <Lightbulb size={14} className="text-warning mt-0.5 shrink-0" />
        <span className="text-xs font-medium text-text-primary">Queue Suggestions</span>
      </div>
      <div className="space-y-2">
        {supplyChanged && (
          <div className="flex items-center justify-between text-xs">
            <div>
              <span className="text-text-secondary">Supply: sort by APY (descending)</span>
              <div className="text-[10px] text-text-tertiary mt-0.5">
                {apySorted.map((m, i) => (
                  <span key={m.marketId}>
                    {i > 0 && ' \u2192 '}
                    <span className={m.marketId !== supplyQueue[i]?.marketId ? 'text-accent-primary' : ''}>
                      {m.label.split(' ')[0]}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onApplySupply(apySorted)}>
              Apply
            </Button>
          </div>
        )}
        {withdrawChanged && (
          <div className="flex items-center justify-between text-xs">
            <div>
              <span className="text-text-secondary">Withdraw: sort by liquidity (descending)</span>
              <div className="text-[10px] text-text-tertiary mt-0.5">
                {liqSorted.map((m, i) => (
                  <span key={m.marketId}>
                    {i > 0 && ' \u2192 '}
                    <span className={m.marketId !== withdrawQueue[i]?.marketId ? 'text-accent-primary' : ''}>
                      {m.label.split(' ')[0]}
                    </span>
                  </span>
                ))}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onApplyWithdraw(liqSorted)}>
              Apply
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
