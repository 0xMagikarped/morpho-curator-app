import { useState } from 'react';
import { isAddress } from 'viem';
import { useAccount } from 'wagmi';
import { CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { truncateAddress } from '../../../lib/utils/format';
import type { StepProps } from '../CreateVaultWizard';

export function RolesStep({ state, onUpdate, onNext, onBack }: StepProps) {
  const { address } = useAccount();
  const [newAllocator, setNewAllocator] = useState('');

  const handleAddAllocator = () => {
    if (!isAddress(newAllocator)) return;
    if (state.allocators.some((a) => a.toLowerCase() === newAllocator.toLowerCase())) return;
    onUpdate({ allocators: [...state.allocators, newAllocator as `0x${string}`] });
    setNewAllocator('');
  };

  const handleRemoveAllocator = (addr: `0x${string}`) => {
    onUpdate({ allocators: state.allocators.filter((a) => a !== addr) });
  };

  // Ensure owner is set
  if (!state.owner && address) {
    onUpdate({ owner: address });
  }

  const canProceed =
    state.owner &&
    isAddress(state.owner) &&
    (state.curatorMode !== 'custom' || (state.curatorAddress && isAddress(state.curatorAddress))) &&
    (state.guardianMode !== 'custom' || (state.guardianAddress && isAddress(state.guardianAddress)));

  return (
    <div className="space-y-6">
      <CardHeader>
        <CardTitle>Vault Roles</CardTitle>
      </CardHeader>

      {/* Owner */}
      <div>
        <label className="text-xs text-text-tertiary mb-1 block">
          Owner (controls all vault parameters)
        </label>
        <input
          type="text"
          value={state.owner ?? ''}
          onChange={(e) => onUpdate({ owner: e.target.value as `0x${string}` })}
          placeholder="0x..."
          className="w-full bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary font-mono placeholder-text-tertiary"
        />
        <p className="text-xs text-warning/80 mt-1">
          Consider using a multisig (Safe) as owner for production vaults.
        </p>
      </div>

      {/* Curator */}
      <div>
        <label className="text-xs text-text-tertiary mb-1 block">
          Curator (manages caps, queues)
        </label>
        <select
          value={state.curatorMode}
          onChange={(e) => {
            const mode = e.target.value as 'owner' | 'custom' | 'none';
            onUpdate({ curatorMode: mode, curatorAddress: mode === 'owner' ? state.owner : null });
          }}
          className="w-full bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary mb-2"
        >
          <option value="owner">Same as owner</option>
          <option value="custom">Custom address</option>
          <option value="none">None (set later)</option>
        </select>
        {state.curatorMode === 'custom' && (
          <input
            type="text"
            value={state.curatorAddress ?? ''}
            onChange={(e) => onUpdate({ curatorAddress: e.target.value as `0x${string}` })}
            placeholder="Curator address (0x...)"
            className="w-full bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary font-mono placeholder-text-tertiary"
          />
        )}
      </div>

      {/* Allocators */}
      <div>
        <label className="text-xs text-text-tertiary mb-1 block">
          Allocator(s) (can reallocate between markets)
        </label>
        {state.allocators.length > 0 && (
          <div className="space-y-1 mb-2">
            {state.allocators.map((addr) => (
              <div key={addr} className="flex items-center justify-between bg-bg-hover/50 rounded px-3 py-1.5">
                <span className="text-xs text-text-primary font-mono">{truncateAddress(addr)}</span>
                <button
                  onClick={() => handleRemoveAllocator(addr)}
                  className="text-xs text-danger hover:text-danger/80"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={newAllocator}
            onChange={(e) => setNewAllocator(e.target.value)}
            placeholder="Allocator address (0x...)"
            className="flex-1 bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary font-mono placeholder-text-tertiary"
          />
          <Button variant="secondary" size="sm" onClick={handleAddAllocator}>
            Add
          </Button>
        </div>
        <p className="text-xs text-text-tertiary mt-1">
          Tip: Add a bot address for automated rebalancing.
        </p>
      </div>

      {/* Guardian */}
      <div>
        <label className="text-xs text-text-tertiary mb-1 block">
          Guardian (can veto timelocked actions)
        </label>
        <select
          value={state.guardianMode}
          onChange={(e) => {
            const mode = e.target.value as 'none' | 'custom';
            onUpdate({ guardianMode: mode, guardianAddress: null });
          }}
          className="w-full bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary mb-2"
        >
          <option value="none">None (can add later — instant)</option>
          <option value="custom">Custom address</option>
        </select>
        {state.guardianMode === 'custom' && (
          <input
            type="text"
            value={state.guardianAddress ?? ''}
            onChange={(e) => onUpdate({ guardianAddress: e.target.value as `0x${string}` })}
            placeholder="Guardian address (0x...)"
            className="w-full bg-bg-hover border border-border-default rounded px-3 py-2 text-sm text-text-primary font-mono placeholder-text-tertiary"
          />
        )}
        {state.guardianMode === 'none' && (
          <p className="text-xs text-text-tertiary">
            First guardian set is always instant. Changing guardian later requires timelock.
          </p>
        )}
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
