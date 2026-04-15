/**
 * Hooks over the Moolah singleton's protocol-level extensions.
 * These don't exist on Morpho Blue and are only queried on `chainConfig.protocol === 'moolah'`.
 */

import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { getChainConfig } from '../../config/chains';
import { getPublicClient } from '../data/rpcClient';
import { moolahSingletonAbi } from '../contracts/moolahAbis';

export interface MoolahSingletonState {
  isPaused: boolean;
  /** 8-decimal oracle-precision USD value. Borrows below this revert on Moolah. */
  minLoanValue: bigint;
  /** WAD fee applied to every market by default. */
  defaultMarketFee: bigint;
}

/** Reads the Moolah singleton's global state. Null when the chain isn't Moolah. */
export function useMoolahSingletonState(chainId: number | undefined) {
  const config = chainId ? getChainConfig(chainId) : undefined;
  const isMoolah = config?.protocol === 'moolah';
  const singleton = config?.morphoBlue;

  return useQuery({
    queryKey: ['moolah-singleton-state', chainId, singleton],
    queryFn: async (): Promise<MoolahSingletonState> => {
      if (!chainId || !singleton) throw new Error('moolah-singleton-state: missing inputs');
      const client = getPublicClient(chainId);
      const [isPaused, minLoanValue, defaultMarketFee] = await Promise.all([
        client
          .readContract({ address: singleton, abi: moolahSingletonAbi, functionName: 'paused' })
          .catch(() => false) as Promise<boolean>,
        client
          .readContract({ address: singleton, abi: moolahSingletonAbi, functionName: 'minLoanValue' })
          .catch(() => 0n) as Promise<bigint>,
        client
          .readContract({ address: singleton, abi: moolahSingletonAbi, functionName: 'defaultMarketFee' })
          .catch(() => 0n) as Promise<bigint>,
      ]);
      return { isPaused, minLoanValue, defaultMarketFee };
    },
    enabled: Boolean(isMoolah && singleton),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Is the given vault on Lista's vaultBlacklist?
 * Returns `false` on non-Moolah chains so consumers can render the
 * "not-blocked" path unconditionally.
 */
export function useIsVaultBlacklisted(
  chainId: number | undefined,
  vault: Address | undefined,
) {
  const config = chainId ? getChainConfig(chainId) : undefined;
  const singleton = config?.morphoBlue;
  const isMoolah = config?.protocol === 'moolah';

  return useQuery({
    queryKey: ['moolah-vault-blacklist', chainId, vault?.toLowerCase()],
    queryFn: async (): Promise<boolean> => {
      if (!chainId || !vault || !singleton) return false;
      const client = getPublicClient(chainId);
      try {
        return (await client.readContract({
          address: singleton,
          abi: moolahSingletonAbi,
          functionName: 'vaultBlacklist',
          args: [vault],
        })) as boolean;
      } catch {
        return false;
      }
    },
    enabled: Boolean(isMoolah && singleton && vault),
    staleTime: 5 * 60_000,
  });
}

export interface MoolahMarketSurfaces {
  marketWhitelistEnabled: boolean;
  /** Provider contract attached to the market, or null. */
  provider: Address | null;
  /** Broker contract for fixed-term markets, or null. */
  broker: Address | null;
}

/** Per-market Moolah-only reads. Cheap: three calls behind multicall. */
export function useMoolahMarketSurfaces(
  chainId: number | undefined,
  marketId: `0x${string}` | undefined,
) {
  const config = chainId ? getChainConfig(chainId) : undefined;
  const singleton = config?.morphoBlue;
  const isMoolah = config?.protocol === 'moolah';

  return useQuery({
    queryKey: ['moolah-market-surfaces', chainId, marketId],
    queryFn: async (): Promise<MoolahMarketSurfaces> => {
      if (!chainId || !marketId || !singleton) throw new Error('missing inputs');
      const client = getPublicClient(chainId);
      const ZERO = '0x0000000000000000000000000000000000000000' as Address;
      const [whitelistEnabled, providerAddr, brokerAddr] = await Promise.all([
        client
          .readContract({
            address: singleton,
            abi: moolahSingletonAbi,
            functionName: 'marketWhitelistEnabled',
            args: [marketId],
          })
          .catch(() => false) as Promise<boolean>,
        client
          .readContract({
            address: singleton,
            abi: moolahSingletonAbi,
            functionName: 'providers',
            args: [marketId, ZERO],
          })
          .catch(() => ZERO) as Promise<Address>,
        client
          .readContract({
            address: singleton,
            abi: moolahSingletonAbi,
            functionName: 'brokers',
            args: [marketId],
          })
          .catch(() => ZERO) as Promise<Address>,
      ]);
      return {
        marketWhitelistEnabled: whitelistEnabled,
        provider: providerAddr !== ZERO ? providerAddr : null,
        broker: brokerAddr !== ZERO ? brokerAddr : null,
      };
    },
    enabled: Boolean(isMoolah && marketId && singleton),
    staleTime: 60_000,
  });
}
