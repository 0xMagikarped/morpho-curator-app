import { useReadContracts, useAccount } from 'wagmi';
import { toFunctionSelector, zeroAddress } from 'viem';
import { vaultV2RegistryAbi } from '../lib/contracts/vaultV2RegistryAbi';
import { getChainConfig } from '../config/chains';

const SET_REGISTRY_SELECTOR = toFunctionSelector('setAdapterRegistry(address)');

export type RegistryStatus =
  | 'not_set'
  | 'set_not_abdicated'
  | 'set_and_abdicated'
  | 'pending'
  | 'loading'
  | 'error';

export function useRegistryStatus(vaultAddress: `0x${string}`, chainId: number) {
  const { address: userAddress } = useAccount();
  const chainConfig = getChainConfig(chainId);
  const expectedRegistry = chainConfig?.periphery.v2AdapterRegistry;

  const { data, isLoading, error } = useReadContracts({
    contracts: [
      {
        address: vaultAddress,
        abi: vaultV2RegistryAbi,
        functionName: 'adapterRegistry',
        chainId,
      },
      {
        address: vaultAddress,
        abi: vaultV2RegistryAbi,
        functionName: 'abdicated',
        args: [SET_REGISTRY_SELECTOR],
        chainId,
      },
      {
        address: vaultAddress,
        abi: vaultV2RegistryAbi,
        functionName: 'owner',
        chainId,
      },
      {
        address: vaultAddress,
        abi: vaultV2RegistryAbi,
        functionName: 'timelock',
        chainId,
      },
      {
        address: vaultAddress,
        abi: vaultV2RegistryAbi,
        functionName: 'pendingTimelock',
        args: [SET_REGISTRY_SELECTOR],
        chainId,
      },
    ],
    query: {
      enabled: !!vaultAddress,
      staleTime: 5 * 60 * 1000,
    },
  });

  const base = { isOwner: false, registryAddress: null as `0x${string}` | null, expectedRegistry, timelock: 0n, pendingTimelock: null as { value: bigint; validAt: bigint } | null };

  if (isLoading) return { status: 'loading' as const, ...base };
  if (error || !data) return { status: 'error' as const, ...base };

  const currentRegistry = data[0].result as `0x${string}` | undefined;
  const isAbdicated = data[1].result as boolean | undefined;
  const owner = data[2].result as `0x${string}` | undefined;
  const timelock = (data[3].result as bigint) ?? 0n;
  const pendingTimelockData = data[4].result as [bigint, bigint] | undefined;

  const hasRegistry = !!currentRegistry && currentRegistry !== zeroAddress;
  const isOwner = !!userAddress && !!owner && userAddress.toLowerCase() === owner.toLowerCase();
  const hasPendingTimelock = !!pendingTimelockData && pendingTimelockData[1] > 0n;

  let status: RegistryStatus;
  if (hasPendingTimelock) {
    status = 'pending';
  } else if (!hasRegistry) {
    status = 'not_set';
  } else if (hasRegistry && !isAbdicated) {
    status = 'set_not_abdicated';
  } else if (hasRegistry && isAbdicated) {
    status = 'set_and_abdicated';
  } else {
    status = 'error';
  }

  return {
    status,
    isOwner,
    registryAddress: hasRegistry ? currentRegistry : null,
    expectedRegistry,
    timelock,
    pendingTimelock: hasPendingTimelock ? {
      value: pendingTimelockData![0],
      validAt: pendingTimelockData![1],
    } : null,
  };
}
