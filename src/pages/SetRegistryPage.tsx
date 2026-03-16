import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, AlertTriangle, ArrowLeft, Lock, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useRegistryStatus } from '../hooks/useRegistryStatus';
import { useSetRegistry, useAbdicateRegistry } from '../hooks/useSetRegistryAndAbdicate';
import { getChainConfig } from '../config/chains';
import { truncateAddress } from '../lib/utils/format';

type Step = 'review' | 'abdicate' | 'complete';

export function SetRegistryPage() {
  const { chainId: chainIdParam, address } = useParams<{ chainId: string; address: string }>();
  const navigate = useNavigate();
  const chainId = Number(chainIdParam);
  const vaultAddress = address as `0x${string}`;
  const chainConfig = getChainConfig(chainId);

  const { status, isOwner, expectedRegistry, timelock } = useRegistryStatus(vaultAddress, chainId);
  const {
    setRegistry, submitSetRegistry,
    isPending: isSettingRegistry, isConfirming: isConfirmingRegistry,
    isSuccess: registrySet, error: registryError,
  } = useSetRegistry(vaultAddress, chainId);
  const {
    abdicate, submitAbdicate,
    isPending: isAbdicating, isConfirming: isConfirmingAbdicate,
    isSuccess: abdicateSuccess, error: abdicateError,
  } = useAbdicateRegistry(vaultAddress, chainId);

  const [confirmed, setConfirmed] = useState(false);

  const getCurrentStep = (): Step => {
    if (status === 'set_and_abdicated' || abdicateSuccess) return 'complete';
    if (status === 'set_not_abdicated' || registrySet) return 'abdicate';
    return 'review';
  };

  const currentStep = getCurrentStep();
  const hasTimelock = timelock > 0n;
  const txError = registryError || abdicateError;

  if (!chainId || !vaultAddress) {
    return (
      <div className="text-center py-12">
        <p className="text-text-tertiary">Invalid vault URL.</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate('/')}>Back to Dashboard</Button>
      </div>
    );
  }

  // Not the owner
  if (!isOwner && status !== 'loading') {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <Card>
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-text-tertiary" />
              <h1 className="text-lg font-bold text-text-primary">Set the Morpho Registry</h1>
            </div>
            <p className="text-sm text-text-tertiary">
              Only the vault owner can set and abdicate the adapter registry.
            </p>
            <Button variant="ghost" className="w-full" onClick={() => navigate(`/vault/${chainId}/${vaultAddress}`)}>
              Return to Vault
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Complete state
  if (currentStep === 'complete') {
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

  return (
    <div className="max-w-lg mx-auto mt-8 space-y-4">
      {/* Back link */}
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
          <Badge variant={currentStep === 'abdicate' ? 'success' : 'warning'}>
            {currentStep === 'abdicate' ? 'Step 2: Abdicate' : 'Step 1: Set Registry'}
          </Badge>
        </CardHeader>

        <div className="space-y-5">
          <p className="text-sm text-text-tertiary">
            To use adapters, assign the Morpho Registry to this vault. This change is permanent.
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

          {/* Timelock warning */}
          {hasTimelock && currentStep === 'review' && (
            <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/20">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-text-primary">
                This vault has a timelock of {Number(timelock)}s. The registry change will need to be submitted first, then executed after the timelock expires.
              </p>
            </div>
          )}

          {/* Confirmation checkbox */}
          {currentStep === 'review' && (
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

          {/* Success banner for abdicate step */}
          {currentStep === 'abdicate' && (
            <div className="flex items-start gap-2 p-3 bg-success/10 border border-success/20">
              <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
              <p className="text-xs text-text-primary">
                Registry set successfully. Now abdicate to permanently lock it.
              </p>
            </div>
          )}

          {/* Error display */}
          {txError && (
            <div className="flex items-start gap-2 p-3 bg-danger/10 border border-danger/20">
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <p className="text-xs text-danger">
                {txError.message || 'Transaction failed. Please try again.'}
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="space-y-2">
            {currentStep === 'review' && (
              <Button
                className="w-full"
                onClick={() => hasTimelock ? submitSetRegistry() : setRegistry()}
                disabled={!confirmed || isSettingRegistry || isConfirmingRegistry || !expectedRegistry}
              >
                {isSettingRegistry
                  ? 'Confirm in Wallet...'
                  : isConfirmingRegistry
                    ? 'Confirming...'
                    : hasTimelock
                      ? 'Submit Registry Change'
                      : 'Set Registry & Continue to Abdicate'}
              </Button>
            )}

            {currentStep === 'abdicate' && (
              <Button
                variant="danger"
                className="w-full"
                onClick={() => hasTimelock ? submitAbdicate() : abdicate()}
                disabled={isAbdicating || isConfirmingAbdicate}
              >
                {isAbdicating
                  ? 'Confirm in Wallet...'
                  : isConfirmingAbdicate
                    ? 'Confirming...'
                    : hasTimelock
                      ? 'Submit Abdication'
                      : 'Abdicate — Lock Registry Permanently'}
              </Button>
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
