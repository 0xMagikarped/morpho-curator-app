import { useReadContracts } from 'wagmi';
import type { Address } from 'viem';
import { metaMorphoV1Abi } from '../../../lib/contracts/abis';

export interface VaultPendingState {
  // Current values
  fee: bigint;
  timelock: bigint;
  guardian: Address;
  owner: Address;
  curator: Address;
  feeRecipient: Address;
  // Pending values
  pendingFee: { value: bigint; validAt: bigint } | null;
  pendingTimelock: { value: bigint; validAt: bigint } | null;
  pendingGuardian: { guardian: Address; validAt: bigint } | null;
}

const ZERO = '0x0000000000000000000000000000000000000000' as Address;

export function useVaultPendingState(chainId: number, vaultAddress: Address) {
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'pendingFee', chainId },
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'pendingTimelock', chainId },
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'pendingGuardian', chainId },
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'fee', chainId },
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'timelock', chainId },
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'guardian', chainId },
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'owner', chainId },
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'curator', chainId },
      { address: vaultAddress, abi: metaMorphoV1Abi, functionName: 'feeRecipient', chainId },
    ],
    query: {
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  });

  if (!data) {
    return { data: null, isLoading, refetch };
  }

  const pendingFeeResult = data[0].result as [bigint, bigint] | undefined;
  const pendingTimelockResult = data[1].result as [bigint, bigint] | undefined;
  const pendingGuardianResult = data[2].result as [Address, bigint] | undefined;

  const parsed: VaultPendingState = {
    fee: (data[3].result as bigint) ?? 0n,
    timelock: (data[4].result as bigint) ?? 0n,
    guardian: (data[5].result as Address) ?? ZERO,
    owner: (data[6].result as Address) ?? ZERO,
    curator: (data[7].result as Address) ?? ZERO,
    feeRecipient: (data[8].result as Address) ?? ZERO,
    pendingFee: pendingFeeResult && pendingFeeResult[1] > 0n
      ? { value: pendingFeeResult[0], validAt: pendingFeeResult[1] }
      : null,
    pendingTimelock: pendingTimelockResult && pendingTimelockResult[1] > 0n
      ? { value: pendingTimelockResult[0], validAt: pendingTimelockResult[1] }
      : null,
    pendingGuardian: pendingGuardianResult && pendingGuardianResult[1] > 0n
      ? { guardian: pendingGuardianResult[0], validAt: pendingGuardianResult[1] }
      : null,
  };

  return { data: parsed, isLoading, refetch };
}
