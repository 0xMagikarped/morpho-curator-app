import { useMemo } from 'react';
import { CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { useMarketScanner } from '../../../lib/hooks/useMarketScanner';
import { truncateAddress, formatWadPercent } from '../../../lib/utils/format';
import type { StepProps } from '../CreateVaultWizard';
import type { MarketParamsStruct } from '../../../lib/vault/createVault';
import type { MarketRecord } from '../../../lib/indexer/indexedDB';

export function MarketsStep({ state, onUpdate, onNext, onBack }: StepProps) {
  const { data: markets, isLoading } = useMarketScanner(state.chainId ?? undefined);

  // Filter markets by the selected loan asset
  const matchingMarkets = useMemo(() => {
    if (!markets || !state.asset) return [];
    return markets.filter(
      (m) => m.loanToken.toLowerCase() === state.asset!.toLowerCase(),
    );
  }, [markets, state.asset]);

  const isSelected = (marketId: string) =>
    state.selectedMarkets.some(
      (sm) =>
        sm.marketParams.collateralToken.toLowerCase() ===
          matchingMarkets.find((m) => m.marketId === marketId)?.collateralToken.toLowerCase() &&
        sm.marketParams.lltv.toString() ===
          matchingMarkets.find((m) => m.marketId === marketId)?.lltv,
    );

  const toggleMarket = (market: MarketRecord) => {
    const existing = state.selectedMarkets.findIndex(
      (sm) =>
        sm.marketParams.collateralToken.toLowerCase() === market.collateralToken.toLowerCase() &&
        sm.marketParams.lltv.toString() === market.lltv,
    );

    if (existing >= 0) {
      onUpdate({
        selectedMarkets: state.selectedMarkets.filter((_, i) => i !== existing),
      });
    } else {
      const mp: MarketParamsStruct = {
        loanToken: market.loanToken as `0x${string}`,
        collateralToken: market.collateralToken as `0x${string}`,
        oracle: market.oracle as `0x${string}`,
        irm: market.irm as `0x${string}`,
        lltv: BigInt(market.lltv),
      };
      onUpdate({
        selectedMarkets: [
          ...state.selectedMarkets,
          {
            marketParams: mp,
            supplyCap: '',
            collateralSymbol: market.collateralTokenSymbol ?? truncateAddress(market.collateralToken),
            lltv: market.lltv,
          },
        ],
      });
    }
  };

  const updateCap = (index: number, cap: string) => {
    const updated = [...state.selectedMarkets];
    updated[index] = { ...updated[index], supplyCap: cap };
    onUpdate({ selectedMarkets: updated });
  };

  return (
    <div className="space-y-6">
      <CardHeader>
        <CardTitle>Initial Markets & Caps</CardTitle>
        <span className="text-xs text-text-tertiary">Optional — can add markets after deployment</span>
      </CardHeader>

      {isLoading ? (
        <div className="text-sm text-text-tertiary animate-shimmer py-4 text-center">
          Loading {state.assetSymbol} markets...
        </div>
      ) : matchingMarkets.length === 0 ? (
        <div className="text-sm text-text-tertiary py-4 text-center">
          No {state.assetSymbol} markets found. You can add markets after deployment.
        </div>
      ) : (
        <div className="space-y-1">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 text-[10px] uppercase text-text-tertiary px-3 py-1">
            <div className="col-span-1"></div>
            <div className="col-span-3">Collateral</div>
            <div className="col-span-2">LLTV</div>
            <div className="col-span-2">Oracle</div>
            <div className="col-span-4">Supply Cap ({state.assetSymbol})</div>
          </div>

          {matchingMarkets.map((market) => {
            const selected = isSelected(market.marketId);
            const selectedIdx = state.selectedMarkets.findIndex(
              (sm) =>
                sm.marketParams.collateralToken.toLowerCase() === market.collateralToken.toLowerCase() &&
                sm.marketParams.lltv.toString() === market.lltv,
            );
            const oracleIsZero = market.oracle === '0x0000000000000000000000000000000000000000';

            return (
              <div
                key={market.marketId}
                className={`grid grid-cols-12 gap-2 items-center px-3 py-2 transition-colors ${
                  selected ? 'bg-accent-primary-muted border border-accent-primary/30' : 'hover:bg-bg-hover/40'
                }`}
              >
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleMarket(market)}
                    className="accent-blue-500"
                  />
                </div>
                <div className="col-span-3 text-sm text-text-primary">
                  {market.collateralTokenSymbol ?? truncateAddress(market.collateralToken)}
                </div>
                <div className="col-span-2">
                  <Badge>{formatWadPercent(BigInt(market.lltv))}</Badge>
                </div>
                <div className="col-span-2">
                  {oracleIsZero ? (
                    <Badge variant="warning">None</Badge>
                  ) : (
                    <span className="text-xs text-text-secondary font-mono">
                      {truncateAddress(market.oracle)}
                    </span>
                  )}
                </div>
                <div className="col-span-4">
                  {selected && (
                    <input
                      type="text"
                      value={state.selectedMarkets[selectedIdx]?.supplyCap ?? ''}
                      onChange={(e) => updateCap(selectedIdx, e.target.value)}
                      placeholder="e.g., 50000"
                      className="w-full bg-bg-hover border border-border-default px-2 py-1 text-sm text-text-primary placeholder-text-tertiary"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {state.selectedMarkets.length > 0 && (
        <div className="text-xs text-text-tertiary">
          Selected: {state.selectedMarkets.length} market
          {state.selectedMarkets.length !== 1 ? 's' : ''}
          {state.initialTimelockSeconds === 0 && (
            <span className="text-success ml-2">
              Caps set instantly (timelock = 0)
            </span>
          )}
          {state.initialTimelockSeconds > 0 && (
            <span className="text-warning ml-2">
              Cap increases will require timelock wait
            </span>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}
