import { useReadContracts } from 'wagmi';
import { morphoBlueExtendedAbi } from '../lib/contracts/abis';
import { getChainConfig } from '../config/chains';
import { LLTV_PRESETS } from '../config/lltv';

export interface LltvPreset {
  label: string;
  value: bigint;
  desc: string;
  enabled: boolean | undefined;
}

/**
 * Query `isLltvEnabled(lltv)` for each standard preset via multicall.
 * Returns enriched presets with an `enabled` flag per entry.
 */
export function useLltvDiscovery(chainId: number | undefined): {
  presets: LltvPreset[];
  isLoading: boolean;
} {
  const chainConfig = chainId ? getChainConfig(chainId) : undefined;
  const morphoBlue = chainConfig?.morphoBlue;

  const { data, isLoading } = useReadContracts({
    contracts: LLTV_PRESETS.map((p) => ({
      address: morphoBlue as `0x${string}`,
      abi: morphoBlueExtendedAbi,
      functionName: 'isLltvEnabled' as const,
      args: [p.value],
      chainId,
    })),
    query: {
      enabled: !!morphoBlue && !!chainId,
      staleTime: 60_000,
    },
  });

  const presets: LltvPreset[] = LLTV_PRESETS.map((p, i) => ({
    label: p.label,
    value: p.value,
    desc: p.desc,
    enabled: data?.[i]?.result as boolean | undefined,
  }));

  return { presets, isLoading };
}
