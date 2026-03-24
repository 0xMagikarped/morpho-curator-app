import { useQuery } from '@tanstack/react-query';
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi';
import type { Address } from 'viem';
import { getPublicClient } from '../data/rpcClient';
import { publicAllocatorAbi } from '../contracts/abis';
import { checkIsAllocator } from '../data/rpcClient';
import { getChainConfig } from '../../config/chains';
import { vaultKeys } from '../queryKeys';

// ============================================================
// Types
// ============================================================

export interface FlowCap {
  maxIn: bigint;
  maxOut: bigint;
}

export interface MarketFlowCap {
  marketId: `0x${string}`;
  label: string;
  maxIn: bigint;
  maxOut: bigint;
  currentSupply: bigint;
}

export interface PublicAllocatorConfig {
  isEnabled: boolean;
  paAddress: Address | null;
  admin: Address;
  fee: bigint;
  accruedFee: bigint;
  flowCaps: MarketFlowCap[];
}

export interface FlowCapConfig {
  marketId: `0x${string}`;
  caps: FlowCap;
}

const ZERO = '0x0000000000000000000000000000000000000000' as Address;

// Max settable flow cap = type(uint128).max / 2
export const MAX_SETTABLE_FLOW_CAP = (2n ** 128n - 1n) / 2n;

// ============================================================
// Read hook
// ============================================================

export function usePublicAllocatorConfig(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  markets: Array<{
    marketId: `0x${string}`;
    label: string;
    currentSupply: bigint;
  }> | undefined,
) {
  const chainConfig = chainId ? getChainConfig(chainId) : undefined;
  const paAddress = chainConfig?.periphery?.publicAllocator as Address | undefined;

  return useQuery<PublicAllocatorConfig | null>({
    queryKey: [...vaultKeys.publicAllocator(chainId!, vaultAddress!), markets?.length],
    enabled: !!chainId && !!vaultAddress && !!markets && markets.length > 0,
    queryFn: async () => {
      if (!chainId || !vaultAddress || !markets?.length) return null;

      if (!paAddress) {
        return { isEnabled: false, paAddress: null, admin: ZERO, fee: 0n, accruedFee: 0n, flowCaps: [] };
      }

      const client = getPublicClient(chainId);

      // Check if PA is enabled as an allocator on this vault
      let isEnabled = false;
      try {
        isEnabled = await checkIsAllocator(chainId, vaultAddress, paAddress);
      } catch {
        return null;
      }

      // Read PA config
      const [admin, fee, accruedFee] = await Promise.all([
        client.readContract({
          address: paAddress,
          abi: publicAllocatorAbi,
          functionName: 'admin',
          args: [vaultAddress],
        }) as Promise<Address>,
        client.readContract({
          address: paAddress,
          abi: publicAllocatorAbi,
          functionName: 'fee',
          args: [vaultAddress],
        }) as Promise<bigint>,
        client.readContract({
          address: paAddress,
          abi: publicAllocatorAbi,
          functionName: 'accruedFee',
          args: [vaultAddress],
        }) as Promise<bigint>,
      ]);

      // Read flow caps per market
      const flowCaps: MarketFlowCap[] = await Promise.all(
        markets.map(async (m) => {
          try {
            const result = await client.readContract({
              address: paAddress,
              abi: publicAllocatorAbi,
              functionName: 'flowCaps',
              args: [vaultAddress, m.marketId],
            });
            const [maxIn, maxOut] = result as [bigint, bigint];
            return { marketId: m.marketId, label: m.label, maxIn, maxOut, currentSupply: m.currentSupply };
          } catch {
            return { marketId: m.marketId, label: m.label, maxIn: 0n, maxOut: 0n, currentSupply: m.currentSupply };
          }
        }),
      );

      return { isEnabled, paAddress, admin, fee, accruedFee, flowCaps };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ============================================================
// Write hooks
// ============================================================

export function usePublicAllocatorActions(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
) {
  const chainConfig = chainId ? getChainConfig(chainId) : undefined;
  const paAddress = chainConfig?.periphery?.publicAllocator as Address | undefined;
  const { address: userAddress } = useAccount();

  const { writeContract, data: txHash, isPending, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const enablePA = () => {
    if (!paAddress || !vaultAddress) return;
    writeContract({
      address: vaultAddress,
      abi: [{ inputs: [{ name: 'allocator', type: 'address' }, { name: 'isAllocator', type: 'bool' }], name: 'setIsAllocator', outputs: [], stateMutability: 'nonpayable', type: 'function' }],
      functionName: 'setIsAllocator',
      args: [paAddress, true],
    });
  };

  const disablePA = () => {
    if (!paAddress || !vaultAddress) return;
    writeContract({
      address: vaultAddress,
      abi: [{ inputs: [{ name: 'allocator', type: 'address' }, { name: 'isAllocator', type: 'bool' }], name: 'setIsAllocator', outputs: [], stateMutability: 'nonpayable', type: 'function' }],
      functionName: 'setIsAllocator',
      args: [paAddress, false],
    });
  };

  const setAdmin = (newAdmin: Address) => {
    if (!paAddress || !vaultAddress) return;
    writeContract({
      address: paAddress,
      abi: publicAllocatorAbi,
      functionName: 'setAdmin',
      args: [vaultAddress, newAdmin],
    });
  };

  const setFee = (newFee: bigint) => {
    if (!paAddress || !vaultAddress) return;
    writeContract({
      address: paAddress,
      abi: publicAllocatorAbi,
      functionName: 'setFee',
      args: [vaultAddress, newFee],
    });
  };

  const setFlowCaps = (configs: FlowCapConfig[]) => {
    if (!paAddress || !vaultAddress) return;
    const configTuples = configs.map((c) => ({
      id: c.marketId as `0x${string}`,
      caps: { maxIn: c.caps.maxIn, maxOut: c.caps.maxOut },
    }));
    writeContract({
      address: paAddress,
      abi: publicAllocatorAbi,
      functionName: 'setFlowCaps',
      args: [vaultAddress, configTuples],
    });
  };

  const transferFee = (recipient?: Address) => {
    if (!paAddress || !vaultAddress) return;
    const to = recipient ?? userAddress;
    if (!to) return;
    writeContract({
      address: paAddress,
      abi: publicAllocatorAbi,
      functionName: 'transferFee',
      args: [vaultAddress, to],
    });
  };

  return {
    paAddress,
    isPending,
    isConfirming,
    isSuccess,
    enablePA,
    disablePA,
    setAdmin,
    setFee,
    setFlowCaps,
    transferFee,
    reset,
  };
}
