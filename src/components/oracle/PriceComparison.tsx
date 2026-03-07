import { useEffect, useState } from 'react';
import { usePublicClient, useChainId } from 'wagmi';
import type { Address } from 'viem';
import { Badge } from '../ui/Badge';
import { oracleAbi } from '../../lib/contracts/abis';
import { getMarketPrices } from '../../lib/pricing/defiLlama';

interface PriceComparisonProps {
  oracleAddress: Address;
  loanToken: Address;
  collateralToken: Address;
  loanSymbol?: string;
  collateralSymbol?: string;
  loanDecimals?: number;
  collateralDecimals?: number;
}

export function PriceComparison({
  oracleAddress,
  loanToken,
  collateralToken,
  loanSymbol = '?',
  collateralSymbol = '?',
  loanDecimals = 18,
  collateralDecimals = 18,
}: PriceComparisonProps) {
  const chainId = useChainId();
  const client = usePublicClient();

  const [oraclePrice, setOraclePrice] = useState<number | null>(null);
  const [llamaPrice, setLlamaPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client) return;
    setLoading(true);

    Promise.all([
      client.readContract({
        address: oracleAddress,
        abi: oracleAbi,
        functionName: 'price',
      }).catch(() => null),
      getMarketPrices(chainId, loanToken, collateralToken),
    ]).then(([rawPrice, prices]) => {
      if (rawPrice !== null) {
        const scale = 36 + loanDecimals - collateralDecimals;
        setOraclePrice(Number(rawPrice) / Math.pow(10, scale));
      }
      setLlamaPrice(prices.relativePrice);
      setLoading(false);
    });
  }, [client, oracleAddress, chainId, loanToken, collateralToken, loanDecimals, collateralDecimals]);

  const deviation = oraclePrice && llamaPrice
    ? Math.abs((oraclePrice - llamaPrice) / llamaPrice * 100)
    : null;

  const deviationColor = deviation === null
    ? 'text-text-tertiary'
    : deviation < 1 ? 'text-success'
    : deviation < 5 ? 'text-warning'
    : 'text-danger';

  if (loading) {
    return (
      <div className="bg-bg-hover rounded-md p-3 animate-shimmer h-20" />
    );
  }

  return (
    <div className="bg-bg-hover rounded-md p-3 space-y-1 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-tertiary uppercase">Oracle vs Market Price</span>
        {deviation !== null && (
          <Badge variant={deviation < 1 ? 'success' : deviation < 5 ? 'warning' : undefined}>
            {deviation.toFixed(2)}% Δ
          </Badge>
        )}
      </div>
      {oraclePrice !== null && (
        <p className="text-text-primary font-mono text-xs">
          Oracle: 1 {collateralSymbol} = {oraclePrice.toLocaleString('en-US', { maximumFractionDigits: 4 })} {loanSymbol}
        </p>
      )}
      {llamaPrice !== null && (
        <p className="text-text-secondary font-mono text-xs">
          DefiLlama: 1 {collateralSymbol} = {llamaPrice.toLocaleString('en-US', { maximumFractionDigits: 4 })} {loanSymbol}
        </p>
      )}
      {deviation !== null && (
        <p className={`text-xs ${deviationColor}`}>
          Deviation: {deviation.toFixed(2)}%
          {deviation < 1 ? ' ✓' : deviation < 5 ? ' ⚠' : ' ✗'}
        </p>
      )}
    </div>
  );
}
