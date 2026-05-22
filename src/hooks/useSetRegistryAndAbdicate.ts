import { useWaitForTransactionReceipt } from 'wagmi';
import { useGuardedWriteContract, type DecodedSimError } from './useGuardedWriteContract';
import { encodeFunctionData, toFunctionSelector } from 'viem';
import { vaultV2RegistryAbi } from '../lib/contracts/vaultV2RegistryAbi';
import { getChainConfig } from '../config/chains';

const SET_REGISTRY_SELECTOR = toFunctionSelector('setAdapterRegistry(address)');

/**
 * Collapse the three failure channels of `useGuardedWriteContract` into one
 * `Error` for the page banner. Priority: decoded preflight revert (PR 2's
 * simulate guard) > wallet-not-connected > wagmi write error. Without this the
 * Set Registry page silently does nothing when the simulation fail-closes.
 */
function combineWriteError(
  simulateError: DecodedSimError | null,
  walletError: string | null,
  writeError: unknown,
): Error | null {
  if (simulateError) return new Error(simulateError.message);
  if (walletError) return new Error(walletError);
  return (writeError as Error) ?? null;
}

export function useSetRegistry(vaultAddress: `0x${string}`, chainId: number) {
  const {
    writeContract, data: hash, isPending, isSimulating, error, simulateError, walletError, reset,
  } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const chainConfig = getChainConfig(chainId);
  const registryAddress = chainConfig?.periphery.v2AdapterRegistry;

  const setRegistry = () => {
    if (!registryAddress) return;
    writeContract({
      address: vaultAddress,
      abi: vaultV2RegistryAbi,
      functionName: 'setAdapterRegistry',
      args: [registryAddress],
      chainId,
    });
  };

  const submitSetRegistry = () => {
    if (!registryAddress) return;
    const calldata = encodeFunctionData({
      abi: vaultV2RegistryAbi,
      functionName: 'setAdapterRegistry',
      args: [registryAddress],
    });
    writeContract({
      address: vaultAddress,
      abi: vaultV2RegistryAbi,
      functionName: 'submit',
      args: [calldata],
      chainId,
    });
  };

  return {
    setRegistry, submitSetRegistry, hash, isPending, isSimulating, isConfirming, isSuccess,
    error: combineWriteError(simulateError, walletError, error), reset,
  };
}

export function useAbdicateRegistry(vaultAddress: `0x${string}`, chainId: number) {
  const {
    writeContract, data: hash, isPending, isSimulating, error, simulateError, walletError, reset,
  } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const abdicate = () => {
    writeContract({
      address: vaultAddress,
      abi: vaultV2RegistryAbi,
      functionName: 'abdicate',
      args: [SET_REGISTRY_SELECTOR],
      chainId,
    });
  };

  const submitAbdicate = () => {
    const calldata = encodeFunctionData({
      abi: vaultV2RegistryAbi,
      functionName: 'abdicate',
      args: [SET_REGISTRY_SELECTOR],
    });
    writeContract({
      address: vaultAddress,
      abi: vaultV2RegistryAbi,
      functionName: 'submit',
      args: [calldata],
      chainId,
    });
  };

  return {
    abdicate, submitAbdicate, hash, isPending, isSimulating, isConfirming, isSuccess,
    error: combineWriteError(simulateError, walletError, error), reset,
  };
}
