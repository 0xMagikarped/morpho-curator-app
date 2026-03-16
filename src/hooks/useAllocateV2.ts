/**
 * Hooks for allocate/deallocate on V2 vaults via market adapters.
 *
 * allocate(adapter, data, amount) — data = abi.encode(MarketParams)
 * deallocate(adapter, data, amount) — same encoding
 */
import { useState, useCallback } from 'react';
import { useWriteContract, usePublicClient } from 'wagmi';
import type { Address } from 'viem';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';
import { encodeAllocateData } from '../lib/v2/adapterCapUtils';
import type { MarketParams } from '../types';

export type AllocateStep = 'idle' | 'pending' | 'confirming' | 'done' | 'error';

export function useAllocateV2(vaultAddress: Address, chainId: number) {
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<AllocateStep>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [hash, setHash] = useState<`0x${string}` | undefined>();

  const allocate = useCallback(async (
    adapterAddress: Address,
    amount: bigint,
    marketParams: MarketParams,
  ) => {
    if (!publicClient) return;

    setStep('pending');
    setError(null);
    setHash(undefined);

    try {
      const data = encodeAllocateData(marketParams);
      const txHash = await writeContractAsync({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: 'allocate',
        args: [adapterAddress, data, amount],
        chainId,
      });

      setHash(txHash);
      setStep('confirming');
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Allocate failed'));
      setStep('error');
    }
  }, [publicClient, vaultAddress, chainId, writeContractAsync]);

  const deallocate = useCallback(async (
    adapterAddress: Address,
    amount: bigint,
    marketParams: MarketParams,
  ) => {
    if (!publicClient) return;

    setStep('pending');
    setError(null);
    setHash(undefined);

    try {
      const data = encodeAllocateData(marketParams);
      const txHash = await writeContractAsync({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: 'deallocate',
        args: [adapterAddress, data, amount],
        chainId,
      });

      setHash(txHash);
      setStep('confirming');
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Deallocate failed'));
      setStep('error');
    }
  }, [publicClient, vaultAddress, chainId, writeContractAsync]);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setHash(undefined);
  }, []);

  return { step, error, hash, allocate, deallocate, reset };
}
