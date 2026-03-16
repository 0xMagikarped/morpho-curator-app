/**
 * Multi-step wizard for adding a Morpho Blue market to a V2 vault:
 * 1. Browse & select market
 * 2. Deploy adapter via factory + add to vault
 * 3. Configure caps (adapter, collateral, market levels)
 * 4. Optionally allocate capital
 *
 * Optimized for zero-timelock vaults — all steps are immediate.
 */
import { useState } from 'react';
import type { Address } from 'viem';
import { Check, AlertTriangle, Loader2, ArrowLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { AddressDisplay } from '../../ui/AddressDisplay';
import { MarketBrowser } from './MarketBrowser';
import { useDeployMarketAdapter, type DeployStep } from '../../../hooks/useDeployMarketAdapter';
import { useSequentialSetCaps, type CapAction } from '../../../hooks/useSetCaps';
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

type WizardStep = 'select' | 'deploy' | 'caps' | 'allocate' | 'done';

interface AddMarketWizardProps {
  chainId: number;
  vaultAddress: Address;
  vaultAsset: Address;
  assetSymbol: string;
  assetDecimals: number;
  idle: bigint;
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
  existingMarketIds,
  onComplete,
  onBack,
}: AddMarketWizardProps) {
  const [wizardStep, setWizardStep] = useState<WizardStep>('select');
  const [selectedMarket, setSelectedMarket] = useState<MarketInfo | null>(null);

  // Cap form state
  const [adapterAbsCap, setAdapterAbsCap] = useState('unlimited');
  const [adapterRelCap, setAdapterRelCap] = useState('100');
  const [collateralAbsCap, setCollateralAbsCap] = useState('unlimited');
  const [collateralRelCap, setCollateralRelCap] = useState('100');
  const [marketAbsCap, setMarketAbsCap] = useState('');
  const [marketRelCap, setMarketRelCap] = useState('50');

  // Allocate form state
  const [allocateAmount, setAllocateAmount] = useState('');

  // Hooks
  const deployHook = useDeployMarketAdapter(vaultAddress, chainId);
  const capsHook = useSequentialSetCaps(vaultAddress, chainId);
  const allocateHook = useAllocateV2(vaultAddress, chainId);

  const handleSelectMarket = (market: MarketInfo) => {
    setSelectedMarket(market);
    setWizardStep('deploy');
  };

  const handleDeploy = () => {
    if (!selectedMarket) return;
    deployHook.deploy();
  };

  const handleSetCaps = () => {
    if (!deployHook.deployedAdapter || !selectedMarket) return;

    const actions: CapAction[] = [];
    const adapter = deployHook.deployedAdapter;

    // Adapter-level caps
    const adapterData = adapterIdData(adapter);
    if (adapterAbsCap === 'unlimited') {
      actions.push({ label: 'Adapter absolute cap', functionName: 'increaseAbsoluteCap', idData: adapterData, cap: MAX_UINT128 });
    } else if (adapterAbsCap) {
      const val = BigInt(Math.round(parseFloat(adapterAbsCap) * 10 ** assetDecimals));
      actions.push({ label: 'Adapter absolute cap', functionName: 'increaseAbsoluteCap', idData: adapterData, cap: val });
    }
    if (adapterRelCap) {
      actions.push({ label: 'Adapter relative cap', functionName: 'increaseRelativeCap', idData: adapterData, cap: percentToWad(parseFloat(adapterRelCap)) });
    }

    // Collateral-level caps
    const collData = collateralIdData(selectedMarket.params.collateralToken);
    if (collateralAbsCap === 'unlimited') {
      actions.push({ label: 'Collateral absolute cap', functionName: 'increaseAbsoluteCap', idData: collData, cap: MAX_UINT128 });
    } else if (collateralAbsCap) {
      const val = BigInt(Math.round(parseFloat(collateralAbsCap) * 10 ** assetDecimals));
      actions.push({ label: 'Collateral absolute cap', functionName: 'increaseAbsoluteCap', idData: collData, cap: val });
    }
    if (collateralRelCap) {
      actions.push({ label: 'Collateral relative cap', functionName: 'increaseRelativeCap', idData: collData, cap: percentToWad(parseFloat(collateralRelCap)) });
    }

    // Market-level caps
    const mktData = marketIdData(adapter, selectedMarket.params);
    if (marketAbsCap === 'unlimited') {
      actions.push({ label: 'Market absolute cap', functionName: 'increaseAbsoluteCap', idData: mktData, cap: MAX_UINT128 });
    } else if (marketAbsCap) {
      const val = BigInt(Math.round(parseFloat(marketAbsCap) * 10 ** assetDecimals));
      actions.push({ label: 'Market absolute cap', functionName: 'increaseAbsoluteCap', idData: mktData, cap: val });
    }
    if (marketRelCap) {
      actions.push({ label: 'Market relative cap', functionName: 'increaseRelativeCap', idData: mktData, cap: percentToWad(parseFloat(marketRelCap)) });
    }

    capsHook.execute(actions);
  };

  const handleAllocate = () => {
    if (!deployHook.deployedAdapter || !selectedMarket || !allocateAmount) return;
    const amount = BigInt(Math.round(parseFloat(allocateAmount) * 10 ** assetDecimals));
    allocateHook.allocate(deployHook.deployedAdapter, amount, selectedMarket.params);
  };

  // Step progression
  const stepDeployDone = deployHook.step === 'done';
  const stepCapsDone = capsHook.step === 'done';
  const stepAllocateDone = allocateHook.step === 'done';

  // Auto-advance from deploy to caps
  if (stepDeployDone && wizardStep === 'deploy') {
    setWizardStep('caps');
  }
  // Auto-advance from caps to allocate
  if (stepCapsDone && wizardStep === 'caps') {
    setWizardStep('allocate');
  }
  if (stepAllocateDone && wizardStep === 'allocate') {
    setWizardStep('done');
  }

  const lltvPct = selectedMarket ? (Number(selectedMarket.params.lltv) / 1e18 * 100).toFixed(0) : '0';

  return (
    <div className="space-y-4">
      {/* Back + Progress */}
      <div className="flex items-center justify-between">
        <button
          onClick={wizardStep === 'select' ? onBack : () => setWizardStep('select')}
          className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
        >
          <ArrowLeft className="w-4 h-4" />
          {wizardStep === 'select' ? 'Back' : 'Change Market'}
        </button>
        <div className="flex gap-1.5">
          <StepDot active={wizardStep === 'select'} done={wizardStep !== 'select'} label="1" />
          <StepDot active={wizardStep === 'deploy'} done={stepDeployDone} label="2" />
          <StepDot active={wizardStep === 'caps'} done={stepCapsDone} label="3" />
          <StepDot active={wizardStep === 'allocate'} done={stepAllocateDone} label="4" />
        </div>
      </div>

      {/* Step 1: Select Market */}
      {wizardStep === 'select' && (
        <Card>
          <CardHeader>
            <CardTitle>Select Market</CardTitle>
            <Badge variant="info">Step 1</Badge>
          </CardHeader>
          <MarketBrowser
            chainId={chainId}
            loanToken={vaultAsset}
            assetSymbol={assetSymbol}
            onSelect={handleSelectMarket}
            excludeMarketIds={existingMarketIds}
          />
        </Card>
      )}

      {/* Step 2: Deploy Adapter */}
      {wizardStep === 'deploy' && selectedMarket && (
        <Card>
          <CardHeader>
            <CardTitle>Deploy Market Adapter</CardTitle>
            <Badge variant="info">Step 2</Badge>
          </CardHeader>
          <div className="space-y-4">
            {/* Market summary */}
            <div className="p-3 bg-bg-hover border border-border-subtle space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">
                  {selectedMarket.collateralToken.symbol}/{assetSymbol}
                </span>
                <Badge variant="info">LLTV {lltvPct}%</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div>
                  <span className="text-text-tertiary">Supply APY</span>
                  <p className="font-mono text-accent-primary">{(selectedMarket.supplyAPY * 100).toFixed(2)}%</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Utilization</span>
                  <p className="font-mono text-text-primary">{(selectedMarket.utilization * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <span className="text-text-tertiary">Market ID</span>
                  <p className="font-mono text-text-primary">{selectedMarket.id.slice(0, 10)}...</p>
                </div>
              </div>
            </div>

            {/* Deploy status */}
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

      {/* Step 3: Configure Caps */}
      {wizardStep === 'caps' && selectedMarket && deployHook.deployedAdapter && (
        <Card>
          <CardHeader>
            <CardTitle>Configure Caps</CardTitle>
            <Badge variant="info">Step 3</Badge>
          </CardHeader>
          <div className="space-y-4">
            <p className="text-xs text-text-tertiary">
              Set absolute and relative caps at three levels. Relative caps are % of total vault assets. Absolute caps are in {assetSymbol}.
            </p>

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
              label={`Collateral (${selectedMarket.collateralToken.symbol})`}
              absCap={collateralAbsCap}
              relCap={collateralRelCap}
              onAbsCapChange={setCollateralAbsCap}
              onRelCapChange={setCollateralRelCap}
              assetSymbol={assetSymbol}
            />

            {/* Market-level */}
            <CapInputGroup
              label={`Market (${selectedMarket.collateralToken.symbol}/${assetSymbol})`}
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
                Confirm tx {capsHook.currentIndex + 1}/{capsHook.totalActions} in wallet...
              </div>
            )}
            {capsHook.step === 'confirming' && (
              <div className="flex items-center gap-2 text-xs text-text-tertiary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Confirming tx {capsHook.currentIndex + 1}/{capsHook.totalActions}...
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
                {capsHook.step === 'error' ? 'Retry Caps' : 'Set Caps'}
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Step 4: Allocate */}
      {wizardStep === 'allocate' && selectedMarket && deployHook.deployedAdapter && (
        <Card>
          <CardHeader>
            <CardTitle>Allocate Capital</CardTitle>
            <Badge variant="info">Step 4</Badge>
          </CardHeader>
          <div className="space-y-4">
            <p className="text-xs text-text-tertiary">
              Allocate vault capital to this market. You can skip this step and allocate later.
            </p>

            <div className="p-3 bg-bg-hover border border-border-subtle">
              <span className="text-[10px] text-text-tertiary">Available (Idle)</span>
              <p className="text-sm font-mono text-text-primary">
                {formatTokenAmount(idle, assetDecimals)} {assetSymbol}
              </p>
            </div>

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
                onClick={() => { setWizardStep('done'); }}
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
            <h2 className="text-lg font-bold text-text-primary">Market Added</h2>
            <p className="text-sm text-text-tertiary">
              {selectedMarket?.collateralToken.symbol}/{assetSymbol} adapter is live.
            </p>
            {deployHook.deployedAdapter && (
              <div className="flex justify-center">
                <AddressDisplay address={deployHook.deployedAdapter} chainId={chainId} />
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
