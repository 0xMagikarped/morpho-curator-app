import { useEffect, useState } from 'react';
import { usePublicClient, useChainId } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { getChainConfig } from '../../config/chains';
import { computeMarketId, checkMarketExists } from '../../lib/market/createMarket';
import { getMarketPrices } from '../../lib/pricing/defiLlama';
import { oracleAbi } from '../../lib/contracts/abis';
import { truncateAddress } from '../../lib/utils/format';
import type { MarketFormData } from './MarketForm';

interface MarketPreviewProps {
  data: MarketFormData;
  onBack: () => void;
  onDeploy: () => void;
}

export function MarketPreview({ data, onBack, onDeploy }: MarketPreviewProps) {
  const chainId = useChainId();
  const client = usePublicClient();
  const chainConfig = getChainConfig(chainId);

  const marketId = computeMarketId(data);

  const [exists, setExists] = useState<boolean | null>(null);
  const [oraclePrice, setOraclePrice] = useState<bigint | null>(null);
  const [llamaPrice, setLlamaPrice] = useState<number | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!client || !chainConfig) return;
    setChecking(true);

    Promise.all([
      checkMarketExists(client, chainConfig.morphoBlue, marketId),
      client
        .readContract({
          address: data.oracle,
          abi: oracleAbi,
          functionName: 'price',
        })
        .catch(() => null),
      getMarketPrices(chainId, data.loanToken, data.collateralToken),
    ]).then(([marketExists, price, prices]) => {
      setExists(marketExists);
      setOraclePrice(price as bigint | null);
      setLlamaPrice(prices.relativePrice);
      setChecking(false);
    });
  }, [client, chainConfig, marketId, data, chainId]);

  const lltvPercent = ((Number(data.lltv) / 1e18) * 100).toFixed(2);

  const oraclePriceFormatted =
    oraclePrice !== null && data.loanTokenMeta && data.collateralTokenMeta
      ? (
          Number(oraclePrice) /
          Math.pow(10, 36 + data.loanTokenMeta.decimals - data.collateralTokenMeta.decimals)
        ).toFixed(4)
      : null;

  const deviation =
    oraclePriceFormatted && llamaPrice
      ? Math.abs(((parseFloat(oraclePriceFormatted) - llamaPrice) / llamaPrice) * 100)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Preview</CardTitle>
        <Badge variant="info">Pre-deploy</Badge>
      </CardHeader>

      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-[10px] text-text-tertiary uppercase">Loan Token</span>
            <p className="font-mono text-text-primary">
              {data.loanTokenMeta?.symbol ?? truncateAddress(data.loanToken)}
              <span className="text-text-tertiary ml-1">
                ({data.loanTokenMeta?.decimals ?? '?'} dec)
              </span>
            </p>
          </div>
          <div>
            <span className="text-[10px] text-text-tertiary uppercase">Collateral Token</span>
            <p className="font-mono text-text-primary">
              {data.collateralTokenMeta?.symbol ?? truncateAddress(data.collateralToken)}
              <span className="text-text-tertiary ml-1">
                ({data.collateralTokenMeta?.decimals ?? '?'} dec)
              </span>
            </p>
          </div>
        </div>

        <div>
          <span className="text-[10px] text-text-tertiary uppercase">Oracle</span>
          <p className="font-mono text-text-primary text-xs">{data.oracle}</p>
          {oraclePriceFormatted && (
            <p className="text-xs text-text-secondary mt-0.5">
              Price: 1 {data.collateralTokenMeta?.symbol} = {oraclePriceFormatted}{' '}
              {data.loanTokenMeta?.symbol}
            </p>
          )}
          {llamaPrice !== null && (
            <p className="text-xs text-text-secondary">
              DefiLlama: {llamaPrice.toFixed(4)}
              {deviation !== null && (
                <span
                  className={`ml-1 ${deviation < 1 ? 'text-success' : deviation < 5 ? 'text-warning' : 'text-danger'}`}
                >
                  ({deviation.toFixed(2)}% delta)
                </span>
              )}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="text-[10px] text-text-tertiary uppercase">IRM</span>
            <p className="font-mono text-text-primary text-xs">{truncateAddress(data.irm)}</p>
            <p className="text-[10px] text-text-tertiary">Adaptive Curve</p>
          </div>
          <div>
            <span className="text-[10px] text-text-tertiary uppercase">LLTV</span>
            <p className="font-mono text-text-primary">{lltvPercent}%</p>
          </div>
        </div>

        <div className="bg-bg-hover p-3">
          <span className="text-[10px] text-text-tertiary uppercase">Computed Market ID</span>
          <p className="font-mono text-xs text-accent-primary break-all mt-0.5">{marketId}</p>
        </div>

        <div className="bg-bg-hover p-3">
          <span className="text-[10px] text-text-tertiary uppercase">Market Existence Check</span>
          {checking ? (
            <p className="text-xs text-text-tertiary mt-0.5">Checking...</p>
          ) : exists ? (
            <p className="text-xs text-danger mt-0.5">Market already exists</p>
          ) : (
            <p className="text-xs text-success mt-0.5">Market does not exist yet</p>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onDeploy} disabled={exists === true || checking} className="flex-1">
            Deploy Market
          </Button>
        </div>
      </div>
    </Card>
  );
}
