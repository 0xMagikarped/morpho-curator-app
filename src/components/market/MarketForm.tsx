import { useState, useEffect, useMemo } from 'react';
import { isAddress, type Address } from 'viem';
import { useChainId, usePublicClient } from 'wagmi';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { getChainConfig } from '../../config/chains';
import { erc20Abi } from '../../lib/contracts/abis';
import {
  getBrokers,
  getBrokersForLoanSymbol,
  getDefaultRateCalculator,
  aprPercentToRatePerSecond,
  type BrokerInfo,
} from '../../config/moolah';

interface TokenMeta {
  name: string;
  symbol: string;
  decimals: number;
}

export type RateModel = 'variable' | 'fixed';

/**
 * Fixed-term data is optional — only populated when `rateModel === 'fixed'`.
 * Matches Moolah's `FixedTermMarketParams` struct one-to-one.
 */
export interface FixedTermData {
  broker: Address;
  rateCalculator: Address;
  ratePerSecond: bigint;
  maxRatePerSecond: bigint;
  /** Non-authoritative — the form's human-entered APR % for display. */
  aprPercent: number;
  brokerLabel: string;
}

export interface MarketFormData {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
  loanTokenMeta: TokenMeta | null;
  collateralTokenMeta: TokenMeta | null;
  rateModel: RateModel;
  fixedTerm?: FixedTermData;
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

  // -- Fixed-term (Moolah only) --------------------------------------------
  const isMoolah = chainConfig?.protocol === 'moolah';
  const brokers = useMemo(() => (chainId ? getBrokers(chainId) : []), [chainId]);
  const fixedTermAvailable = isMoolah && brokers.length > 0;
  /**
   * Broker dropdown is filtered by the form's loan-token symbol. A
   * curator picking USD1 never sees the WBNB/lisUSD broker, eliminating
   * a class of guaranteed-revert mistakes.
   */
  const brokersForLoan = useMemo(() => {
    if (!chainId || !loanMeta?.symbol) return [];
    return getBrokersForLoanSymbol(chainId, loanMeta.symbol);
  }, [chainId, loanMeta?.symbol]);

  const [rateModel, setRateModel] = useState<RateModel>('variable');
  const [brokerAddress, setBrokerAddress] = useState<Address | ''>('');
  const [aprPercent, setAprPercent] = useState<string>('5');
  const [infoDismissed, setInfoDismissed] = useState(
    typeof window !== 'undefined' &&
      window.localStorage.getItem('moolah:fixedTermInfoDismissed') === '1',
  );

  // Auto-switch back to variable if the curator changes chain away from Moolah
  useEffect(() => {
    if (!fixedTermAvailable && rateModel === 'fixed') setRateModel('variable');
  }, [fixedTermAvailable, rateModel]);

  // Clear the broker selection if the loan token changed + the selected
  // broker isn't valid for the new symbol.
  useEffect(() => {
    if (!brokerAddress) return;
    const stillValid = brokersForLoan.some(
      (b) => b.address.toLowerCase() === brokerAddress.toLowerCase(),
    );
    if (!stillValid) setBrokerAddress('');
  }, [brokerAddress, brokersForLoan]);

  const selectedBroker: BrokerInfo | null = useMemo(() => {
    if (rateModel !== 'fixed' || !brokerAddress) return null;
    return brokers.find((b) => b.address.toLowerCase() === brokerAddress.toLowerCase()) ?? null;
  }, [rateModel, brokerAddress, brokers]);

  const rateCalculator = useMemo(
    () => (chainId ? getDefaultRateCalculator(chainId) : null),
    [chainId],
  );

  // Update IRM when chain changes
  useEffect(() => {
    if (chainConfig?.periphery.adaptiveCurveIrm) {
      setIrm(chainConfig.periphery.adaptiveCurveIrm);
    }
  }, [chainConfig]);

  // Fetch ERC-20 metadata
  useEffect(() => {
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

    const timer = setTimeout(() => fetchTokenMeta(loanToken, setLoanMeta, setLoadingLoan), 500);
    return () => clearTimeout(timer);
  }, [loanToken, client]);

  useEffect(() => {
    const fetchCollatMeta = async () => {
      if (!isAddress(collateralToken) || !client) {
        setCollatMeta(null);
        return;
      }
      setLoadingCollat(true);
      try {
        const [name, symbol, decimals] = await Promise.all([
          client.readContract({ address: collateralToken as Address, abi: erc20Abi, functionName: 'name' }),
          client.readContract({ address: collateralToken as Address, abi: erc20Abi, functionName: 'symbol' }),
          client.readContract({ address: collateralToken as Address, abi: erc20Abi, functionName: 'decimals' }),
        ]);
        setCollatMeta({ name: name as string, symbol: symbol as string, decimals: Number(decimals) });
      } catch {
        setCollatMeta(null);
      }
      setLoadingCollat(false);
    };

    const timer = setTimeout(() => fetchCollatMeta(), 500);
    return () => clearTimeout(timer);
  }, [collateralToken, client]);

  const lltv = useMemo(() => {
    // Fixed-term: LLTV is locked by the broker.
    if (rateModel === 'fixed' && selectedBroker) {
      return BigInt(Math.round(selectedBroker.lltvPercent * 1e18));
    }
    return useCustomLltv
      ? BigInt(Math.round(parseFloat(customLltv || '0') * 1e16)) * 100n
      : BigInt(lltvPreset);
  }, [rateModel, selectedBroker, useCustomLltv, customLltv, lltvPreset]);

  // APR → bigint (WAD per second). Max rate defaults to 2× the target APR
  // (Lista's convention — keeps the borrower from being gouged if rate drifts).
  const aprNumber = parseFloat(aprPercent || '0');
  const ratePerSecond = useMemo(() => aprPercentToRatePerSecond(aprNumber), [aprNumber]);
  const maxRatePerSecond = useMemo(() => aprPercentToRatePerSecond(aprNumber * 2), [aprNumber]);

  const isVariableValid =
    isAddress(loanToken) &&
    isAddress(collateralToken) &&
    isAddress(oracle) &&
    isAddress(irm) &&
    lltv > 0n;

  /**
   * Per DC2 the factory enforces 18-dec on both sides of a fixed-term
   * market. We preflight client-side so the curator doesn't burn a
   * simulation on a guaranteed revert.
   */
  const fixedDecimalsOk =
    loanMeta?.decimals === 18 && collatMeta?.decimals === 18;

  const isFixedValid =
    selectedBroker !== null &&
    rateCalculator !== null &&
    aprNumber > 0 &&
    aprNumber <= 100 &&
    ratePerSecond > 0n &&
    fixedDecimalsOk;

  const isValid = rateModel === 'variable' ? isVariableValid : isFixedValid;

  const fixedInvalidReason =
    rateModel !== 'fixed'
      ? null
      : !loanMeta || !collatMeta
        ? 'Loan and collateral tokens must be set first.'
        : !fixedDecimalsOk
          ? 'Fixed-term markets require 18-decimal tokens on both sides.'
          : brokersForLoan.length === 0
            ? `No brokers registered for ${loanMeta.symbol}. Switch to Variable rate.`
            : !selectedBroker
              ? 'Select a broker.'
              : aprNumber <= 0 || aprNumber > 100
                ? 'APR must be between 0% and 100%.'
                : null;

  const handleSubmit = () => {
    if (!isValid) return;

    // Fixed-term path: broker drives loan/collateral/LLTV; oracle is
    // unused (createFixedTermMarket doesn't take one); IRM = rateCalculator.
    if (rateModel === 'fixed' && selectedBroker && rateCalculator) {
      const loanAddr = chainConfig?.stablecoins.find(
        (t) => t.symbol.toLowerCase() === selectedBroker.loanSymbol.toLowerCase(),
      )?.address ?? (chainConfig?.nativeToken.symbol.toLowerCase() === selectedBroker.loanSymbol.toLowerCase()
        ? chainConfig?.nativeToken.wrapped
        : undefined);
      onSubmit({
        loanToken: (loanAddr ?? '0x0000000000000000000000000000000000000000') as Address,
        collateralToken: '0x0000000000000000000000000000000000000000' as Address,
        oracle: '0x0000000000000000000000000000000000000000' as Address,
        irm: rateCalculator.address,
        lltv,
        loanTokenMeta: null,
        collateralTokenMeta: null,
        rateModel: 'fixed',
        fixedTerm: {
          broker: selectedBroker.address,
          rateCalculator: rateCalculator.address,
          ratePerSecond,
          maxRatePerSecond,
          aprPercent: aprNumber,
          brokerLabel: selectedBroker.label,
        },
      });
      return;
    }

    onSubmit({
      loanToken: loanToken as Address,
      collateralToken: collateralToken as Address,
      oracle: oracle as Address,
      irm: irm as Address,
      lltv,
      loanTokenMeta: loanMeta,
      collateralTokenMeta: collatMeta,
      rateModel: 'variable',
    });
  };

  const dismissInfoPanel = () => {
    try {
      window.localStorage.setItem('moolah:fixedTermInfoDismissed', '1');
    } catch { /* localStorage disabled */ }
    setInfoDismissed(true);
  };

  const inputClass =
    'w-full bg-bg-elevated border border-border-default px-3 py-2 text-sm font-mono text-text-primary placeholder-text-tertiary focus:border-border-focus focus:outline-none';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Market Parameters</CardTitle>
        {chainConfig && <Badge variant="info">{chainConfig.name}</Badge>}
      </CardHeader>

      <div className="space-y-4">
        {/* Rate model toggle (Moolah only) */}
        {fixedTermAvailable && (
          <div>
            <label className="text-xs text-text-tertiary uppercase block mb-1">Rate model</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRateModel('variable')}
                className={`flex-1 px-3 py-2 text-sm border transition-colors ${
                  rateModel === 'variable'
                    ? 'border-accent-primary bg-accent-primary-muted text-text-primary'
                    : 'border-border-default bg-bg-hover text-text-secondary hover:text-text-primary'
                }`}
              >
                Variable
                <span className="text-[10px] text-text-tertiary block">AdaptiveCurveIRM</span>
              </button>
              <button
                type="button"
                onClick={() => setRateModel('fixed')}
                className={`flex-1 px-3 py-2 text-sm border transition-colors ${
                  rateModel === 'fixed'
                    ? 'border-[#F0B90B] bg-[#F0B90B]/10 text-text-primary'
                    : 'border-border-default bg-bg-hover text-text-secondary hover:text-text-primary'
                }`}
              >
                Fixed term
                <span className="text-[10px] text-text-tertiary block">Broker</span>
              </button>
            </div>
          </div>
        )}

        {rateModel === 'fixed' && !infoDismissed && (
          <div className="px-3 py-2 bg-[#F0B90B]/5 border border-[#F0B90B]/20 text-[11px] text-text-secondary space-y-1">
            <div>
              Fixed-term markets lock borrowers in at a fixed APR for a
              specific term (Lista supports 7 / 14 / 30 days, chosen by the
              borrower at origination). Unlike variable markets, the rate
              does not track utilization.
            </div>
            <div>
              Early repayment incurs a penalty. At maturity, open positions
              auto-convert to variable-rate accounting. Size caps with the
              full term in mind — a 30-day term means withdrawals can be
              delayed up to 30 days if utilization is high.
            </div>
            <button
              type="button"
              onClick={dismissInfoPanel}
              className="text-[10px] text-text-tertiary hover:text-text-primary underline"
            >
              Got it, don't show again
            </button>
          </div>
        )}

        {rateModel === 'fixed' && (
          <div className="space-y-3 border border-[#F0B90B]/20 p-3 bg-[#F0B90B]/[0.02]">
            {/* Broker picker — filtered by the form's loan-token symbol */}
            <div>
              <label className="text-xs text-text-tertiary uppercase block mb-1">Broker (market pair)</label>
              <select
                value={brokerAddress}
                onChange={(e) => setBrokerAddress(e.target.value as Address)}
                className={`${inputClass} appearance-none`}
                disabled={!loanMeta || brokersForLoan.length === 0}
              >
                {!loanMeta ? (
                  <option value="">Select loan token first</option>
                ) : brokersForLoan.length === 0 ? (
                  <option value="">
                    No brokers registered for {loanMeta.symbol}. Variable rate only.
                  </option>
                ) : (
                  <>
                    <option value="">— Select a broker —</option>
                    {brokersForLoan.map((b) => (
                      <option key={b.address} value={b.address}>
                        {b.label} · LLTV {(b.lltvPercent * 100).toFixed(1)}%
                        {b.capHumanReadable ? ` · cap ${b.capHumanReadable}` : ''}
                      </option>
                    ))}
                  </>
                )}
              </select>
              {selectedBroker && (
                <div className="text-[10px] text-text-tertiary mt-1 font-mono">
                  Broker: {selectedBroker.address.slice(0, 8)}…{selectedBroker.address.slice(-6)}
                </div>
              )}
            </div>

            {/* Rate calculator (read-only — only one deployed) */}
            <div>
              <label className="text-xs text-text-tertiary uppercase block mb-1">Rate calculator</label>
              {rateCalculator ? (
                <div className="px-3 py-2 bg-bg-hover border border-border-subtle text-[12px] font-mono">
                  {rateCalculator.label}
                  <span className="ml-2 text-text-tertiary">
                    {rateCalculator.address.slice(0, 8)}…{rateCalculator.address.slice(-6)}
                  </span>
                </div>
              ) : (
                <div className="text-[11px] text-warning">No rate calculator registered for this chain.</div>
              )}
            </div>

            {/* APR input */}
            <div>
              <label className="text-xs text-text-tertiary uppercase block mb-1">
                Target APR (% fixed)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={aprPercent}
                  onChange={(e) => setAprPercent(e.target.value)}
                  className={`${inputClass} w-32`}
                />
                <span className="text-sm text-text-secondary">%</span>
              </div>
              <div className="text-[10px] text-text-tertiary mt-0.5">
                Borrowers lock this rate for their chosen term. Max rate (safety cap) = 2× target = {(aprNumber * 2).toFixed(2)}%.
              </div>
            </div>

            {/* Summary */}
            {selectedBroker && aprNumber > 0 && (
              <div className="text-[11px] text-text-secondary">
                Borrowers will lock in <span className="font-mono text-text-primary">{aprNumber.toFixed(2)}%</span> APR
                on a <span className="font-mono text-text-primary">{selectedBroker.label}</span> position,
                up to LLTV <span className="font-mono text-text-primary">{(selectedBroker.lltvPercent * 100).toFixed(1)}%</span>.
              </div>
            )}
          </div>
        )}

        {/* Variable-rate fields (hidden when fixed-term is active) */}
        {rateModel === 'variable' && <>

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
                    className={`px-3 py-2 text-sm border transition-colors ${
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

        </>}

        {rateModel === 'fixed' && fixedInvalidReason && (
          <p className="text-[11px] text-warning">{fixedInvalidReason}</p>
        )}
        <Button onClick={handleSubmit} disabled={!isValid} className="w-full">
          Preview Market
        </Button>
      </div>
    </Card>
  );
}
