import { CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import type { StepProps } from '../CreateVaultWizard';

export function V2FeesStep({ state, onUpdate, onNext, onBack }: StepProps) {
  const canProceed =
    state.feePercent >= 0 &&
    state.feePercent <= 50 &&
    state.managementFeePercent >= 0 &&
    state.managementFeePercent <= 50 &&
    (state.feeRecipientMode !== 'custom' || state.feeRecipientAddress) &&
    (state.managementFeeRecipientMode !== 'custom' || state.managementFeeRecipientAddress);

  return (
    <div className="space-y-6">
      <CardHeader>
        <CardTitle>Fee Configuration</CardTitle>
        <Badge variant="info">V2 Dual Fees</Badge>
      </CardHeader>

      {/* Performance Fee */}
      <div className="space-y-3 border border-border-default p-4">
        <h3 className="text-xs text-text-tertiary uppercase font-medium">Performance Fee</h3>
        <p className="text-xs text-text-tertiary">
          Applied to yield generated. Charged on vault profits.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={state.feePercent}
            onChange={(e) => onUpdate({ feePercent: Number(e.target.value) })}
            className="w-32 bg-bg-hover border border-border-default px-3 py-2 text-sm text-text-primary"
          />
          <span className="text-xs text-text-tertiary">% (max 50%)</span>
        </div>

        <div>
          <label className="text-xs text-text-tertiary mb-1 block">Performance Fee Recipient</label>
          <select
            value={state.feeRecipientMode}
            onChange={(e) => {
              const mode = e.target.value as 'owner' | 'custom';
              onUpdate({ feeRecipientMode: mode, feeRecipientAddress: null });
            }}
            className="w-full bg-bg-hover border border-border-default px-3 py-2 text-sm text-text-primary mb-2"
          >
            <option value="owner">Same as owner</option>
            <option value="custom">Custom address</option>
          </select>
          {state.feeRecipientMode === 'custom' && (
            <input
              type="text"
              value={state.feeRecipientAddress ?? ''}
              onChange={(e) => onUpdate({ feeRecipientAddress: e.target.value as `0x${string}` })}
              placeholder="Performance fee recipient (0x...)"
              className="w-full bg-bg-hover border border-border-default px-3 py-2 text-sm text-text-primary font-mono placeholder-text-tertiary"
            />
          )}
        </div>
      </div>

      {/* Management Fee */}
      <div className="space-y-3 border border-border-default p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-xs text-text-tertiary uppercase font-medium">Management Fee</h3>
          <Badge variant="info">V2</Badge>
        </div>
        <p className="text-xs text-text-tertiary">
          Annual fee on total assets under management (AUM). Accrues continuously.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={50}
            step={0.1}
            value={state.managementFeePercent}
            onChange={(e) => onUpdate({ managementFeePercent: Number(e.target.value) })}
            className="w-32 bg-bg-hover border border-border-default px-3 py-2 text-sm text-text-primary"
          />
          <span className="text-xs text-text-tertiary">% annual (max 50%)</span>
        </div>

        {state.managementFeePercent > 0 && (
          <div>
            <label className="text-xs text-text-tertiary mb-1 block">Management Fee Recipient</label>
            <select
              value={state.managementFeeRecipientMode}
              onChange={(e) => {
                const mode = e.target.value as 'owner' | 'custom' | 'none';
                onUpdate({ managementFeeRecipientMode: mode, managementFeeRecipientAddress: null });
              }}
              className="w-full bg-bg-hover border border-border-default px-3 py-2 text-sm text-text-primary mb-2"
            >
              <option value="owner">Same as owner</option>
              <option value="custom">Custom address</option>
            </select>
            {state.managementFeeRecipientMode === 'custom' && (
              <input
                type="text"
                value={state.managementFeeRecipientAddress ?? ''}
                onChange={(e) => onUpdate({ managementFeeRecipientAddress: e.target.value as `0x${string}` })}
                placeholder="Management fee recipient (0x...)"
                className="w-full bg-bg-hover border border-border-default px-3 py-2 text-sm text-text-primary font-mono placeholder-text-tertiary"
              />
            )}
          </div>
        )}
      </div>

      <div className="bg-bg-hover/30 p-3 text-xs text-text-tertiary space-y-1">
        <p>Fees are set to 0 at deployment, then configured in post-deploy setup.</p>
        <p>V2 allows separate performance and management fee recipients.</p>
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
