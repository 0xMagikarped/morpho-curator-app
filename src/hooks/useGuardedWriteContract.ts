import { useCallback, useState } from 'react';
import { useAccount, useWriteContract } from 'wagmi';

/**
 * Wraps wagmi's useWriteContract with:
 * 1. Wallet connection guard before every write
 * 2. Full error message (no truncation)
 */
export function useGuardedWriteContract() {
  const { isConnected } = useAccount();
  const result = useWriteContract();
  const [walletError, setWalletError] = useState<string | null>(null);

  const guardedWriteContract: typeof result.writeContract = useCallback(
    (...args) => {
      setWalletError(null);
      if (!isConnected) {
        setWalletError('Please connect your wallet first');
        return;
      }
      result.writeContract(...args);
    },
    [isConnected, result],
  );

  const guardedWriteContractAsync: typeof result.writeContractAsync = useCallback(
    async (...args) => {
      setWalletError(null);
      if (!isConnected) {
        setWalletError('Please connect your wallet first');
        throw new Error('Wallet not connected');
      }
      return result.writeContractAsync(...args);
    },
    [isConnected, result],
  );

  return {
    ...result,
    writeContract: guardedWriteContract,
    writeContractAsync: guardedWriteContractAsync,
    walletError,
    isConnected,
  };
}
