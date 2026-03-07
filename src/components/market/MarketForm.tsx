import { useState, useEffect } from 'react';
import { isAddress, type Address } from 'viem';
import { useChainId, usePublicClient } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { getChainConfig } from '../../config/chains';
import { erc20Abi } from '../../lib/contracts/abis';

interface TokenMeta {
  name: string;
  symbol: string;
  decimals: number;
}

export interface MarketFormData {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
  loanTokenMeta: TokenMeta | null;
  collateralTokenMeta: TokenMeta | null;
}

interface MarketFormProps {
  onSubmit: (data: MarketFormData) => void;
}

const LLTV_PRESETS = [
  { label: '94.5%', value: 945000000000000000n, desc: 'Stablecoin' },
  { label: '91.5%', value: 915000000000000000n, desc: 'High' },
  { label: '86.0%', value: 860000000000000000n, desc: 'Standard' },
  { label: '80.0%', value: 800000000000000000n, desc: 'Medium' },
  { label: '77.0%', value: 770000000000000000n, desc: 'Conservative' },
  { label: '62.5%', value: 625000000000000000n, desc: 'Low' },
];

export function MarketForm({ onSubmit }: MarketFormProps) {
  const chainId = useChainId();
  const client = usePublicClient();
  const chainConfig = getChainConfig(chainId);

  const [loanToken, setLoanToken] = useState('');
  const [collateralToken, setCollateralToken] = useState('');
  const [oracle, setOracle] = useState('');
  const [irm, setIrm] = useState(chainConfig?.periphery.adaptiveCurveIrm ?? '');
  const [lltvPreset, setLltvPreset] = useState<string>('860000000000000000');
  const [customLltv, setCustomLltv] = useState('');
  const [useCustomLltv, setUseCustomLltv] = useState(false);

  const [loanMeta, setLoanMeta] = useState<TokenMeta | null>(null);
  const [collatMeta, setCollatMeta] = useState<TokenMeta | null>(null);
  const [loadingLoan, setLoadingLoan] = useState(false);
  const [loadingCollat, setLoadingCollat] = useState(false);

  // Update IRM when chain changes
  useEffect(() => {
    if (chainConfig?.periphery.adaptiveCurveIrm) {
      setIrm(chainConfig.periphery.adaptiveCurveIrm);
    }
  }, [chainConfig]);

  // Fetch ERC-20 metadata
  const fetchTokenMeta = async (
    address: string,
    setter: (m: TokenMeta | null) => void,
    setLoading: (b: boolean) => void,
  ) => {
    if (!isAddress(address) || !client) {
      setter(null);
      return;
    }
    setLoading(true);
    try {
      const [name, symbol, decimals] = await Promise.all([
        client.readContract({ address: address as Address, abi: erc20Abi, functionName: 'name' }),
        client.readContract({ address: address as Address, abi: erc20Abi, functionName: 'symbol' }),
        client.readContract({ address: address as Address, abi: erc20Abi, functionName: 'decimals' }),
      ]);
      setter({ name: name as string, symbol: symbol as string, decimals: Number(decimals) });
    } catch {
      setter(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => fetchTokenMeta(loanToken, setLoanMeta, setLoadingLoan), 500);
    return () => clearTimeout(timer);
  }, [loanToken, client]);

  useEffect(() => {
    const timer = setTimeout(() => fetchTokenMeta(collateralToken, setCollatMeta, setLoadingCollat), 500);
    return () => clearTimeout(timer);
  }, [collateralToken, client]);

  const lltv = useCustomLltv
    ? BigInt(Math.round(parseFloat(customLltv || '0') * 1e16)) * 100n
    : BigInt(lltvPreset);

  const isValid =
    isAddress(loanToken) &&
    isAddress(collateralToken) &&
    isAddress(oracle) &&
    isAddress(irm) &&
    lltv > 0n;

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit({
      loanToken: loanToken as Address,
      collateralToken: collateralToken as Address,
      oracle: oracle as Address,
      irm: irm as Address,
      lltv,
      loanTokenMeta: loanMeta,
      collateralTokenMeta: collatMeta,
    });
  };

  const inputClass =
    'w-full bg-bg-elevated border border-border-default rounded-md px-3 py-2 text-sm font-mono text-text-primary placeholder-text-tertiary focus:border-border-focus focus:outline-none';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Parameters</CardTitle>
        {chainConfig && <Badge variant="info">{chainConfig.name}</Badge>}
      </CardHeader>

      <div className="space-y-4">
        {/* Loan Token */}
        <div>
          <label className="text-xs text-text-tertiary uppercase block mb-1">Loan Token</label>
          <input
            type="text"
            placeholder="0x..."
            value={loanToken}
            onChange={(e) => setLoanToken(e.target.value)}
            className={inputClass}
          />
          {loadingLoan && (
            <span className="text-xs text-text-tertiary mt-1 block">Loading...</span>
          )}
          {loanMeta && (
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="success">{loanMeta.symbol}</Badge>
              <span className="text-xs text-text-secondary">
                {loanMeta.name} ({loanMeta.decimals} dec)
              </span>
            </div>
          )}
        </div>

        {/* Collateral Token */}
        <div>
          <label className="text-xs text-text-tertiary uppercase block mb-1">Collateral Token</label>
          <input
            type="text"
            placeholder="0x..."
            value={collateralToken}
            onChange={(e) => setCollateralToken(e.target.value)}
            className={inputClass}
          />
          {loadingCollat && (
            <span className="text-xs text-text-tertiary mt-1 block">Loading...</span>
          )}
          {collatMeta && (
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="success">{collatMeta.symbol}</Badge>
              <span className="text-xs text-text-secondary">
                {collatMeta.name} ({collatMeta.decimals} dec)
              </span>
            </div>
          )}
        </div>

        {/* Oracle */}
        <div>
          <label className="text-xs text-text-tertiary uppercase block mb-1">Oracle</label>
          <input
            type="text"
            placeholder="0x..."
            value={oracle}
            onChange={(e) => setOracle(e.target.value)}
            className={inputClass}
          />
        </div>

        {/* IRM */}
        <div>
          <label className="text-xs text-text-tertiary uppercase block mb-1">
            IRM (Interest Rate Model)
          </label>
          <input
            type="text"
            value={irm}
            onChange={(e) => setIrm(e.target.value)}
            className={inputClass}
          />
          <span className="text-[10px] text-text-tertiary mt-0.5 block">
            Pre-filled with Adaptive Curve IRM from chain config
          </span>
        </div>

        {/* LLTV */}
        <div>
          <label className="text-xs text-text-tertiary uppercase block mb-1">
            LLTV (Liquidation LTV)
          </label>
          {!useCustomLltv ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {LLTV_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setLltvPreset(p.value.toString())}
                    className={`px-3 py-2 rounded-md text-sm border transition-colors ${
                      lltvPreset === p.value.toString()
                        ? 'border-accent-primary bg-accent-primary-muted text-text-primary'
                        : 'border-border-default bg-bg-hover text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <span className="font-medium">{p.label}</span>
                    <span className="text-[10px] text-text-tertiary block">{p.desc}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setUseCustomLltv(true)}
                className="text-xs text-info hover:text-info/80"
              >
                Use custom LLTV
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="86.0"
                  step="0.1"
                  value={customLltv}
                  onChange={(e) => setCustomLltv(e.target.value)}
                  className={`${inputClass} w-32`}
                />
                <span className="text-sm text-text-secondary">%</span>
              </div>
              <button
                onClick={() => {
                  setUseCustomLltv(false);
                  setCustomLltv('');
                }}
                className="text-xs text-info hover:text-info/80"
              >
                Use preset LLTV
              </button>
            </div>
          )}
        </div>

        <Button onClick={handleSubmit} disabled={!isValid} className="w-full">
          Preview Market
        </Button>
      </div>
    </Card>
  );
}
