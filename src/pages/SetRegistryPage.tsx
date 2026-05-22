import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, AlertTriangle, ArrowLeft, Lock, Clock, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useRegistryStatus, type RegistryStep } from '../hooks/useRegistryStatus';
import { useSetRegistry, useAbdicateRegistry } from '../hooks/useSetRegistryAndAbdicate';
import { getChainConfig } from '../config/chains';
import { truncateAddress } from '../lib/utils/format';

export function SetRegistryPage() {
  const { chainId: chainIdParam, address } = useParams<{ chainId: string; address: string }>();
  const navigate = useNavigate();
  const chainId = Number(chainIdParam);
  const vaultAddress = address as `0x${string}`;
  const chainConfig = getChainConfig(chainId);

  const { step, canManage, expectedRegistry, executableAt } = useRegistryStatus(vaultAddress, chainId);
  const {
    submitSetRegistry, executeSetRegistry,
    isPending: isSetPending, isSimulating: isSetSimulating,
    isConfirming: isSetConfirming, error: registryError,
  } = useSetRegistry(vaultAddress, chainId);
  const {
    submitAbdicate, executeAbdicate,
    isPending: isAbdPending, isSimulating: isAbdSimulating,
    isConfirming: isAbdConfirming, error: abdicateError,
  } = useAbdicateRegistry(vaultAddress, chainId);

  const [confirmed, setConfirmed] = useState(false);

  const txError = registryError || abdicateError;
  const isAbdicateStep = step.startsWith('abdicate_');

  if (!chainId || !vaultAddress) {
    return (
      <div className="text-center py-12">
        <p className="text-text-tertiary">Invalid vault URL.</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate('/')}>Back to Dashboard</Button>
      </div>
    );
  }

  // Not authorised — `submit` is curator-gated on V2; owner allowed defensively.
  if (!canManage && step !== 'loading') {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <Card>
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-text-tertiary" />
              <h1 className="text-lg font-bold text-text-primary">Set the Morpho Registry</h1>
            </div>
            <p className="text-sm text-text-tertiary">
              Only the vault owner or curator can set and abdicate the adapter registry.
            </p>
            <Button variant="ghost" className="w-full" onClick={() => navigate(`/vault/${chainId}/${vaultAddress}`)}>
              Return to Vault
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Complete
  if (step === 'complete') {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <Card>
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 mx-auto flex items-center justify-center bg-success/10 border border-success/20">
              <Check className="w-6 h-6 text-success" />
            </div>
            <h1 className="text-lg font-bold text-text-primary">Registry Set & Abdicated</h1>
            <p className="text-sm text-text-tertiary">
              The Morpho Adapter Registry is permanently locked for this vault. You can now manage adapters.
            </p>
            <Button className="w-full" onClick={() => navigate(`/vault/${chainId}/${vaultAddress}`)}>
              Return to Vault
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const setBusy = isSetSimulating || isSetPending || isSetConfirming;
  const abdBusy = isAbdSimulating || isAbdPending || isAbdConfirming;
  /** Busy-state label shared by every action button. */
  const busyLabel = (sim: boolean, pend: boolean, conf: boolean): string | null =>
    sim ? 'Simulating…' : pend ? 'Confirm in Wallet…' : conf ? 'Confirming…' : null;

  return (
    <div className="max-w-lg mx-auto mt-8 space-y-4">
      <button
        onClick={() => navigate(`/vault/${chainId}/${vaultAddress}`)}
        className="flex items-center gap-1.5 text-sm text-text-tertiary hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Vault
      </button>

      <Card>
        <CardHeader>
          <CardTitle>Set the Morpho Registry</CardTitle>
          <Badge variant={isAbdicateStep ? 'success' : 'warning'}>
            {isAbdicateStep ? 'Step 2: Abdicate' : 'Step 1: Set Registry'}
          </Badge>
        </CardHeader>

        <div className="space-y-5">
          <p className="text-sm text-text-tertiary">
            To use adapters, assign the Morpho Registry to this vault. Morpho Vault V2 timelocks
            this change: <span className="font-mono">submit</span> it, then{' '}
            <span className="font-mono">execute</span> once the timelock elapses.
          </p>

          {/* Vault + registry info */}
          <div className="p-4 bg-bg-hover border border-border-subtle space-y-3">
            <div>
              <span className="text-[10px] text-text-tertiary uppercase">Vault</span>
              <p className="text-sm font-mono text-text-primary mt-0.5">{truncateAddress(vaultAddress)}</p>
            </div>
            <div>
              <span className="text-[10px] text-text-tertiary uppercase">Adapter Registry Address</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-sm font-mono text-text-primary">
                  {expectedRegistry ? truncateAddress(expectedRegistry) : 'Not configured for this chain'}
                </span>
                {expectedRegistry && chainConfig?.blockExplorer && (
                  <a
                    href={`${chainConfig.blockExplorer}/address/${expectedRegistry}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-info hover:text-info/80"
                    aria-label="View registry on block explorer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-border-subtle">
              <p className="text-[10px] text-text-tertiary uppercase mb-2">What you're committing to</p>
              <ul className="space-y-1.5 text-xs text-text-primary">
                <li className="flex items-start gap-2">
                  <span className="mt-1 w-1 h-1 bg-text-tertiary shrink-0" />
                  Only Morpho-approved adapters can be added.
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 w-1 h-1 bg-text-tertiary shrink-0" />
                  Your ability to change the registry will be abdicated.
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 w-1 h-1 bg-text-tertiary shrink-0" />
                  This is a one-time, irreversible change for your vault.
                </li>
              </ul>
            </div>
          </div>

          {/* Pending-timelock notice */}
          {(step === 'set_pending' || step === 'abdicate_pending') && (
            <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/20">
              <Clock className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-text-primary">
                Submitted. Executable at{' '}
                <span className="font-mono">{new Date(Number(executableAt) * 1000).toUTCString()}</span>.
                This page refreshes automatically.
              </p>
            </div>
          )}

          {/* Confirmation checkbox — gates the first (submit) action */}
          {step === 'set_not_submitted' && (
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1 w-4 h-4 accent-accent-primary"
              />
              <span className="text-xs text-text-tertiary">
                I understand this is irreversible. The adapter registry will be permanently locked to the Morpho Registry.
              </span>
            </label>
          )}

          {/* Registry-set success banner once on the abdicate step */}
          {isAbdicateStep && (
            <div className="flex items-start gap-2 p-3 bg-success/10 border border-success/20">
              <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
              <p className="text-xs text-text-primary">
                Registry set. Now abdicate to permanently lock it.
              </p>
            </div>
          )}

          {/* Decoded error banner (PR 6) */}
          {txError && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-danger/10 border border-danger/20">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <p className="text-xs text-danger">
                {txError.message || 'Transaction failed. Please try again.'}
              </p>
            </div>
          )}

          {/* Action buttons — one per timelock sub-state */}
          <div className="space-y-2">
            {step === 'set_not_submitted' && (
              <Button
                className="w-full"
                onClick={submitSetRegistry}
                disabled={!confirmed || setBusy || !expectedRegistry}
              >
                {busyLabel(isSetSimulating, isSetPending, isSetConfirming) ?? 'Submit Registry Change'}
              </Button>
            )}
            {step === 'set_pending' && (
              <Button className="w-full" disabled>Waiting for timelock…</Button>
            )}
            {step === 'set_executable' && (
              <Button className="w-full" onClick={executeSetRegistry} disabled={setBusy}>
                {busyLabel(isSetSimulating, isSetPending, isSetConfirming) ?? 'Execute — Set Registry'}
              </Button>
            )}

            {step === 'abdicate_not_submitted' && (
              <Button variant="danger" className="w-full" onClick={submitAbdicate} disabled={abdBusy}>
                {busyLabel(isAbdSimulating, isAbdPending, isAbdConfirming) ?? 'Submit Abdication'}
              </Button>
            )}
            {step === 'abdicate_pending' && (
              <Button variant="danger" className="w-full" disabled>Waiting for timelock…</Button>
            )}
            {step === 'abdicate_executable' && (
              <Button variant="danger" className="w-full" onClick={executeAbdicate} disabled={abdBusy}>
                {busyLabel(isAbdSimulating, isAbdPending, isAbdConfirming) ?? 'Execute — Lock Registry Permanently'}
              </Button>
            )}
            {step === 'loading' && (
              <Button className="w-full" disabled>Loading…</Button>
            )}
            {step === 'error' && (
              <p className="text-xs text-danger text-center">Could not read vault registry state.</p>
            )}

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => navigate(`/vault/${chainId}/${vaultAddress}`)}
            >
              Return to Vault
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// Re-exported for tests / external step typing.
export type { RegistryStep };
