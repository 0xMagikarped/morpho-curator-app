import { useState, useCallback, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { ProgressBar } from '../ui/ProgressBar';
import { ChainAssetStep } from './steps/ChainAssetStep';
import { VaultIdentityStep } from './steps/VaultIdentityStep';
import { RolesStep } from './steps/RolesStep';
import { V2RolesStep } from './steps/V2RolesStep';
import { FeesStep } from './steps/FeesStep';
import { V2FeesStep } from './steps/V2FeesStep';
import { TimelockStep } from './steps/TimelockStep';
import { V2TimelockStep } from './steps/V2TimelockStep';
import { MarketsStep } from './steps/MarketsStep';
import { ReviewStep } from './steps/ReviewStep';
import { DeployStep } from './steps/DeployStep';
import type { MarketParamsStruct } from '../../lib/vault/createVault';

// ============================================================
// Wizard State
// ============================================================

export interface WizardState {
  // Version selector
  version: 'v1' | 'v2';

  // Step 1: Chain + Asset
  chainId: number | null;
  asset: `0x${string}` | null;
  assetSymbol: string;
  assetDecimals: number;

  // Step 2: Identity
  vaultName: string;
  vaultSymbol: string;
  salt: `0x${string}` | null;

  // Step 3: Roles (shared)
  owner: `0x${string}` | null;
  curatorMode: 'owner' | 'custom' | 'none';
  curatorAddress: `0x${string}` | null;
  allocators: `0x${string}`[];
  // V1-only
  guardianMode: 'none' | 'custom';
  guardianAddress: `0x${string}` | null;
  // V2-only
  sentinels: `0x${string}`[];

  // Step 4: Fees
  feePercent: number; // Performance fee for both V1/V2
  feeRecipientMode: 'owner' | 'custom';
  feeRecipientAddress: `0x${string}` | null;
  // V2-only fees
  managementFeePercent: number;
  managementFeeRecipientMode: 'owner' | 'custom' | 'none';
  managementFeeRecipientAddress: `0x${string}` | null;

  // Step 5: Timelock
  timelockStrategy: 'zero-then-increase' | 'direct';
  initialTimelockSeconds: number;
  finalTimelockSeconds: number;
  // V2-only: per-function timelocks
  v2Timelocks: Array<{ selector: `0x${string}`; label: string; seconds: number }>;

  // Step 6: Markets (V1 only — V2 uses adapters)
  selectedMarkets: Array<{
    marketParams: MarketParamsStruct;
    supplyCap: string;
    collateralSymbol: string;
    lltv: string;
  }>;
}

const INITIAL_STATE: WizardState = {
  version: 'v1',
  chainId: null,
  asset: null,
  assetSymbol: '',
  assetDecimals: 18,
  vaultName: '',
  vaultSymbol: '',
  salt: null,
  owner: null,
  curatorMode: 'owner',
  curatorAddress: null,
  allocators: [],
  guardianMode: 'none',
  guardianAddress: null,
  sentinels: [],
  feePercent: 15,
  feeRecipientMode: 'owner',
  feeRecipientAddress: null,
  managementFeePercent: 0,
  managementFeeRecipientMode: 'none',
  managementFeeRecipientAddress: null,
  timelockStrategy: 'zero-then-increase',
  initialTimelockSeconds: 0,
  finalTimelockSeconds: 259_200,
  v2Timelocks: [],
  selectedMarkets: [],
};

const V1_STEP_LABELS = [
  'Chain & Asset',
  'Identity',
  'Roles',
  'Fees',
  'Timelock',
  'Markets',
  'Review',
  'Deploy',
];

const V2_STEP_LABELS = [
  'Chain & Asset',
  'Identity',
  'Roles & Sentinels',
  'Fees',
  'Timelocks',
  'Review',
  'Deploy',
];

// ============================================================
// Component
// ============================================================

export function CreateVaultWizard() {
  const { address } = useAccount();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>(() => ({
    ...INITIAL_STATE,
    owner: address ?? null,
  }));

  const updateState = useCallback((partial: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  const isV2 = state.version === 'v2';
  const stepLabels = isV2 ? V2_STEP_LABELS : V1_STEP_LABELS;
  const maxStep = stepLabels.length - 1;

  const next = useCallback(() => setStep((s) => Math.min(s + 1, maxStep)), [maxStep]);
  const back = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  const progress = Math.round(((step + 1) / stepLabels.length) * 100);

  // V1 steps: 0=Chain, 1=Identity, 2=Roles, 3=Fees, 4=Timelock, 5=Markets, 6=Review, 7=Deploy
  // V2 steps: 0=Chain, 1=Identity, 2=Roles+Sentinels, 3=Fees, 4=Timelocks, 5=Review, 6=Deploy
  const renderStep = useMemo(() => {
    if (isV2) {
      switch (step) {
        case 0: return <ChainAssetStep state={state} onUpdate={updateState} onNext={next} />;
        case 1: return <VaultIdentityStep state={state} onUpdate={updateState} onNext={next} onBack={back} />;
        case 2: return <V2RolesStep state={state} onUpdate={updateState} onNext={next} onBack={back} />;
        case 3: return <V2FeesStep state={state} onUpdate={updateState} onNext={next} onBack={back} />;
        case 4: return <V2TimelockStep state={state} onUpdate={updateState} onNext={next} onBack={back} />;
        case 5: return <ReviewStep state={state} onNext={next} onBack={back} />;
        case 6: return <DeployStep state={state} onBack={back} />;
        default: return null;
      }
    }
    switch (step) {
      case 0: return <ChainAssetStep state={state} onUpdate={updateState} onNext={next} />;
      case 1: return <VaultIdentityStep state={state} onUpdate={updateState} onNext={next} onBack={back} />;
      case 2: return <RolesStep state={state} onUpdate={updateState} onNext={next} onBack={back} />;
      case 3: return <FeesStep state={state} onUpdate={updateState} onNext={next} onBack={back} />;
      case 4: return <TimelockStep state={state} onUpdate={updateState} onNext={next} onBack={back} />;
      case 5: return <MarketsStep state={state} onUpdate={updateState} onNext={next} onBack={back} />;
      case 6: return <ReviewStep state={state} onNext={next} onBack={back} />;
      case 7: return <DeployStep state={state} onBack={back} />;
      default: return null;
    }
  }, [isV2, step, state, updateState, next, back]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Step {step + 1} of {stepLabels.length}
          </h2>
          <Badge variant="info">{stepLabels[step]}</Badge>
          <Badge variant={isV2 ? 'info' : 'success'}>{isV2 ? 'V2' : 'V1'}</Badge>
        </div>
        <div className="flex gap-1">
          {stepLabels.map((label, i) => (
            <div
              key={label}
              className={`w-2 h-2 ${
                i <= step
                  ? 'bg-accent-primary'
                  : 'bg-bg-active'
              }`}
              title={label}
            />
          ))}
        </div>
      </div>

      <ProgressBar value={progress} variant="default" />

      {/* Step Content */}
      <Card>
        {renderStep}
      </Card>
    </div>
  );
}

// Shared step props type
export interface StepProps {
  state: WizardState;
  onUpdate: (partial: Partial<WizardState>) => void;
  onNext: () => void;
  onBack?: () => void;
}
