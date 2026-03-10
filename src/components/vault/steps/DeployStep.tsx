import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { ProgressBar } from '../../ui/ProgressBar';
import { getChainConfig } from '../../../config/chains';
import { truncateAddress } from '../../../lib/utils/format';
import {
  buildDeploymentTxSequence,
  buildV2DeploymentTxSequence,
  parseVaultAddressFromReceipt,
  parseV2VaultAddressFromReceipt,
  feePercentToWad,
  type TransactionStep,
  type PostDeployConfig,
  type VaultCreationParams,
  type V2VaultCreationParams,
  type V2PostDeployConfig,
} from '../../../lib/vault/createVault';
import { useAppStore } from '../../../store/appStore';
import type { WizardState } from '../CreateVaultWizard';

interface DeployStepProps {
  state: WizardState;
  onBack: () => void;
}

type DeployStatus = 'idle' | 'deploying' | 'paused' | 'complete' | 'failed';

export function DeployStep({ state, onBack }: DeployStepProps) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { addTrackedVault } = useAppStore();

  const [status, setStatus] = useState<DeployStatus>('idle');
  const [steps, setSteps] = useState<TransactionStep[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [vaultAddress, setVaultAddress] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pausedRef = useRef(false);

  const chainConfig = state.chainId ? getChainConfig(state.chainId) : null;

  const isV2 = state.version === 'v2';

  // Build steps on mount
  useEffect(() => {
    if (!state.chainId || !state.owner || !state.asset || !state.salt) return;

    const curator =
      state.curatorMode === 'owner'
        ? state.owner
        : state.curatorMode === 'custom'
          ? state.curatorAddress ?? undefined
          : undefined;
    const feeRecipient =
      state.feeRecipientMode === 'owner' ? state.owner : state.feeRecipientAddress ?? undefined;

    if (isV2) {
      // V2 deployment
      const v2Params: V2VaultCreationParams = {
        chainId: state.chainId,
        initialOwner: state.owner,
        asset: state.asset,
        name: state.vaultName,
        symbol: state.vaultSymbol,
        salt: state.salt,
      };

      const mgmtFeeRecipient =
        state.managementFeeRecipientMode === 'owner'
          ? state.owner
          : state.managementFeeRecipientAddress ?? undefined;

      const v2PostDeploy: V2PostDeployConfig = {
        curator,
        allocators: state.allocators.length > 0 ? state.allocators : undefined,
        sentinels: state.sentinels.length > 0 ? state.sentinels : undefined,
        performanceFee: state.feePercent > 0 ? feePercentToWad(state.feePercent) : undefined,
        performanceFeeRecipient: feeRecipient,
        managementFee: state.managementFeePercent > 0 ? feePercentToWad(state.managementFeePercent) : undefined,
        managementFeeRecipient: state.managementFeePercent > 0 ? mgmtFeeRecipient : undefined,
        timelocks: state.v2Timelocks.length > 0 ? state.v2Timelocks : undefined,
      };

      setSteps(buildV2DeploymentTxSequence(v2Params, v2PostDeploy));
    } else {
      // V1 deployment
      const guardian =
        state.guardianMode === 'custom' ? state.guardianAddress ?? undefined : undefined;

      const isZeroThenIncrease = state.timelockStrategy === 'zero-then-increase';

      const creationParams: VaultCreationParams = {
        chainId: state.chainId,
        initialOwner: state.owner,
        initialTimelock: BigInt(state.initialTimelockSeconds),
        asset: state.asset,
        name: state.vaultName,
        symbol: state.vaultSymbol,
        salt: state.salt,
      };

      const postDeploy: PostDeployConfig = {
        curator,
        allocators: state.allocators.length > 0 ? state.allocators : undefined,
        guardian,
        fee: state.feePercent > 0 ? feePercentToWad(state.feePercent) : undefined,
        feeRecipient,
        initialMarkets: state.selectedMarkets
          .filter((m) => m.supplyCap)
          .map((m) => ({
            marketParams: m.marketParams,
            supplyCap: BigInt(
              Math.round(Number(m.supplyCap) * 10 ** state.assetDecimals),
            ),
          })),
        finalTimelock:
          isZeroThenIncrease && state.finalTimelockSeconds > 0
            ? BigInt(state.finalTimelockSeconds)
            : undefined,
      };

      setSteps(buildDeploymentTxSequence(creationParams, postDeploy));
    }
  }, [state, isV2]);

  const executeSteps = useCallback(async () => {
    if (!walletClient || !publicClient || !address || steps.length === 0) return;

    setStatus('deploying');
    setError(null);
    pausedRef.current = false;

    let deployedVaultAddr = vaultAddress;

    for (let i = currentStepIdx; i < steps.length; i++) {
      if (pausedRef.current) {
        setStatus('paused');
        return;
      }

      const step = steps[i];
      setCurrentStepIdx(i);

      // Update step status
      setSteps((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: 'confirming' } : s)),
      );

      // Determine target address
      const to = step.to ?? deployedVaultAddr;
      if (!to) {
        setError('Vault address not available — deploy step may have failed');
        setStatus('failed');
        return;
      }

      // Handle steps that require waiting
      if (step.requiresWait && step.requiresWait > 0) {
        setSteps((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: 'waiting', error: `Requires ${step.requiresWait}s timelock wait` }
              : s,
          ),
        );
        // Skip this step — user must come back later
        continue;
      }

      try {
        const hash = await walletClient.sendTransaction({
          to,
          data: step.data,
          chain: walletClient.chain,
          account: address,
        });

        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, txHash: hash, status: 'confirming' } : s)),
        );

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted');
        }

        // Parse vault address from deploy step
        if (i === 0) {
          const addr = isV2
            ? parseV2VaultAddressFromReceipt(receipt)
            : parseVaultAddressFromReceipt(receipt);
          if (addr) {
            deployedVaultAddr = addr;
            setVaultAddress(addr);
            addTrackedVault({
              address: addr,
              chainId: state.chainId!,
              name: state.vaultName,
              version: state.version,
            });
          }
        }

        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: 'confirmed' } : s)),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Transaction failed';
        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: 'failed', error: message } : s)),
        );
        setError(message);
        setStatus('failed');
        return;
      }
    }

    setStatus('complete');
  }, [walletClient, publicClient, address, steps, currentStepIdx, vaultAddress, state, addTrackedVault]);

  const handlePause = () => {
    pausedRef.current = true;
  };

  const handleRetry = () => {
    setError(null);
    executeSteps();
  };

  const progress = steps.length > 0
    ? Math.round((steps.filter((s) => s.status === 'confirmed').length / steps.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <CardHeader>
        <CardTitle>Deployment</CardTitle>
        {status === 'complete' && <Badge variant="success">Complete</Badge>}
        {status === 'deploying' && <Badge variant="warning">In Progress</Badge>}
        {status === 'failed' && <Badge variant="warning">Failed</Badge>}
      </CardHeader>

      {/* Vault address */}
      {vaultAddress && (
        <div className="bg-success/15 p-3 text-xs">
          <span className="text-success">Vault deployed: </span>
          <a
            href={`${chainConfig?.blockExplorer}/address/${vaultAddress}`}
            target="_blank"
            rel="noreferrer"
            className="text-success font-mono hover:underline"
          >
            {vaultAddress}
          </a>
        </div>
      )}

      {/* Progress */}
      <ProgressBar value={progress} variant="default" />

      {/* Steps list */}
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div
            key={step.id}
            className={`flex items-center gap-3 px-3 py-2 text-xs ${
              i === currentStepIdx && status === 'deploying'
                ? 'bg-bg-hover/60'
                : 'bg-bg-hover/20'
            }`}
          >
            <StepIcon status={step.status} />
            <span className="text-text-primary flex-1">{step.label}</span>
            {step.txHash && (
              <a
                href={`${chainConfig?.blockExplorer}/tx/${step.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-info hover:underline font-mono"
              >
                {truncateAddress(step.txHash)}
              </a>
            )}
            {step.error && step.status === 'waiting' && (
              <span className="text-warning">{step.error}</span>
            )}
            {step.error && step.status === 'failed' && (
              <span className="text-danger truncate max-w-[200px]">{step.error}</span>
            )}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-danger/15 p-3 text-xs text-danger">{error}</div>
      )}

      {/* Actions */}
      <div className="flex justify-between pt-2">
        {status === 'idle' && (
          <>
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
            <Button onClick={executeSteps} disabled={!walletClient}>
              {walletClient ? 'Start Deployment' : 'Connect Wallet'}
            </Button>
          </>
        )}
        {status === 'deploying' && (
          <Button variant="secondary" onClick={handlePause}>
            Pause
          </Button>
        )}
        {status === 'paused' && (
          <Button onClick={executeSteps}>Resume</Button>
        )}
        {status === 'failed' && (
          <>
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
            <Button onClick={handleRetry}>Retry from Failed Step</Button>
          </>
        )}
        {status === 'complete' && (
          <p className="text-xs text-success">
            All transactions complete. Your vault is ready.
          </p>
        )}
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'confirmed':
      return <span className="text-success w-4 text-center">✓</span>;
    case 'confirming':
      return <span className="text-info w-4 text-center animate-shimmer">●</span>;
    case 'failed':
      return <span className="text-danger w-4 text-center">✗</span>;
    case 'waiting':
      return <span className="text-warning w-4 text-center">⏳</span>;
    default:
      return <span className="text-text-tertiary w-4 text-center">○</span>;
  }
}
