import { useState } from 'react';
import { CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { formatTimelockDuration } from '../../../lib/vault/createVault';
import type { StepProps } from '../CreateVaultWizard';

// V2 function selectors for per-function timelocks
const V2_TIMELOCK_FUNCTIONS = [
  { selector: '0xb3d7f6b9' as `0x${string}`, label: 'setCurator', description: 'Change curator' },
  { selector: '0x4b40c0a0' as `0x${string}`, label: 'setIsAllocator', description: 'Modify allocators' },
  { selector: '0x9a4575b9' as `0x${string}`, label: 'setIsSentinel', description: 'Modify sentinels' },
  { selector: '0x70897b23' as `0x${string}`, label: 'setPerformanceFee', description: 'Change performance fee' },
  { selector: '0xfe56e232' as `0x${string}`, label: 'setManagementFee', description: 'Change management fee' },
  { selector: '0x5f48f393' as `0x${string}`, label: 'submitAdapter', description: 'Add new adapter' },
] as const;

export function V2TimelockStep({ state, onUpdate, onNext, onBack }: StepProps) {
  const [usePerFunction, setUsePerFunction] = useState(state.v2Timelocks.length > 0);

  const handleGlobalTimelock = (seconds: number) => {
    onUpdate({
      v2Timelocks: V2_TIMELOCK_FUNCTIONS.map((fn) => ({
        selector: fn.selector,
        label: fn.label,
        seconds,
      })),
    });
  };

  const handlePerFunctionTimelock = (selector: `0x${string}`, label: string, seconds: number) => {
    const existing = state.v2Timelocks.filter((t) => t.selector !== selector);
    onUpdate({
      v2Timelocks: [...existing, { selector, label, seconds }],
    });
  };

  const getTimelockValue = (selector: `0x${string}`): number => {
    return state.v2Timelocks.find((t) => t.selector === selector)?.seconds ?? 0;
  };

  return (
    <div className="space-y-6">
      <CardHeader>
        <CardTitle>Timelock Configuration</CardTitle>
        <Badge variant="info">V2 Per-Function</Badge>
      </CardHeader>

      <p className="text-xs text-text-tertiary">
        V2 vaults support per-function timelocks. Each sensitive operation can have its own delay.
      </p>

      {/* Mode selector */}
      <div className="flex gap-3">
        <button
          onClick={() => {
            setUsePerFunction(false);
            handleGlobalTimelock(259_200);
          }}
          className={`flex-1 border px-4 py-3 text-left transition-colors ${
            !usePerFunction
              ? 'border-accent-primary bg-accent-primary-muted'
              : 'border-border-default bg-bg-hover/30 hover:border-border-default'
          }`}
        >
          <span className="text-sm text-text-primary">Uniform Timelock</span>
          <p className="text-xs text-text-tertiary mt-0.5">Same delay for all functions</p>
        </button>
        <button
          onClick={() => setUsePerFunction(true)}
          className={`flex-1 border px-4 py-3 text-left transition-colors ${
            usePerFunction
              ? 'border-accent-primary bg-accent-primary-muted'
              : 'border-border-default bg-bg-hover/30 hover:border-border-default'
          }`}
        >
          <span className="text-sm text-text-primary">Per-Function</span>
          <p className="text-xs text-text-tertiary mt-0.5">Different delay per operation</p>
        </button>
      </div>

      {!usePerFunction ? (
        /* Uniform timelock */
        <div>
          <label className="text-xs text-text-tertiary mb-2 block">Global Timelock (seconds)</label>
          <div className="space-y-2">
            {[
              { label: '0 (no delay)', seconds: 0 },
              { label: '1 day', seconds: 86_400 },
              { label: '3 days', seconds: 259_200 },
              { label: '7 days', seconds: 604_800 },
            ].map((preset) => (
              <button
                key={preset.seconds}
                onClick={() => handleGlobalTimelock(preset.seconds)}
                className={`w-full flex items-center justify-between border px-4 py-2 transition-colors text-left ${
                  getTimelockValue(V2_TIMELOCK_FUNCTIONS[0].selector) === preset.seconds
                    ? 'border-accent-primary bg-accent-primary-muted'
                    : 'border-border-default bg-bg-hover/30 hover:border-border-default'
                }`}
              >
                <span className="text-sm text-text-primary">{preset.label}</span>
                <span className="text-xs text-text-tertiary font-mono">
                  {preset.seconds.toLocaleString()}s
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Per-function timelocks */
        <div className="space-y-2">
          <label className="text-xs text-text-tertiary mb-1 block">Per-Function Timelocks</label>
          {V2_TIMELOCK_FUNCTIONS.map((fn) => (
            <div
              key={fn.selector}
              className="flex items-center gap-3 bg-bg-hover/30 border border-border-default px-4 py-2"
            >
              <div className="flex-1">
                <span className="text-xs text-text-primary font-mono">{fn.label}</span>
                <p className="text-xs text-text-tertiary">{fn.description}</p>
              </div>
              <input
                type="number"
                min={0}
                value={getTimelockValue(fn.selector)}
                onChange={(e) =>
                  handlePerFunctionTimelock(fn.selector, fn.label, Number(e.target.value))
                }
                className="w-28 bg-bg-hover border border-border-default px-2 py-1 text-sm text-text-primary text-right font-mono"
              />
              <span className="text-xs text-text-tertiary w-16">
                {formatTimelockDuration(getTimelockValue(fn.selector))}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="bg-warning/10 p-3 text-xs text-warning/80 space-y-1">
        <p>
          Timelocks are set via post-deploy transactions. Each sentinel can revoke pending actions
          within the timelock window.
        </p>
        <p>
          Increasing a timelock is always instant. Decreasing requires the existing timelock delay.
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
