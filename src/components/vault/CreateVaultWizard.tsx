import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { ProgressBar } from '../ui/ProgressBar';
import { ChainAssetStep } from './steps/ChainAssetStep';
import { VaultIdentityStep } from './steps/VaultIdentityStep';
import { RolesStep } from './steps/RolesStep';
import { FeesStep } from './steps/FeesStep';
import { TimelockStep } from './steps/TimelockStep';
import { MarketsStep } from './steps/MarketsStep';
import { ReviewStep } from './steps/ReviewStep';
import { DeployStep } from './steps/DeployStep';
import type { MarketParamsStruct } from '../../lib/vault/createVault';

// ============================================================
// Wizard State
// ============================================================

export interface WizardState {
  // Step 1: Chain + Asset
  chainId: number | null;
  asset: `0x${string}` | null;
  assetSymbol: string;
  assetDecimals: number;

  // Step 2: Identity
  vaultName: string;
  vaultSymbol: string;
  salt: `0x${string}` | null;

  // Step 3: Roles
  owner: `0x${string}` | null;
  curatorMode: 'owner' | 'custom' | 'none';
  curatorAddress: `0x${string}` | null;
  allocators: `0x${string}`[];
  guardianMode: 'none' | 'custom';
  guardianAddress: `0x${string}` | null;

  // Step 4: Fees
  feePercent: number;
  feeRecipientMode: 'owner' | 'custom';
  feeRecipientAddress: `0x${string}` | null;

  // Step 5: Timelock
  timelockStrategy: 'zero-then-increase' | 'direct';
  initialTimelockSeconds: number;
  finalTimelockSeconds: number;

  // Step 6: Markets
  selectedMarkets: Array<{
    marketParams: MarketParamsStruct;
    supplyCap: string; // Human-readable (e.g., "50000")
    collateralSymbol: string;
    lltv: string;
  }>;
}

const INITIAL_STATE: WizardState = {
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
  feePercent: 15,
  feeRecipientMode: 'owner',
  feeRecipientAddress: null,
  timelockStrategy: 'zero-then-increase',
  initialTimelockSeconds: 0,
  finalTimelockSeconds: 259_200, // 3 days
  selectedMarkets: [],
};

const STEP_LABELS = [
  'Chain & Asset',
  'Identity',
  'Roles',
  'Fees',
  'Timelock',
  'Markets',
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

  const next = useCallback(() => setStep((s) => Math.min(s + 1, 7)), []);
  const back = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  const progress = Math.round(((step + 1) / 8) * 100);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Step {step + 1} of 8
          </h2>
          <Badge variant="info">{STEP_LABELS[step]}</Badge>
        </div>
        <div className="flex gap-1">
          {STEP_LABELS.map((label, i) => (
            <div
              key={label}
              className={`w-2 h-2 rounded-full ${
                i < step
                  ? 'bg-accent-primary'
                  : i === step
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
        {step === 0 && (
          <ChainAssetStep state={state} onUpdate={updateState} onNext={next} />
        )}
        {step === 1 && (
          <VaultIdentityStep state={state} onUpdate={updateState} onNext={next} onBack={back} />
        )}
        {step === 2 && (
          <RolesStep state={state} onUpdate={updateState} onNext={next} onBack={back} />
        )}
        {step === 3 && (
          <FeesStep state={state} onUpdate={updateState} onNext={next} onBack={back} />
        )}
        {step === 4 && (
          <TimelockStep state={state} onUpdate={updateState} onNext={next} onBack={back} />
        )}
        {step === 5 && (
          <MarketsStep state={state} onUpdate={updateState} onNext={next} onBack={back} />
        )}
        {step === 6 && (
          <ReviewStep state={state} onNext={next} onBack={back} />
        )}
        {step === 7 && (
          <DeployStep state={state} onBack={back} />
        )}
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
