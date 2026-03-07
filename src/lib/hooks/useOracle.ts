import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { classifyOracle } from '../oracle/oracleClassifier';
import { checkOracleHealth, checkOracleHealthBatch } from '../oracle/oracleMonitor';
import { scoreOracle } from '../oracle/oracleRiskScorer';
import type { OracleInfo, OracleHealth, OracleRiskScore } from '../oracle/oracleTypes';

// ============================================================
// useOracleInfo — Classify a single oracle
// ============================================================

export function useOracleInfo(chainId: number | undefined, oracleAddress: Address | undefined) {
  return useQuery<OracleInfo | null>({
    queryKey: ['oracle-info', chainId, oracleAddress],
    queryFn: async () => {
      if (!chainId || !oracleAddress) return null;
      return classifyOracle(chainId, oracleAddress);
    },
    enabled: !!chainId && !!oracleAddress,
    staleTime: 30 * 60_000, // Oracle type doesn't change — cache 30min
    gcTime: 60 * 60_000,
  });
}

// ============================================================
// useOracleHealth — Check a single oracle's health
// ============================================================

export function useOracleHealth(chainId: number | undefined, oracleAddress: Address | undefined) {
  return useQuery<OracleHealth | null>({
    queryKey: ['oracle-health', chainId, oracleAddress],
    queryFn: async () => {
      if (!chainId || !oracleAddress) return null;
      return checkOracleHealth(chainId, oracleAddress);
    },
    enabled: !!chainId && !!oracleAddress,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// ============================================================
// useOracleRiskScore — Full risk score for one oracle
// ============================================================

export function useOracleRiskScore(chainId: number | undefined, oracleAddress: Address | undefined) {
  const { data: info } = useOracleInfo(chainId, oracleAddress);
  const { data: health } = useOracleHealth(chainId, oracleAddress);

  return useQuery<OracleRiskScore | null>({
    queryKey: ['oracle-risk', chainId, oracleAddress, info?.type, health?.isResponding],
    queryFn: () => {
      if (!info) return null;
      return scoreOracle(info, health ?? null);
    },
    enabled: !!info,
    staleTime: 60_000,
  });
}

// ============================================================
// useOracleHealthBatch — Check health for multiple oracles
// ============================================================

export function useOracleHealthBatch(chainId: number | undefined, oracleAddresses: Address[] | undefined) {
  return useQuery<Map<Address, OracleHealth>>({
    queryKey: ['oracle-health-batch', chainId, oracleAddresses?.join(',')],
    queryFn: async () => {
      if (!chainId || !oracleAddresses || oracleAddresses.length === 0) {
        return new Map();
      }
      return checkOracleHealthBatch(chainId, oracleAddresses);
    },
    enabled: !!chainId && !!oracleAddresses && oracleAddresses.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
