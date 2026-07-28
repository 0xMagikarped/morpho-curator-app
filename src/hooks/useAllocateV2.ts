/**
 * Hooks for allocate/deallocate on V2 vaults via market adapters.
 *
 * allocate(adapter, data, assets) — data = abi.encode(MarketParams)
 * deallocate(adapter, data, assets) — third arg is the AMOUNT to pull back to
 *   idle, symmetric with allocate (verified against the canonical VaultV2 ABI
 *   in @morpho-org/blue-sdk-viem, where the param is named `assets`).
 */
import { useState, useCallback } from 'react';
import { usePublicClient } from 'wagmi';
import { useGuardedWriteContract } from './useGuardedWriteContract';
import type { Address } from 'viem';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';
import { encodeAllocateData } from '../lib/v2/adapterCapUtils';
import type { MarketParams } from '../types';

export type AllocateStep = 'idle' | 'pending' | 'confirming' | 'done' | 'error';

export function useAllocateV2(vaultAddress: Address, chainId: number) {
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useGuardedWriteContract();

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

  /**
   * Deallocate from a market adapter.
   * @param assets - The AMOUNT of assets to pull back to idle (not the
   *   resulting total). To fully withdraw, pass the current allocation.
   */
  const deallocate = useCallback(async (
    adapterAddress: Address,
    assets: bigint,
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
        args: [adapterAddress, data, assets],
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
