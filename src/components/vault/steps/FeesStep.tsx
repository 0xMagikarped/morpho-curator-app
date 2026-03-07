import { CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import type { StepProps } from '../CreateVaultWizard';

export function FeesStep({ state, onUpdate, onNext, onBack }: StepProps) {
  const canProceed =
    state.feePercent >= 0 &&
    state.feePercent <= 50 &&
    (state.feeRecipientMode !== 'custom' || state.feeRecipientAddress);

  return (
    <div className="space-y-6">
      <CardHeader>
        <CardTitle>Fee Configuration</CardTitle>
      </CardHeader>

      <div>
        <label className="text-xs text-text-tertiary mb-1 block">Performance Fee (%)</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={state.feePercent}
            onChange={(e) => onUpdate({ feePercent: Number(e.target.value) })}
            className="w-32 bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary"
          />
          <span className="text-xs text-text-tertiary">max 50%</span>
        </div>
        <p className="text-xs text-text-tertiary mt-1">
          Applied to yield generated. Industry standard: 5-20%. Feather USDC on SEI: 15%.
        </p>
      </div>

      <div>
        <label className="text-xs text-text-tertiary mb-1 block">Fee Recipient</label>
        <select
          value={state.feeRecipientMode}
          onChange={(e) => {
            const mode = e.target.value as 'owner' | 'custom';
            onUpdate({ feeRecipientMode: mode, feeRecipientAddress: null });
          }}
          className="w-full bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary mb-2"
        >
          <option value="owner">Same as owner</option>
          <option value="custom">Custom address</option>
        </select>
        {state.feeRecipientMode === 'custom' && (
          <input
            type="text"
            value={state.feeRecipientAddress ?? ''}
            onChange={(e) => onUpdate({ feeRecipientAddress: e.target.value as `0x${string}` })}
            placeholder="Fee recipient address (0x...)"
            className="w-full bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary font-mono placeholder-text-tertiary"
          />
        )}
      </div>

      <div className="bg-bg-hover/30 rounded p-3 text-xs text-text-tertiary space-y-1">
        <p>Fee is set to 0 at deployment, then configured in post-deploy setup.</p>
        <p>First fee set (from 0) is always instant. Increasing fee later requires timelock.</p>
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Next
        </Button>
      </div>
    </div>
  );
}
