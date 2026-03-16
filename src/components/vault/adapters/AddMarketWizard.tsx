/**
 * Multi-step wizard for adding Morpho Blue markets to a V2 vault.
 *
 * Architecture: One vault → ONE Market V1 Adapter → many markets.
 * "Adding a market" means setting caps on the existing adapter, NOT deploying
 * a new adapter per market.
 *
 * Flow:
 * - If no market adapter exists: Deploy → Add Adapter → Select Markets → Set Caps → Allocate
 * - If adapter exists: Select Markets → Set Caps → Allocate
 *
 * Optimized for zero-timelock vaults — all steps are immediate.
 */
import { useState, useEffect } from 'react';
import type { Address } from 'viem';
import { Check, AlertTriangle, Loader2, ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { MarketBrowser } from './MarketBrowser';
import { useDeployMarketAdapter, type DeployStep } from '../../../hooks/useDeployMarketAdapter';
import { useBatchSetCaps, type CapAction } from '../../../hooks/useSetCaps';
import { useAllocateV2 } from '../../../hooks/useAllocateV2';
import {
  adapterIdData,
  collateralIdData,
  marketIdData,
  MAX_UINT128,
  percentToWad,
} from '../../../lib/v2/adapterCapUtils';
import { formatTokenAmount } from '../../../lib/utils/format';
import type { MarketInfo } from '../../../types';

type WizardStep = 'deploy' | 'select' | 'caps' | 'allocate' | 'done';

interface AddMarketWizardProps {
  chainId: number;
  vaultAddress: Address;
  vaultAsset: Address;
  assetSymbol: string;
  assetDecimals: number;
  idle: bigint;
  /** Existing market adapter address — null if none deployed yet */
  existingAdapter: Address | null;
  existingMarketIds?: Set<string>;
  onComplete: () => void;
  onBack: () => void;
}

export function AddMarketWizard({
  chainId,
  vaultAddress,
  vaultAsset,
  assetSymbol,
  assetDecimals,
  idle,
  existingAdapter,
  existingMarketIds,
  onComplete,
  onBack,
}: AddMarketWizardProps) {
  const needsDeploy = !existingAdapter;
  const [wizardStep, setWizardStep] = useState<WizardStep>(needsDeploy ? 'deploy' : 'select');
  const [selectedMarkets, setSelectedMarkets] = useState<MarketInfo[]>([]);
  const [adapterAddress, setAdapterAddress] = useState<Address | null>(existingAdapter);

  // Cap form state — applies to all selected markets
  const [adapterAbsCap, setAdapterAbsCap] = useState('unlimited');
  const [adapterRelCap, setAdapterRelCap] = useState('100');
  const [collateralAbsCap, setCollateralAbsCap] = useState('unlimited');
  const [collateralRelCap, setCollateralRelCap] = useState('100');
  const [marketAbsCap, setMarketAbsCap] = useState('');
  const [marketRelCap, setMarketRelCap] = useState('50');

  // Allocate form state
  const [allocateAmount, setAllocateAmount] = useState('');
  const [allocateMarketIdx, setAllocateMarketIdx] = useState(0);

  // Hooks
  const deployHook = useDeployMarketAdapter(vaultAddress, chainId);
  const capsHook = useBatchSetCaps(vaultAddress, chainId);
  const allocateHook = useAllocateV2(vaultAddress, chainId);

  // Auto-advance from deploy to select once adapter is deployed
  useEffect(() => {
    if (deployHook.step === 'done' && deployHook.deployedAdapter && wizardStep === 'deploy') {
      setAdapterAddress(deployHook.deployedAdapter);
      setWizardStep('select');
    }
  }, [deployHook.step, deployHook.deployedAdapter, wizardStep]);

  // Auto-advance from caps to allocate
  useEffect(() => {
    if (capsHook.step === 'done' && wizardStep === 'caps') {
      setWizardStep('allocate');
    }
  }, [capsHook.step, wizardStep]);

  // Auto-advance from allocate to done
  useEffect(() => {
    if (allocateHook.step === 'done' && wizardStep === 'allocate') {
      setWizardStep('done');
    }
  }, [allocateHook.step, wizardStep]);

  const handleDeploy = () => {
    deployHook.deploy();
  };

  const handleSelectComplete = () => {
    if (selectedMarkets.length === 0) return;
    setWizardStep('caps');
  };

  const handleToggleMarket = (market: MarketInfo) => {
    setSelectedMarkets((prev) => {
      const exists = prev.find((m) => m.id === market.id);
      if (exists) return prev.filter((m) => m.id !== market.id);
      return [...prev, market];
    });
  };

  const handleSetCaps = () => {
    if (!adapterAddress || selectedMarkets.length === 0) return;

    const actions: CapAction[] = [];

    // Adapter-level caps (set once, applies to the single adapter)
    const adapterData = adapterIdData(adapterAddress);
    if (adapterAbsCap === 'unlimited') {
      actions.push({ label: 'Adapter absolute cap', functionName: 'increaseAbsoluteCap', idData: adapterData, cap: MAX_UINT128 });
    } else if (adapterAbsCap) {
      const val = BigInt(Math.round(parseFloat(adapterAbsCap) * 10 ** assetDecimals));
      actions.push({ label: 'Adapter absolute cap', functionName: 'increaseAbsoluteCap', idData: adapterData, cap: val });
    }
    if (adapterRelCap) {
      actions.push({ label: 'Adapter relative cap', functionName: 'increaseRelativeCap', idData: adapterData, cap: percentToWad(parseFloat(adapterRelCap)) });
    }

    // Per-market: collateral-level + market-level caps
    const seenCollaterals = new Set<string>();
    for (const market of selectedMarkets) {
      const collKey = market.params.collateralToken.toLowerCase();

      // Collateral-level (once per unique collateral token)
      if (!seenCollaterals.has(collKey)) {
        seenCollaterals.add(collKey);
        const collData = collateralIdData(market.params.collateralToken);
        if (collateralAbsCap === 'unlimited') {
          actions.push({ label: `${market.collateralToken.symbol} collateral abs cap`, functionName: 'increaseAbsoluteCap', idData: collData, cap: MAX_UINT128 });
        } else if (collateralAbsCap) {
          const val = BigInt(Math.round(parseFloat(collateralAbsCap) * 10 ** assetDecimals));
          actions.push({ label: `${market.collateralToken.symbol} collateral abs cap`, functionName: 'increaseAbsoluteCap', idData: collData, cap: val });
        }
        if (collateralRelCap) {
          actions.push({ label: `${market.collateralToken.symbol} collateral rel cap`, functionName: 'increaseRelativeCap', idData: collData, cap: percentToWad(parseFloat(collateralRelCap)) });
        }
      }

      // Market-level
      const mktData = marketIdData(adapterAddress, market.params);
      if (marketAbsCap === 'unlimited') {
        actions.push({ label: `${market.collateralToken.symbol} market abs cap`, functionName: 'increaseAbsoluteCap', idData: mktData, cap: MAX_UINT128 });
      } else if (marketAbsCap) {
        const val = BigInt(Math.round(parseFloat(marketAbsCap) * 10 ** assetDecimals));
        actions.push({ label: `${market.collateralToken.symbol} market abs cap`, functionName: 'increaseAbsoluteCap', idData: mktData, cap: val });
      }
      if (marketRelCap) {
        actions.push({ label: `${market.collateralToken.symbol} market rel cap`, functionName: 'increaseRelativeCap', idData: mktData, cap: percentToWad(parseFloat(marketRelCap)) });
      }
    }

    capsHook.execute(actions);
  };

  const handleAllocate = () => {
    if (!adapterAddress || !allocateAmount || allocateMarketIdx >= selectedMarkets.length) return;
    const market = selectedMarkets[allocateMarketIdx];
    const amount = BigInt(Math.round(parseFloat(allocateAmount) * 10 ** assetDecimals));
    allocateHook.allocate(adapterAddress, amount, market.params);
  };

  const stepDeployDone = !needsDeploy || deployHook.step === 'done';
  const stepCapsDone = capsHook.step === 'done';
  const stepAllocateDone = allocateHook.step === 'done';

  return (
    <div className="space-y-4">
      {/* Back + Progress */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex gap-1.5">
          {needsDeploy && <StepDot active={wizardStep === 'deploy'} done={stepDeployDone} label="1" />}
          <StepDot active={wizardStep === 'select'} done={selectedMarkets.length > 0 && wizardStep !== 'select'} label={needsDeploy ? '2' : '1'} />
          <StepDot active={wizardStep === 'caps'} done={stepCapsDone} label={needsDeploy ? '3' : '2'} />
          <StepDot active={wizardStep === 'allocate'} done={stepAllocateDone} label={needsDeploy ? '4' : '3'} />
        </div>
      </div>

      {/* Step: Deploy Adapter (only if no existing adapter) */}
      {wizardStep === 'deploy' && needsDeploy && (
        <Card>
          <CardHeader>
            <CardTitle>Deploy Market Adapter</CardTitle>
            <Badge variant="info">Step 1</Badge>
          </CardHeader>
          <div className="space-y-4">
            <p className="text-xs text-text-tertiary">
              This vault has no Market V1 Adapter. Deploy one to start allocating to Morpho Blue markets.
              One adapter handles ALL markets.
            </p>

            <DeployStatus step={deployHook.step} error={deployHook.error} adapterAddress={deployHook.deployedAdapter} />

            {deployHook.step === 'idle' && (
              <Button className="w-full" onClick={handleDeploy}>
                Deploy Adapter & Add to Vault
              </Button>
            )}

            {deployHook.step === 'error' && (
              <Button className="w-full" onClick={() => { deployHook.reset(); handleDeploy(); }}>
                Retry
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Step: Select Markets (multi-select) */}
      {wizardStep === 'select' && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>Select Markets</CardTitle>
              <Badge variant="info">Step {needsDeploy ? '2' : '1'}</Badge>
              {selectedMarkets.length > 0 && (
                <Badge variant="purple">{selectedMarkets.length} selected</Badge>
              )}
            </div>
          </CardHeader>
          <div className="space-y-3">
            <p className="text-xs text-text-tertiary">
              Select one or more markets to add to the vault. Adding a market = setting caps on the existing adapter.
            </p>
            <MarketBrowser
              chainId={chainId}
              loanToken={vaultAsset}
              assetSymbol={assetSymbol}
              onSelect={handleToggleMarket}
              excludeMarketIds={existingMarketIds}
              multiSelect
              selectedMarketIds={new Set(selectedMarkets.map((m) => m.id))}
            />
            {selectedMarkets.length > 0 && (
              <div className="space-y-2">
                <div className="p-2 bg-bg-hover border border-border-subtle">
                  <span className="text-[10px] text-text-tertiary uppercase">Selected Markets</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selectedMarkets.map((m) => (
                      <Badge key={m.id} variant="info">
                        {m.collateralToken.symbol}/{assetSymbol} ({(Number(m.params.lltv) / 1e18 * 100).toFixed(0)}%)
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button className="w-full" onClick={handleSelectComplete}>
                  Configure Caps ({selectedMarkets.length} market{selectedMarkets.length !== 1 ? 's' : ''})
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Step: Configure Caps */}
      {wizardStep === 'caps' && adapterAddress && selectedMarkets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Configure Caps</CardTitle>
            <Badge variant="info">Step {needsDeploy ? '3' : '2'}</Badge>
          </CardHeader>
          <div className="space-y-4">
            <p className="text-xs text-text-tertiary">
              Set absolute and relative caps at three levels. These apply to the single market adapter.
              Caps are batched via vault multicall (one wallet confirmation).
            </p>

            {adapterAddress && (
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <span>Adapter:</span>
                <AddressDisplay address={adapterAddress} chainId={chainId} />
              </div>
            )}

            {/* Adapter-level */}
            <CapInputGroup
              label="Adapter Level"
              absCap={adapterAbsCap}
              relCap={adapterRelCap}
              onAbsCapChange={setAdapterAbsCap}
              onRelCapChange={setAdapterRelCap}
              assetSymbol={assetSymbol}
            />

            {/* Collateral-level */}
            <CapInputGroup
              label="Collateral Level (per token)"
              absCap={collateralAbsCap}
              relCap={collateralRelCap}
              onAbsCapChange={setCollateralAbsCap}
              onRelCapChange={setCollateralRelCap}
              assetSymbol={assetSymbol}
            />

            {/* Market-level */}
            <CapInputGroup
              label="Market Level (per market)"
              absCap={marketAbsCap}
              relCap={marketRelCap}
              onAbsCapChange={setMarketAbsCap}
              onRelCapChange={setMarketRelCap}
              assetSymbol={assetSymbol}
            />

            {/* Status */}
            {capsHook.step === 'pending' && (
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Confirm batch tx in wallet...
              </div>
            )}
            {capsHook.step === 'confirming' && (
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Confirming...
              </div>
            )}
            {capsHook.error && (
              <div className="flex items-start gap-2 p-2 bg-danger/10 border border-danger/20">
                <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
                <p className="text-xs text-danger">{capsHook.error.message}</p>
              </div>
            )}

            {capsHook.step !== 'done' && capsHook.step !== 'pending' && capsHook.step !== 'confirming' && (
              <Button className="w-full" onClick={handleSetCaps}>
                {capsHook.step === 'error' ? 'Retry Caps' : 'Set Caps (Batch)'}
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Step: Allocate */}
      {wizardStep === 'allocate' && adapterAddress && selectedMarkets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Allocate Capital</CardTitle>
            <Badge variant="info">Step {needsDeploy ? '4' : '3'}</Badge>
          </CardHeader>
          <div className="space-y-4">
            <p className="text-xs text-text-tertiary">
              Allocate vault capital to a market. You can skip this step and allocate later.
            </p>

            <div className="p-3 bg-bg-hover border border-border-subtle">
              <span className="text-[10px] text-text-tertiary">Available (Idle)</span>
              <p className="text-sm font-mono text-text-primary">
                {formatTokenAmount(idle, assetDecimals)} {assetSymbol}
              </p>
            </div>

            {selectedMarkets.length > 1 && (
              <div>
                <label className="text-[10px] text-text-tertiary uppercase">Market</label>
                <select
                  value={allocateMarketIdx}
                  onChange={(e) => setAllocateMarketIdx(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 text-sm bg-bg-hover border border-border-subtle text-text-primary focus:outline-none focus:border-accent-primary"
                >
                  {selectedMarkets.map((m, i) => (
                    <option key={m.id} value={i}>
                      {m.collateralToken.symbol}/{assetSymbol} ({(Number(m.params.lltv) / 1e18 * 100).toFixed(0)}% LLTV)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-[10px] text-text-tertiary uppercase">Amount ({assetSymbol})</label>
              <input
                type="text"
                value={allocateAmount}
                onChange={(e) => setAllocateAmount(e.target.value)}
                placeholder="0.00"
                className="w-full mt-1 px-3 py-2 text-sm font-mono bg-bg-hover border border-border-subtle text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
              />
              <button
                onClick={() => setAllocateAmount((Number(idle) / 10 ** assetDecimals).toString())}
                className="text-[10px] text-accent-primary mt-1 hover:text-accent-primary-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
              >
                Max
              </button>
            </div>

            {allocateHook.step === 'pending' && (
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Confirm in wallet...
              </div>
            )}
            {allocateHook.step === 'confirming' && (
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Confirming...
              </div>
            )}
            {allocateHook.error && (
              <div className="flex items-start gap-2 p-2 bg-danger/10 border border-danger/20">
                <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
                <p className="text-xs text-danger">{allocateHook.error.message}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={handleAllocate}
                disabled={!allocateAmount || allocateHook.step === 'pending' || allocateHook.step === 'confirming'}
              >
                Allocate
              </Button>
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => setWizardStep('done')}
              >
                Skip
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Done */}
      {wizardStep === 'done' && (
        <Card>
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 mx-auto flex items-center justify-center bg-success/10 border border-success/20">
              <Check className="w-6 h-6 text-success" />
            </div>
            <h2 className="text-lg font-bold text-text-primary">
              {selectedMarkets.length === 1 ? 'Market Added' : `${selectedMarkets.length} Markets Added`}
            </h2>
            <p className="text-sm text-text-tertiary">
              {selectedMarkets.map((m) => m.collateralToken.symbol).join(', ')}/{assetSymbol} — caps configured.
            </p>
            {adapterAddress && (
              <div className="flex justify-center">
                <AddressDisplay address={adapterAddress} chainId={chainId} />
              </div>
            )}
            <Button className="w-full" onClick={onComplete}>
              Done
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div
      className={`w-6 h-6 flex items-center justify-center text-[10px] font-bold border ${
        done
          ? 'bg-success/20 border-success/30 text-success'
          : active
            ? 'bg-accent-primary/20 border-accent-primary/30 text-accent-primary'
            : 'bg-bg-hover border-border-subtle text-text-tertiary'
      }`}
    >
      {done ? <Check className="w-3 h-3" /> : label}
    </div>
  );
}

function DeployStatus({
  step,
  error,
  adapterAddress,
}: {
  step: DeployStep;
  error: Error | null;
  adapterAddress: Address | null;
}) {
  return (
    <div className="space-y-2">
      <StepStatus label="Deploy adapter" status={
        step === 'deploying' ? 'pending' :
        step === 'confirming-deploy' ? 'confirming' :
        step === 'adding' || step === 'confirming-add' || step === 'done' ? 'done' :
        step === 'error' ? 'error' : 'idle'
      } />
      <StepStatus label="Add to vault" status={
        step === 'adding' ? 'pending' :
        step === 'confirming-add' ? 'confirming' :
        step === 'done' ? 'done' :
        step === 'error' && adapterAddress ? 'error' : 'idle'
      } />
      {error && (
        <div className="flex items-start gap-2 p-2 bg-danger/10 border border-danger/20">
          <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
          <p className="text-xs text-danger">{error.message}</p>
        </div>
      )}
      {adapterAddress && (
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <span>Adapter:</span>
          <AddressDisplay address={adapterAddress} chainId={0} />
        </div>
      )}
    </div>
  );
}

function StepStatus({ label, status }: { label: string; status: 'idle' | 'pending' | 'confirming' | 'done' | 'error' }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {status === 'idle' && <div className="w-3.5 h-3.5 border border-border-subtle" />}
      {status === 'pending' && <Loader2 className="w-3.5 h-3.5 text-accent-primary animate-spin" />}
      {status === 'confirming' && <Loader2 className="w-3.5 h-3.5 text-info animate-spin" />}
      {status === 'done' && <Check className="w-3.5 h-3.5 text-success" />}
      {status === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-danger" />}
      <span className={status === 'done' ? 'text-text-primary' : status === 'error' ? 'text-danger' : 'text-text-tertiary'}>
        {label}
        {status === 'pending' && ' — confirm in wallet'}
        {status === 'confirming' && ' — confirming...'}
      </span>
    </div>
  );
}

function CapInputGroup({
  label,
  absCap,
  relCap,
  onAbsCapChange,
  onRelCapChange,
  assetSymbol,
}: {
  label: string;
  absCap: string;
  relCap: string;
  onAbsCapChange: (v: string) => void;
  onRelCapChange: (v: string) => void;
  assetSymbol: string;
}) {
  return (
    <div className="p-3 bg-bg-hover border border-border-subtle space-y-2">
      <span className="text-xs font-medium text-text-primary">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-text-tertiary">Absolute Cap ({assetSymbol})</label>
          <input
            type="text"
            value={absCap}
            onChange={(e) => onAbsCapChange(e.target.value)}
            placeholder="unlimited"
            className="w-full mt-0.5 px-2 py-1.5 text-xs font-mono bg-bg-root border border-border-subtle text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
          />
        </div>
        <div>
          <label className="text-[10px] text-text-tertiary">Relative Cap (%)</label>
          <input
            type="text"
            value={relCap}
            onChange={(e) => onRelCapChange(e.target.value)}
            placeholder="100"
            className="w-full mt-0.5 px-2 py-1.5 text-xs font-mono bg-bg-root border border-border-subtle text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
          />
        </div>
      </div>
    </div>
  );
}
