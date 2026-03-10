import { CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { formatTimelockDuration } from '../../../lib/vault/createVault';
import type { StepProps } from '../CreateVaultWizard';

const PRESETS = [
  { label: '0 (fast setup)', seconds: 0, recommended: true },
  { label: '3 days', seconds: 259_200, recommended: false },
  { label: '7 days', seconds: 604_800, recommended: false },
];

export function TimelockStep({ state, onUpdate, onNext, onBack }: StepProps) {
  const isZeroThenIncrease = state.timelockStrategy === 'zero-then-increase';

  const handlePreset = (seconds: number) => {
    if (seconds === 0) {
      onUpdate({
        timelockStrategy: 'zero-then-increase',
        initialTimelockSeconds: 0,
        finalTimelockSeconds: 259_200,
      });
    } else {
      onUpdate({
        timelockStrategy: 'direct',
        initialTimelockSeconds: seconds,
        finalTimelockSeconds: seconds,
      });
    }
  };

  return (
    <div className="space-y-6">
      <CardHeader>
        <CardTitle>Timelock Configuration</CardTitle>
      </CardHeader>

      <div>
        <label className="text-xs text-text-tertiary mb-2 block">Initial Timelock</label>
        <div className="space-y-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.seconds}
              onClick={() => handlePreset(preset.seconds)}
              className={`w-full flex items-center justify-between border px-4 py-3 transition-colors text-left ${
                (preset.seconds === 0 && isZeroThenIncrease) ||
                (preset.seconds > 0 && !isZeroThenIncrease && state.initialTimelockSeconds === preset.seconds)
                  ? 'border-accent-primary bg-accent-primary-muted'
                  : 'border-border-default bg-bg-hover/30 hover:border-border-default'
              }`}
            >
              <div>
                <span className="text-sm text-text-primary">{preset.label}</span>
                {preset.seconds === 0 && (
                  <p className="text-xs text-text-tertiary mt-0.5">
                    Deploy with 0, configure instantly, then increase to 3 days
                  </p>
                )}
                {preset.seconds === 259_200 && (
                  <p className="text-xs text-text-tertiary mt-0.5">
                    Cap increases will require 3-day wait after deployment
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {preset.recommended && <Badge variant="success">Recommended</Badge>}
                <span className="text-xs text-text-tertiary">
                  {preset.seconds.toLocaleString()}s
                </span>
              </div>
            </button>
          ))}

          {/* Custom */}
          <div className="flex items-center gap-3 px-4 py-3 border border-border-default bg-bg-hover/30">
            <span className="text-sm text-text-secondary">Custom:</span>
            <input
              type="number"
              min={0}
              value={
                !isZeroThenIncrease && !PRESETS.some((p) => p.seconds === state.initialTimelockSeconds && p.seconds > 0)
                  ? state.initialTimelockSeconds
                  : ''
              }
              onChange={(e) => {
                const val = Number(e.target.value);
                onUpdate({
                  timelockStrategy: val === 0 ? 'zero-then-increase' : 'direct',
                  initialTimelockSeconds: val,
                  finalTimelockSeconds: val || 259_200,
                });
              }}
              placeholder="seconds"
              className="w-32 bg-bg-hover border border-border-default px-2 py-1 text-sm text-text-primary"
            />
            <span className="text-xs text-text-tertiary">seconds</span>
          </div>
        </div>
      </div>

      {/* Strategy explanation */}
      {isZeroThenIncrease && (
        <div>
          <label className="text-xs text-text-tertiary mb-1 block">
            Final Timelock (set after configuration)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              value={state.finalTimelockSeconds}
              onChange={(e) => onUpdate({ finalTimelockSeconds: Number(e.target.value) })}
              className="w-40 bg-bg-hover border border-border-default px-3 py-2 text-sm text-text-primary"
            />
            <span className="text-xs text-text-secondary">
              = {formatTimelockDuration(state.finalTimelockSeconds)}
            </span>
          </div>
          <p className="text-xs text-text-tertiary mt-1">
            Increasing timelock is always instant (more protective). This will be the last
            post-deploy transaction.
          </p>
        </div>
      )}

      <div className="bg-warning/10 p-3 text-xs text-warning/80 space-y-1">
        <p>
          Timelock 0 means ALL actions take effect immediately with no guardian veto window.
        </p>
        <p>
          Strategy: Deploy with timelock=0 for fast setup, then increase after configuration
          is complete. Increasing timelock is always instant.
        </p>
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}
