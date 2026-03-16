/**
 * Hooks for setting V2 adapter caps (absolute + relative) at all three levels.
 *
 * Two strategies:
 * - Sequential: one tx per cap change, with auto-advance. Required because
 *   multicall3 changes msg.sender, breaking vault auth checks.
 * - Batch via vault.multicall: only works if the vault itself has a multicall
 *   that preserves msg.sender (MetaMorpho V2 does have this).
 */
import { useState, useCallback } from 'react';
import { useWriteContract, usePublicClient } from 'wagmi';
import type { Address } from 'viem';
import { encodeFunctionData } from 'viem';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';

export interface CapAction {
  label: string;
  functionName: 'increaseAbsoluteCap' | 'decreaseAbsoluteCap' | 'increaseRelativeCap' | 'decreaseRelativeCap';
  idData: `0x${string}`;
  cap: bigint;
}

export type SetCapsStep = 'idle' | 'pending' | 'confirming' | 'done' | 'error';

/**
 * Set caps sequentially — one wallet confirmation per cap change.
 * This is the safest approach since each tx uses msg.sender = user.
 */
export function useSequentialSetCaps(
  vaultAddress: Address,
  chainId: number,
) {
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<SetCapsStep>('idle');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalActions, setTotalActions] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async (actions: CapAction[]) => {
    if (!publicClient || actions.length === 0) return;

    setStep('pending');
    setError(null);
    setCurrentIndex(0);
    setTotalActions(actions.length);

    try {
      for (let i = 0; i < actions.length; i++) {
        setCurrentIndex(i);
        setStep('pending');

        const action = actions[i];
        const hash = await writeContractAsync({
          address: vaultAddress,
          abi: metaMorphoV2Abi,
          functionName: action.functionName,
          args: [action.idData, action.cap],
          chainId,
        });

        setStep('confirming');
        await publicClient.waitForTransactionReceipt({ hash });
      }

      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Cap transaction failed'));
      setStep('error');
    }
  }, [publicClient, vaultAddress, chainId, writeContractAsync]);

  const reset = useCallback(() => {
    setStep('idle');
    setCurrentIndex(0);
    setTotalActions(0);
    setError(null);
  }, []);

  return { step, currentIndex, totalActions, error, execute, reset };
}

/**
 * Set caps via vault's built-in multicall — single wallet confirmation.
 * This works because MetaMorpho V2's multicall preserves msg.sender.
 */
export function useBatchSetCaps(
  vaultAddress: Address,
  chainId: number,
) {
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<SetCapsStep>('idle');
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async (actions: CapAction[]) => {
    if (!publicClient || actions.length === 0) return;

    setStep('pending');
    setError(null);

    try {
      const calldatas = actions.map((action) =>
        encodeFunctionData({
          abi: metaMorphoV2Abi,
          functionName: action.functionName,
          args: [action.idData, action.cap],
        }),
      );

      const hash = await writeContractAsync({
        address: vaultAddress,
        abi: metaMorphoV2Abi,
        functionName: 'multicall',
        args: [calldatas],
        chainId,
      });

      setStep('confirming');
      await publicClient.waitForTransactionReceipt({ hash });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Batch cap transaction failed'));
      setStep('error');
    }
  }, [publicClient, vaultAddress, chainId, writeContractAsync]);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
  }, []);

  return { step, error, execute, reset };
}
