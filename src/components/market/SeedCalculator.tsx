import { useState } from 'react';
import { Card, CardHeader, CardTitle } from '../ui/Card';

interface SeedCalculatorProps {
  oraclePrice: number;
  loanBalance: number;
  lltvWad: bigint;
  loanSymbol?: string;
  collateralSymbol?: string;
}

function calculateSeedParams(
  oraclePrice: number,
  loanBalance: number,
  lltvWad: bigint,
  targetUsageRate: number,
  supplyPercent: number
) {
  const vaultSupply = supplyPercent * loanBalance;
  const amountToBorrow = vaultSupply * targetUsageRate;
  const amountToBorrowInCollat = amountToBorrow / oraclePrice;
  const adjustedLLTV = (Number(lltvWad) - 2e16) / 1e18;
  const collatToSupply = amountToBorrowInCollat / adjustedLLTV;
  const ltv = amountToBorrow / (collatToSupply * oraclePrice);
  return { vaultSupply, collatToSupply, amountToBorrow, ltv };
}

export function SeedCalculator({
  oraclePrice,
  loanBalance,
  lltvWad,
  loanSymbol = 'LOAN',
  collateralSymbol = 'COLLAT',
}: SeedCalculatorProps) {
  const [usageRate, setUsageRate] = useState(90);
  const [supplyPct, setSupplyPct] = useState(10);

  const result = calculateSeedParams(
    oraclePrice,
    loanBalance,
    lltvWad,
    usageRate / 100,
    supplyPct / 100
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Seed Calculator</CardTitle>
      </CardHeader>

      <div className="space-y-4">
        <p className="text-xs text-text-tertiary">
          Calculate how much to supply/borrow to seed a new market at a target utilization.
        </p>

        <div>
          <label className="text-xs text-text-tertiary uppercase block mb-1">
            Target Usage Rate: {usageRate}%
          </label>
          <input
            type="range" min={10} max={99} step={1}
            value={usageRate}
            onChange={(e) => setUsageRate(Number(e.target.value))}
            className="w-full accent-accent-primary"
          />
        </div>

        <div>
          <label className="text-xs text-text-tertiary uppercase block mb-1">
            Supply % of Balance: {supplyPct}%
          </label>
          <input
            type="range" min={1} max={100} step={1}
            value={supplyPct}
            onChange={(e) => setSupplyPct(Number(e.target.value))}
            className="w-full accent-accent-primary"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-bg-hover p-3">
            <span className="text-[10px] text-text-tertiary uppercase block">Vault Supply</span>
            <p className="text-sm font-mono text-text-primary">
              {result.vaultSupply.toLocaleString('en-US', { maximumFractionDigits: 2 })} {loanSymbol}
            </p>
          </div>
          <div className="bg-bg-hover p-3">
            <span className="text-[10px] text-text-tertiary uppercase block">Collateral to Supply</span>
            <p className="text-sm font-mono text-text-primary">
              {result.collatToSupply.toLocaleString('en-US', { maximumFractionDigits: 6 })} {collateralSymbol}
            </p>
          </div>
          <div className="bg-bg-hover p-3">
            <span className="text-[10px] text-text-tertiary uppercase block">Amount to Borrow</span>
            <p className="text-sm font-mono text-text-primary">
              {result.amountToBorrow.toLocaleString('en-US', { maximumFractionDigits: 2 })} {loanSymbol}
            </p>
          </div>
          <div className="bg-bg-hover p-3">
            <span className="text-[10px] text-text-tertiary uppercase block">Effective LTV</span>
            <p className={`text-sm font-mono ${result.ltv < Number(lltvWad) / 1e18 ? 'text-success' : 'text-danger'}`}>
              {(result.ltv * 100).toFixed(2)}%
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}
