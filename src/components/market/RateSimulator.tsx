import { useState, useEffect, useRef } from 'react';
import { usePublicClient, useChainId } from 'wagmi';
import type { Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { getChainConfig } from '../../config/chains';
import { simulateRateAtUtilization, type RateSimulationResult } from '../../lib/market/rateSimulator';

interface RateSimulatorProps {
  marketId: `0x${string}`;
}

export function RateSimulator({ marketId }: RateSimulatorProps) {
  const chainId = useChainId();
  const client = usePublicClient();
  const chainConfig = getChainConfig(chainId);

  const [targetUtil, setTargetUtil] = useState(75);
  const [result, setResult] = useState<RateSimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!client || !chainConfig) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await simulateRateAtUtilization(
          client,
          chainConfig.morphoBlue as Address,
          marketId,
          targetUtil
        );
        setResult(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Simulation failed');
      }
      setLoading(false);
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [targetUtil, client, chainConfig, marketId]);

  const delta = result ? result.simulatedBorrowRate - result.currentBorrowRate : 0;
  const deltaColor = delta < -0.01 ? 'text-success' : delta > 0.01 ? 'text-danger' : 'text-text-tertiary';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate Simulator</CardTitle>
        {loading && <Badge variant="warning">Simulating...</Badge>}
      </CardHeader>

      <div className="space-y-4">
        <div>
          <label className="text-xs text-text-tertiary uppercase block mb-2">
            Target Utilization: {targetUtil}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={targetUtil}
            onChange={(e) => setTargetUtil(Number(e.target.value))}
            className="w-full accent-accent-primary"
          />
          <div className="flex justify-between text-[10px] text-text-tertiary mt-1">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        {error && (
          <p className="text-xs text-danger">{error}</p>
        )}

        {result && (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-bg-hover p-3">
              <span className="text-[10px] text-text-tertiary uppercase block">Current</span>
              <p className="text-sm text-text-secondary">Utilization: {result.currentUtilization.toFixed(1)}%</p>
              <p className="text-lg font-mono text-text-primary">{result.currentBorrowRate.toFixed(2)}% APR</p>
            </div>
            <div className="bg-bg-hover p-3">
              <span className="text-[10px] text-text-tertiary uppercase block">Simulated</span>
              <p className="text-sm text-text-secondary">Utilization: {targetUtil}%</p>
              <p className="text-lg font-mono text-text-primary">{result.simulatedBorrowRate.toFixed(2)}% APR</p>
            </div>
          </div>
        )}

        {result && (
          <p className={`text-xs ${deltaColor}`}>
            {delta > 0 ? '+' : ''}{delta.toFixed(2)}% difference
            {Math.abs(delta) < 0.01 ? ' (same)' : delta < 0 ? ' (lower)' : ' (higher)'}
          </p>
        )}
      </div>
    </Card>
  );
}
