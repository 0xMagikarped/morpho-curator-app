/**
 * Hook to deploy a MorphoMarketV1AdapterV2 via the factory and add it to a
 * V2 vault.
 *
 * PR 11 — corrects the V2 governance flow: `addAdapter` is timelocked, so we
 * cannot call it directly. The correct sequence is
 *
 *   factory.createMorphoMarketV1AdapterV2(parentVault)   // skip if exists
 *     -> vault.submit(encodeCall(addAdapter, [adapter])) // queue
 *     -> wait until executableAt(submitCalldata) ≤ now   // 0-timelock = instant
 *     -> vault.addAdapter(adapter)                       // self-checks executableAt
 *
 * Decisions live in the pure `nextDeployStep` helper so the logic is unit-
 * testable without spinning up wagmi/React.
 *
 * Factory signature: `createMorphoMarketV1AdapterV2(parentVault)` — the
 * factory reads the vault's asset and CREATE2-derives the adapter, so it's
 * idempotent: a second call reverts. We short-circuit on the factory's
 * `morphoMarketV1AdapterV2(parentVault)` view (PR 9).
 */
import { useState, useCallback } from 'react';
import { usePublicClient } from 'wagmi';
import { useGuardedWriteContract } from './useGuardedWriteContract';
import type { Address } from 'viem';
import { decodeEventLog, encodeFunctionData, zeroAddress } from 'viem';
import { marketV1AdapterV2FactoryAbi } from '../lib/contracts/marketAdapterFactoryAbi';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';
import { vaultV2RegistryAbi } from '../lib/contracts/vaultV2RegistryAbi';
import { getChainConfig } from '../config/chains';
import { nextDeployStep } from './deployAdapterStateMachine';

export type DeployStep =
  | 'idle'
  | 'deploying'
  | 'confirming-deploy'
  | 'submitting-add'
  | 'confirming-submit'
  | 'waiting-timelock'
  | 'adding'
  | 'confirming-add'
  | 'done'
  | 'error';

interface UseDeployMarketAdapterReturn {
  step: DeployStep;
  deployedAdapter: Address | null;
  deployHash: `0x${string}` | undefined;
  submitHash: `0x${string}` | undefined;
  addHash: `0x${string}` | undefined;
  /**
   * When `step === 'waiting-timelock'`, the unix-seconds at which `addAdapter`
   * becomes executable. UI surfaces this so the user knows when to come back.
   */
  executableAt: bigint | null;
  error: Error | null;
  deploy: () => void;
  reset: () => void;
}

export function useDeployMarketAdapter(
  vaultAddress: Address,
  chainId: number,
): UseDeployMarketAdapterReturn {
  const chainConfig = getChainConfig(chainId);
  const factoryAddress = chainConfig?.periphery.morphoMarketV1AdapterV2Factory;
  const publicClient = usePublicClient({ chainId });

  const [step, setStep] = useState<DeployStep>('idle');
  const [deployedAdapter, setDeployedAdapter] = useState<Address | null>(null);
  const [executableAt, setExecutableAt] = useState<bigint | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const { writeContractAsync: writeDeployAsync, data: deployHash } = useGuardedWriteContract();
  const { writeContractAsync: writeSubmitAsync, data: submitHash } = useGuardedWriteContract();
  const { writeContractAsync: writeAddAsync, data: addHash } = useGuardedWriteContract();

  const deploy = useCallback(async () => {
    if (!factoryAddress || !publicClient) {
      setError(new Error('Factory not configured for this chain'));
      setStep('error');
      return;
    }

    try {
      setError(null);
      setExecutableAt(null);

      // ============================================================
      // Phase 1 — resolve / deploy the adapter via factory
      // ============================================================
      let adapterAddress: Address | null = null;
      const existing = (await publicClient.readContract({
        address: factoryAddress,
        abi: marketV1AdapterV2FactoryAbi,
        functionName: 'morphoMarketV1AdapterV2',
        args: [vaultAddress],
      })) as Address;

      if (existing && existing !== zeroAddress) {
        // PR 9 idempotency — factory already has an adapter for this vault.
        adapterAddress = existing;
        setDeployedAdapter(adapterAddress);
      } else {
        setStep('deploying');
        const deployTxHash = await writeDeployAsync({
          address: factoryAddress,
          abi: marketV1AdapterV2FactoryAbi,
          functionName: 'createMorphoMarketV1AdapterV2',
          args: [vaultAddress],
          chainId,
        });

        setStep('confirming-deploy');
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: deployTxHash,
        });

        // PR 9 — event arg is named `morphoMarketV1AdapterV2` and indexed.
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: marketV1AdapterV2FactoryAbi,
              data: log.data,
              topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
            });
            if (decoded.eventName === 'CreateMorphoMarketV1AdapterV2') {
              adapterAddress = (decoded.args as { morphoMarketV1AdapterV2: Address }).morphoMarketV1AdapterV2;
              break;
            }
          } catch {
            // Not our event
          }
        }
        if (!adapterAddress) {
          throw new Error('Could not find deployed adapter address in transaction logs');
        }
        setDeployedAdapter(adapterAddress);
      }

      // ============================================================
      // Phase 2 — V2 submit→wait→execute (PR 11)
      // ============================================================
      const addCalldata = encodeFunctionData({
        abi: metaMorphoV2Abi,
        functionName: 'addAdapter',
        args: [adapterAddress],
      });

      // Drive the next action off on-chain truth + the pure helper so the
      // resume-after-refresh case works automatically (i.e. user closed the
      // tab between submit and execute; we just read the state and pick up).
      // We re-read between each tx because mining advances the state.
      while (true) {
        const [vaultIsAdapter, currentExecutableAt] = await Promise.all([
          publicClient.readContract({
            address: vaultAddress,
            abi: metaMorphoV2Abi,
            functionName: 'isAdapter',
            args: [adapterAddress],
          }) as Promise<boolean>,
          publicClient.readContract({
            address: vaultAddress,
            abi: vaultV2RegistryAbi,
            functionName: 'executableAt',
            args: [addCalldata],
          }) as Promise<bigint>,
        ]);

        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        const decision = nextDeployStep({
          factoryAdapter: adapterAddress,
          vaultIsAdapter,
          executableAt: currentExecutableAt,
          nowSec,
        });

        if (decision.kind === 'already-added') {
          setStep('done');
          return;
        }
        if (decision.kind === 'awaiting-timelock') {
          setExecutableAt(decision.executableAt);
          setStep('waiting-timelock');
          return;
        }
        if (decision.kind === 'needs-submit') {
          setStep('submitting-add');
          const submitTxHash = await writeSubmitAsync({
            address: vaultAddress,
            abi: metaMorphoV2Abi,
            functionName: 'submit',
            args: [addCalldata],
            chainId,
          });
          setStep('confirming-submit');
          await publicClient.waitForTransactionReceipt({ hash: submitTxHash });
          // Loop — re-read executableAt, which may now be in the future
          // (non-zero timelock) or already elapsed (0-timelock).
          continue;
        }
        if (decision.kind === 'ready-to-execute') {
          setStep('adding');
          const addTxHash = await writeAddAsync({
            address: vaultAddress,
            abi: metaMorphoV2Abi,
            functionName: 'addAdapter',
            args: [adapterAddress],
            chainId,
          });
          setStep('confirming-add');
          await publicClient.waitForTransactionReceipt({ hash: addTxHash });
          setStep('done');
          return;
        }
        // decision.kind === 'needs-deploy' — should never happen here because
        // Phase 1 just guaranteed `adapterAddress`. Defensive fall-through.
        throw new Error('Internal state error: factory adapter missing after Phase 1');
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Transaction failed'));
      setStep('error');
    }
  }, [factoryAddress, publicClient, vaultAddress, chainId, writeDeployAsync, writeSubmitAsync, writeAddAsync]);

  const reset = useCallback(() => {
    setStep('idle');
    setDeployedAdapter(null);
    setExecutableAt(null);
    setError(null);
  }, []);

  return {
    step,
    deployedAdapter,
    deployHash,
    submitHash,
    addHash,
    executableAt,
    error,
    deploy,
    reset,
  };
}
