/**
 * Hook to deploy a MorphoMarketV1AdapterV2 via the factory,
 * then add it to a V2 vault.
 *
 * Factory signature: createMorphoMarketV1AdapterV2(parentVault)
 * The factory reads the vault's asset and creates the adapter.
 */
import { useState, useCallback } from 'react';
import { useWriteContract, usePublicClient } from 'wagmi';
import type { Address } from 'viem';
import { decodeEventLog } from 'viem';
import { marketV1AdapterV2FactoryAbi } from '../lib/contracts/marketAdapterFactoryAbi';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';
import { getChainConfig } from '../config/chains';

export type DeployStep = 'idle' | 'deploying' | 'confirming-deploy' | 'adding' | 'confirming-add' | 'done' | 'error';

interface UseDeployMarketAdapterReturn {
  step: DeployStep;
  deployedAdapter: Address | null;
  deployHash: `0x${string}` | undefined;
  addHash: `0x${string}` | undefined;
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
  const [error, setError] = useState<Error | null>(null);

  const {
    writeContractAsync: writeDeployAsync,
    data: deployHash,
  } = useWriteContract();

  const {
    writeContractAsync: writeAddAsync,
    data: addHash,
  } = useWriteContract();

  const deploy = useCallback(async () => {
    if (!factoryAddress || !publicClient) {
      setError(new Error('Factory not configured for this chain'));
      setStep('error');
      return;
    }

    try {
      setStep('deploying');
      setError(null);
      setDeployedAdapter(null);

      // Step 1: Deploy adapter via factory — single arg: parentVault
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

      // Parse adapter address from event logs
      // Event: CreateMorphoMarketV1AdapterV2(parentVault indexed, adapter NOT indexed)
      // adapter is in data, not in topics
      let adapterAddress: Address | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: marketV1AdapterV2FactoryAbi,
            data: log.data,
            topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
          });
          if (decoded.eventName === 'CreateMorphoMarketV1AdapterV2') {
            adapterAddress = (decoded.args as { adapter: Address }).adapter;
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

      // Step 2: Add adapter to vault
      setStep('adding');
      const addTxHash = await writeAddAsync({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: 'addAdapter',
        args: [adapterAddress],
        chainId,
      });

      setStep('confirming-add');

      await publicClient.waitForTransactionReceipt({
        hash: addTxHash,
      });

      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Transaction failed'));
      setStep('error');
    }
  }, [factoryAddress, publicClient, vaultAddress, chainId, writeDeployAsync, writeAddAsync]);

  const reset = useCallback(() => {
    setStep('idle');
    setDeployedAdapter(null);
    setError(null);
  }, []);

  return {
    step,
    deployedAdapter,
    deployHash,
    addHash,
    error,
    deploy,
    reset,
  };
}
