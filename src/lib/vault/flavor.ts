/**
 * Vault flavor detection.
 *
 * A vault is either:
 * - `metaMorphoV1` — Ownable, `owner()` returns a non-zero address.
 * - `moolahVault` — OZ AccessControlEnumerable, `getRoleAdmin(0x00)` returns
 *   without revert (usually 0x00 as the bootstrap admin).
 *
 * Detection uses a cheap multicall probe and falls back to the chain's
 * `defaultVaultFlavor` if the network call fails. A `knownVaults` entry in
 * the chain config always wins — it's the curator's manual override.
 */

import { useCallback } from 'react';
import { type Address, type PublicClient } from 'viem';
import { useQuery } from '@tanstack/react-query';
import type { VaultFlavor } from '../../types';
import { getChainConfig, getDefaultVaultFlavor } from '../../config/chains';
import { getPublicClient } from '../data/rpcClient';
import { metaMorphoV1Abi } from '../contracts/abis';
import { moolahVaultAbi } from '../contracts/moolahAbis';
import { useAppStore } from '../../store/appStore';

/** Zero hash — OZ v4 uses `bytes32(0)` as DEFAULT_ADMIN_ROLE. */
const DEFAULT_ADMIN_ROLE =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

/**
 * Probe a vault address to determine its flavor.
 *
 * Strategy:
 *   1. Return the `knownVaults` override if set.
 *   2. Call `owner()` (MetaMorpho) and `getRoleAdmin(0x0)` (Moolah) in
 *      parallel via multicall. Both may succeed or fail; we pick the winner.
 *   3. Fall back to the chain default if both probes fail.
 *
 * Cheap enough to call on every mount — callers should still cache via the
 * `useVaultFlavor` hook (staleTime: Infinity; flavor never changes).
 */
export async function detectVaultFlavor(
  client: PublicClient,
  chainId: number,
  vault: Address,
): Promise<VaultFlavor> {
  const override = getChainConfig(chainId)?.knownVaults?.[vault.toLowerCase()];
  if (override) return override.flavor;

  const calls = [
    {
      address: vault,
      abi: metaMorphoV1Abi,
      functionName: 'owner' as const,
    },
    {
      address: vault,
      abi: moolahVaultAbi,
      functionName: 'getRoleAdmin' as const,
      args: [DEFAULT_ADMIN_ROLE],
    },
  ];

  try {
    // allowFailure: results are `{status, result|error}` tuples
    const [ownerRes, roleAdminRes] = (await client.multicall({
      contracts: calls as never,
      allowFailure: true,
    })) as [
      { status: 'success'; result: Address } | { status: 'failure' },
      { status: 'success'; result: `0x${string}` } | { status: 'failure' },
    ];

    const ownerOk =
      ownerRes.status === 'success' &&
      ownerRes.result !== '0x0000000000000000000000000000000000000000';
    const roleAdminOk = roleAdminRes.status === 'success';

    // Both can succeed (some forks expose both). Moolah wins because the
    // MetaMorpho vault doesn't implement AccessControl, so a successful
    // getRoleAdmin is a strong positive signal.
    if (roleAdminOk) return 'moolahVault';
    if (ownerOk) return 'metaMorphoV1';
  } catch {
    // Network error — fall through to default.
  }

  return getDefaultVaultFlavor(chainId, vault);
}

/** React Query hook: resolves flavor once and caches for the session. */
export function useVaultFlavor(
  chainId: number | undefined,
  vault: Address | undefined,
) {
  // A previously-tracked vault carries a flavor tag set at deploy / track
  // time. If present, we use it to seed `placeholderData` so consumers
  // render the correct layout immediately without waiting for the probe.
  //
  // The selector is memoized to avoid Zustand re-subscribing on every
  // render (inline selectors have a new identity each time, which can
  // trigger sync re-render cycles in React 19 + Zustand v5).
  const selectorKey = chainId && vault ? `${chainId}:${vault.toLowerCase()}` : '';
  const trackedFlavorSelector = useCallback(
    (s: { trackedVaults: Array<{ chainId: number; address: string; flavor?: VaultFlavor }> }) => {
      if (!selectorKey) return undefined;
      const [cid, lower] = selectorKey.split(':');
      return s.trackedVaults.find(
        (v) => v.chainId === Number(cid) && v.address.toLowerCase() === lower,
      )?.flavor;
    },
    [selectorKey],
  );
  const trackedFlavor = useAppStore(trackedFlavorSelector);

  return useQuery({
    queryKey: ['vault-flavor', chainId, vault?.toLowerCase()],
    queryFn: async (): Promise<VaultFlavor> => {
      if (!chainId || !vault) throw new Error('vault-flavor: missing inputs');
      const client = getPublicClient(chainId);
      return detectVaultFlavor(client, chainId, vault);
    },
    enabled: Boolean(chainId && vault),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    // Seed with the tracked-vault flavor if available, otherwise fall
    // back to the chain/known-vault default.
    placeholderData: () => {
      if (!chainId || !vault) return undefined;
      return trackedFlavor ?? getDefaultVaultFlavor(chainId, vault);
    },
  });
}
