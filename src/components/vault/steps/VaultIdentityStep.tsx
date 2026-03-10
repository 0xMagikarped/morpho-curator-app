import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { generateVaultSalt, generateRandomSalt } from '../../../lib/vault/vaultSaltGenerator';
import type { StepProps } from '../CreateVaultWizard';

export function VaultIdentityStep({ state, onUpdate, onNext, onBack }: StepProps) {
  const { address } = useAccount();

  // Auto-suggest name and symbol on first render
  useEffect(() => {
    if (!state.vaultName && state.assetSymbol) {
      onUpdate({
        vaultName: `${state.assetSymbol} Vault`,
        vaultSymbol: `mm${state.assetSymbol}`,
      });
    }
  }, [state.assetSymbol, state.vaultName, onUpdate]);

  // Auto-generate salt
  useEffect(() => {
    if (!state.salt && address && state.vaultName) {
      onUpdate({ salt: generateVaultSalt(address, state.vaultName) });
    }
  }, [state.salt, address, state.vaultName, onUpdate]);

  const regenerateSalt = () => {
    onUpdate({ salt: generateRandomSalt() });
  };

  const canProceed = state.vaultName.trim() && state.vaultSymbol.trim() && state.salt;

  return (
    <div className="space-y-6">
      <CardHeader>
        <CardTitle>Vault Identity</CardTitle>
      </CardHeader>

      <div>
        <label className="text-xs text-text-tertiary mb-1 block">Vault Name</label>
        <input
          type="text"
          value={state.vaultName}
          onChange={(e) => onUpdate({ vaultName: e.target.value })}
          placeholder="e.g., RockawayX USDC Vault"
          className="w-full bg-bg-hover border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary"
        />
      </div>

      <div>
        <label className="text-xs text-text-tertiary mb-1 block">Vault Symbol</label>
        <input
          type="text"
          value={state.vaultSymbol}
          onChange={(e) => onUpdate({ vaultSymbol: e.target.value })}
          placeholder="e.g., rxUSDC"
          className="w-full bg-bg-hover border border-border-default px-3 py-2 text-sm text-text-primary placeholder-text-tertiary"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-text-tertiary">Deployment Salt (advanced)</label>
          <Button variant="ghost" size="sm" onClick={regenerateSalt}>
            Regenerate
          </Button>
        </div>
        <input
          type="text"
          value={state.salt ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('0x') && v.length <= 66) {
              onUpdate({ salt: v as `0x${string}` });
            }
          }}
          className="w-full bg-bg-hover border border-border-default px-3 py-2 text-xs text-text-secondary font-mono placeholder-text-tertiary"
        />
        <p className="text-xs text-text-tertiary mt-1">
          Salt determines the vault's CREATE2 address. Change it to get a different deployment address.
        </p>
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
