import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { encodeFunctionData, toFunctionSelector } from 'viem';
import { vaultV2RegistryAbi } from '../lib/contracts/vaultV2RegistryAbi';
import { getChainConfig } from '../config/chains';

const SET_REGISTRY_SELECTOR = toFunctionSelector('setAdapterRegistry(address)');

export function useSetRegistry(vaultAddress: `0x${string}`, chainId: number) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
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

  return { setRegistry, submitSetRegistry, hash, isPending, isConfirming, isSuccess, error, reset };
}

export function useAbdicateRegistry(vaultAddress: `0x${string}`, chainId: number) {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
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

  return { abdicate, submitAbdicate, hash, isPending, isConfirming, isSuccess, error, reset };
}
