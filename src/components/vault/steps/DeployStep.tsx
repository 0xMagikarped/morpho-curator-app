import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { createPublicClient, custom, type TransactionReceipt, type Hash } from 'viem';
import { mainnet, base } from 'viem/chains';
import { CardHeader, CardTitle } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';
import { ProgressBar } from '../../ui/ProgressBar';
import { getChainConfig } from '../../../config/chains';
import { getPublicClient } from '../../../lib/data/rpcClient';
import { truncateAddress } from '../../../lib/utils/format';
import { sei } from '../../../config/wagmi';
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
import { generateRandomSalt } from '../../../lib/vault/vaultSaltGenerator';
import { useAppStore } from '../../../store/appStore';
import type { WizardState } from '../CreateVaultWizard';

interface DeployStepProps {
  state: WizardState;
  onBack: () => void;
}

type DeployStatus = 'idle' | 'deploying' | 'complete' | 'failed';

const VIEM_CHAINS: Record<number, any> = { 1: mainnet, 8453: base, 1329: sei };

function getExplorerTxUrl(chainId: number | null, txHash: string): string | null {
  if (!chainId) return null;
  const config = getChainConfig(chainId);
  return config?.blockExplorer ? `${config.blockExplorer}/tx/${txHash}` : null;
}

/**
 * Wait for a transaction receipt using multiple strategies:
 * 1. Wallet's EIP-1193 provider (window.ethereum) — most reliable since it broadcast the tx
 * 2. Our configured public RPC client — fallback
 */
async function waitForReceipt(
  chainId: number,
  hash: Hash,
  timeoutMs = 180_000,
): Promise<TransactionReceipt> {
  const startTime = Date.now();

  const ethereum = typeof window !== 'undefined' ? (window as any).ethereum : null;
  if (ethereum) {
    console.log('[Deploy] Polling receipt via wallet provider...');
    try {
      const walletClient = createPublicClient({
        chain: VIEM_CHAINS[chainId],
        transport: custom(ethereum),
      });
      const receipt = await walletClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: timeoutMs,
        pollingInterval: 2_000,
      });
      console.log('[Deploy] Got receipt via wallet provider:', receipt.status);
      return receipt;
    } catch (walletErr) {
      console.warn('[Deploy] Wallet provider receipt failed:', walletErr);
    }
  }

  const elapsed = Date.now() - startTime;
  const remainingTimeout = Math.max(timeoutMs - elapsed, 30_000);
  console.log('[Deploy] Falling back to public RPC for receipt...');
  const publicClient = getPublicClient(chainId);
  return publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: remainingTimeout,
    pollingInterval: 3_000,
  });
}

export function DeployStep({ state, onBack }: DeployStepProps) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { addTrackedVault, persistToEdgeConfig } = useAppStore();

  const [status, setStatus] = useState<DeployStatus>('idle');
  const [steps, setSteps] = useState<TransactionStep[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [vaultAddress, setVaultAddress] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedTxHash, setFailedTxHash] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const chainConfig = state.chainId ? getChainConfig(state.chainId) : null;
  const isV2 = state.version === 'v2';

  // Build steps from state
  const buildSteps = useCallback((salt: `0x${string}`) => {
    if (!state.chainId || !state.owner || !state.asset) return [];

    const curator =
      state.curatorMode === 'owner'
        ? state.owner
        : state.curatorMode === 'custom'
          ? state.curatorAddress ?? undefined
          : undefined;
    const feeRecipient =
      state.feeRecipientMode === 'owner' ? state.owner : state.feeRecipientAddress ?? undefined;

    if (isV2) {
      const v2Params: V2VaultCreationParams = {
        chainId: state.chainId,
        initialOwner: state.owner,
        asset: state.asset,
        name: state.vaultName,
        symbol: state.vaultSymbol,
        salt,
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

      return buildV2DeploymentTxSequence(v2Params, v2PostDeploy);
    } else {
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
        salt,
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

      return buildDeploymentTxSequence(creationParams, postDeploy);
    }
  }, [state, isV2]);

  // Build steps on mount
  useEffect(() => {
    if (!state.salt) return;
    setSteps(buildSteps(state.salt));
  }, [state.salt, buildSteps]);

  const executeSteps = useCallback(async () => {
    if (!walletClient || !state.chainId || !address || steps.length === 0) return;

    setStatus('deploying');
    setError(null);
    setFailedTxHash(null);

    let deployedVaultAddr = vaultAddress;

    for (let i = currentStepIdx; i < steps.length; i++) {
      const step = steps[i];
      setCurrentStepIdx(i);

      // Update step status
      setSteps((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: 'confirming', error: undefined } : s)),
      );

      // Determine target address
      const to = step.to ?? deployedVaultAddr;
      if (!to) {
        setError('Vault address not available — deploy step may have failed');
        setStatus('failed');
        return;
      }

      // Handle steps that require waiting (deferred multicall after timelock)
      if (step.requiresWait && step.requiresWait > 0) {
        setSteps((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: 'waiting', error: `Requires ${step.requiresWait}s timelock wait` }
              : s,
          ),
        );
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

        const receipt = await waitForReceipt(state.chainId!, hash);

        if (receipt.status === 'reverted') {
          const explorerUrl = getExplorerTxUrl(state.chainId, hash);
          const isSaltCollision = i === 0;
          const detail = isSaltCollision
            ? 'Transaction reverted — likely a salt collision. Try again with a new salt.'
            : 'Transaction reverted on-chain. The vault is deployed but configuration failed — you can retry or configure manually.';
          setFailedTxHash(hash);
          throw new Error(explorerUrl ? detail : detail);
        }

        // Parse vault address from deploy step
        if (i === 0) {
          let addr = isV2
            ? parseV2VaultAddressFromReceipt(receipt)
            : parseVaultAddressFromReceipt(receipt);

          // Fallback for V2: query factory's vaultV2() view if event parsing failed
          if (!addr && isV2 && state.salt) {
            console.warn('[Deploy] Event parsing returned null, trying factory vaultV2() view...');
            try {
              const factoryAddr = chainConfig?.vaultFactories.v2;
              if (factoryAddr) {
                const client = getPublicClient(state.chainId!);
                const result = await client.readContract({
                  address: factoryAddr,
                  abi: [{ inputs: [{ type: 'address' }, { type: 'address' }, { type: 'bytes32' }], name: 'vaultV2', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' }] as const,
                  functionName: 'vaultV2',
                  args: [state.owner!, state.asset!, state.salt],
                }) as `0x${string}`;
                if (result && result !== '0x0000000000000000000000000000000000000000') {
                  addr = result;
                  console.log('[Deploy] Got vault address from factory view:', addr);
                }
              }
            } catch (viewErr) {
              console.warn('[Deploy] Factory vaultV2() view failed:', viewErr);
            }
          }

          if (addr) {
            deployedVaultAddr = addr;
            setVaultAddress(addr);
            const vault = {
              address: addr,
              chainId: state.chainId!,
              name: state.vaultName,
              version: state.version,
            };
            addTrackedVault(vault);
            if (address) persistToEdgeConfig(address);
          }
        }

        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: 'confirmed' } : s)),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Transaction failed';
        setSteps((prev) => {
          const currentStep = prev[i];
          if (currentStep?.txHash) setFailedTxHash(currentStep.txHash);
          return prev.map((s, idx) => (idx === i ? { ...s, status: 'failed', error: message } : s));
        });
        setError(message);
        setStatus('failed');
        return;
      }
    }

    setStatus('complete');
  }, [walletClient, address, steps, currentStepIdx, vaultAddress, state, addTrackedVault, persistToEdgeConfig, isV2, chainConfig]);

  const handleRetry = () => {
    if (currentStepIdx === 0) {
      const newSalt = generateRandomSalt();
      const newSteps = buildSteps(newSalt);
      setSteps(newSteps);
    }
    setError(null);
    setFailedTxHash(null);
    executeSteps();
  };

  const progress = steps.length > 0
    ? Math.round((steps.filter((s) => s.status === 'confirmed').length / steps.length) * 100)
    : 0;

  const failedExplorerUrl = failedTxHash
    ? getExplorerTxUrl(state.chainId, failedTxHash)
    : null;

  // Count total operations across multicall steps
  const totalOps = steps.reduce((acc, s) => acc + (s.operations?.filter(l => !l.startsWith('Submit:')).length ?? 0), 0);

  return (
    <div className="space-y-6">
      <CardHeader>
        <CardTitle>Deployment</CardTitle>
        <div className="flex gap-2">
          <Badge variant={isV2 ? 'info' : 'success'}>{isV2 ? 'V2' : 'V1'}</Badge>
          {status === 'complete' && <Badge variant="success">Complete</Badge>}
          {status === 'deploying' && <Badge variant="warning">In Progress</Badge>}
          {status === 'failed' && <Badge variant="warning">Failed</Badge>}
        </div>
      </CardHeader>

      {/* Summary line */}
      {status === 'idle' && (
        <p className="text-xs text-text-tertiary">
          {steps.length === 1
            ? '1 transaction — deploy only (no additional config)'
            : `${steps.length} transactions${totalOps > 0 ? ` — ${totalOps} config operations batched via multicall` : ''}`}
        </p>
      )}

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
          <div key={step.id}>
            <div
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
                  className={`hover:underline font-mono ${
                    step.status === 'failed' ? 'text-danger' : 'text-info'
                  }`}
                >
                  {truncateAddress(step.txHash)}
                </a>
              )}
              {step.error && step.status === 'waiting' && (
                <span className="text-warning">{step.error}</span>
              )}
              {step.error && step.status === 'failed' && (
                <span className="text-danger truncate max-w-[250px]" title={step.error}>
                  {step.error}
                </span>
              )}
              {/* Expand/collapse toggle for multicall operations */}
              {step.operations && step.operations.length > 0 && (
                <button
                  onClick={() => setExpandedStep(expandedStep === i ? null : i)}
                  className="text-text-tertiary hover:text-text-primary text-[10px] px-1"
                  aria-label={expandedStep === i ? 'Collapse operations' : 'Expand operations'}
                >
                  {expandedStep === i ? '▼' : '▶'} {step.operations.filter(l => !l.startsWith('Submit:')).length} ops
                </button>
              )}
            </div>

            {/* Expandable multicall operation breakdown */}
            {step.operations && expandedStep === i && (
              <div className="ml-7 border-l border-border-subtle pl-3 py-1 space-y-0.5">
                {step.operations
                  .filter(label => !label.startsWith('Submit:'))
                  .map((label, j) => (
                    <div key={j} className="flex items-center gap-2 text-[11px] text-text-tertiary">
                      <span className={step.status === 'confirmed' ? 'text-success' : 'text-text-tertiary'}>
                        {step.status === 'confirmed' ? '✓' : '○'}
                      </span>
                      {label}
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-danger/15 p-3 text-xs space-y-2">
          <p className="text-danger">{error}</p>
          {failedExplorerUrl && (
            <a
              href={failedExplorerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-danger/80 hover:underline font-mono inline-block"
            >
              View failed transaction on explorer
            </a>
          )}
        </div>
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
          <p className="text-xs text-text-tertiary animate-shimmer">
            Waiting for transaction confirmation...
          </p>
        )}
        {status === 'failed' && (
          <>
            <Button variant="secondary" onClick={onBack}>
              Back
            </Button>
            <Button onClick={handleRetry}>
              {currentStepIdx === 0 ? 'Retry with New Salt' : 'Retry Configuration'}
            </Button>
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
