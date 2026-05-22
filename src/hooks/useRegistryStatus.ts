import { useReadContracts, useAccount } from 'wagmi';
import { toFunctionSelector, encodeFunctionData, zeroAddress } from 'viem';
import { vaultV2RegistryAbi } from '../lib/contracts/vaultV2RegistryAbi';
import { getChainConfig } from '../config/chains';

export const SET_REGISTRY_SELECTOR = toFunctionSelector('setAdapterRegistry(address)');

/**
 * Set Registry & Abdicate flow state. Morpho Vault V2 timelocks config
 * changes: each operation must be `submit`-ted, then (after its per-selector
 * timelock) executed by calling the target function directly. So each of the
 * two operations (set registry, abdicate) has a submit → wait → execute
 * lifecycle. With a 0-duration timelock the `*_pending` state is skipped
 * (executableAt == submit time).
 */
export type RegistryStep =
  | 'loading'
  | 'error'
  | 'set_not_submitted' // registry unset, nothing queued → submit
  | 'set_pending' // submitted, waiting for the timelock → wait
  | 'set_executable' // submitted & elapsed → execute setAdapterRegistry
  | 'abdicate_not_submitted' // registry set, abdication not queued → submit
  | 'abdicate_pending'
  | 'abdicate_executable'
  | 'complete'; // registry set AND abdicated

export interface RegistryStatus {
  step: RegistryStep;
  /** True if the connected wallet may drive the flow (owner or curator —
   *  `submit` is curator-gated on V2; owner is allowed defensively). */
  canManage: boolean;
  isOwner: boolean;
  isCurator: boolean;
  expectedRegistry?: `0x${string}`;
  registryAddress: `0x${string}` | null;
  /** Unix-seconds the queued op becomes executable (0 = not submitted). */
  executableAt: bigint;
}

export function useRegistryStatus(
  vaultAddress: `0x${string}`,
  chainId: number,
): RegistryStatus {
  const { address: userAddress } = useAccount();
  const chainConfig = getChainConfig(chainId);
  const expectedRegistry = chainConfig?.periphery.v2AdapterRegistry;

  // The exact calldata each operation submits — `executableAt` is keyed on it.
  const setRegistryData = expectedRegistry
    ? encodeFunctionData({
        abi: vaultV2RegistryAbi,
        functionName: 'setAdapterRegistry',
        args: [expectedRegistry],
      })
    : undefined;
  const abdicateData = encodeFunctionData({
    abi: vaultV2RegistryAbi,
    functionName: 'abdicate',
    args: [SET_REGISTRY_SELECTOR],
  });

  const common = { address: vaultAddress, abi: vaultV2RegistryAbi, chainId } as const;
  const { data, isLoading, error } = useReadContracts({
    contracts: [
      { ...common, functionName: 'adapterRegistry' },
      { ...common, functionName: 'abdicated', args: [SET_REGISTRY_SELECTOR] },
      { ...common, functionName: 'owner' },
      { ...common, functionName: 'curator' },
      { ...common, functionName: 'executableAt', args: [setRegistryData ?? '0x'] },
      { ...common, functionName: 'executableAt', args: [abdicateData] },
    ],
    query: {
      enabled: !!vaultAddress && !!setRegistryData,
      staleTime: 10_000,
      refetchInterval: 10_000, // catch submit→executable transitions quickly
    },
  });

  const base = {
    canManage: false,
    isOwner: false,
    isCurator: false,
    expectedRegistry,
    registryAddress: null as `0x${string}` | null,
    executableAt: 0n,
  };

  if (isLoading || !setRegistryData) return { step: 'loading', ...base };
  if (error || !data) return { step: 'error', ...base };

  const currentRegistry = data[0].result as `0x${string}` | undefined;
  const isAbdicated = data[1].result as boolean | undefined;
  const owner = data[2].result as `0x${string}` | undefined;
  const curator = data[3].result as `0x${string}` | undefined;
  const execAtSet = (data[4].result as bigint) ?? 0n;
  const execAtAbdicate = (data[5].result as bigint) ?? 0n;

  const lc = userAddress?.toLowerCase();
  const isOwner = !!lc && !!owner && owner.toLowerCase() === lc;
  const isCurator = !!lc && !!curator && curator.toLowerCase() === lc;
  const hasRegistry = !!currentRegistry && currentRegistry !== zeroAddress;
  const now = BigInt(Math.floor(Date.now() / 1000));

  let step: RegistryStep;
  let executableAt = 0n;
  if (!hasRegistry) {
    executableAt = execAtSet;
    step =
      execAtSet === 0n ? 'set_not_submitted'
      : execAtSet > now ? 'set_pending'
      : 'set_executable';
  } else if (!isAbdicated) {
    executableAt = execAtAbdicate;
    step =
      execAtAbdicate === 0n ? 'abdicate_not_submitted'
      : execAtAbdicate > now ? 'abdicate_pending'
      : 'abdicate_executable';
  } else {
    step = 'complete';
  }

  return {
    step,
    canManage: isOwner || isCurator,
    isOwner,
    isCurator,
    expectedRegistry,
    registryAddress: hasRegistry ? currentRegistry! : null,
    executableAt,
  };
}
