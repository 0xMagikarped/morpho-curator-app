/**
 * Flavor-aware vault permissions.
 *
 * On MetaMorpho V1, write authority = `owner()` or `curator()`.
 * On MetaMorpho V2, write authority = `owner()` (owner-only setters) or
 *   `curator()` (timelocked setters). V2 is NOT a distinct `VaultFlavor`
 *   (the flavor probe sees it as `metaMorphoV1`), and the role-snapshot
 *   reader has no V2 branch + can fail intermittently on flaky RPCs — which
 *   made write gates flicker per chain. So for V2 we derive permissions from
 *   the reliable `useVaultInfo` data (owner/curator) instead of the snapshot.
 * On Moolah, write authority = PROPOSER_ROLE on the relevant TimeLock.
 *
 * This hook consumes the VaultSnapshot (which already enumerates timelock
 * role members) and the connected wallet address to produce a simple
 * boolean map that every write-gated component can branch on without
 * knowing anything about timelocks.
 */

import { useMemo } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import type { Address } from 'viem';
import type { VaultFlavor, VaultInfoV2 } from '../types';
import type { VaultSnapshot } from '../lib/vault/adapter';
import { useVaultSnapshot } from '../lib/vault/adapter';
import { useVaultInfo } from '../lib/hooks/useVault';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface VaultPermissions {
  canCurate: boolean;
  canManage: boolean;
  canPropose: boolean;
  canCancel: boolean;
  isAdmin: boolean;
  isAllocator: boolean;
  isLoading: boolean;
  flavor: VaultFlavor | undefined;
}

const EMPTY: VaultPermissions = {
  canCurate: false,
  canManage: false,
  canPropose: false,
  canCancel: false,
  isAdmin: false,
  isAllocator: false,
  isLoading: true,
  flavor: undefined,
};

function eq(a: string | undefined | null, b: string): boolean {
  return Boolean(a && a.toLowerCase() === b.toLowerCase());
}

function includes(arr: Address[] | undefined, addr: string): boolean {
  if (!arr) return false;
  const lower = addr.toLowerCase();
  return arr.some((a) => a.toLowerCase() === lower);
}

function computePermissions(
  snapshot: VaultSnapshot,
  address: Address,
): VaultPermissions {
  const lower = address.toLowerCase();

  if (snapshot.flavor === 'moolahVault') {
    const curatorTL = snapshot.timelocks.find((tl) => tl.label === 'Curator');
    const managerTL = snapshot.timelocks.find((tl) => tl.label === 'Manager');

    const isProposerOnCurator =
      curatorTL?.proposers?.some((p) => p.toLowerCase() === lower) ?? false;
    const isProposerOnManager =
      managerTL?.proposers?.some((p) => p.toLowerCase() === lower) ?? false;
    const isCanceller = [curatorTL, managerTL].some(
      (tl) => tl?.cancellers?.some((c) => c.toLowerCase() === lower),
    );

    return {
      canCurate: isProposerOnCurator,
      canManage: isProposerOnManager,
      canPropose: isProposerOnCurator || isProposerOnManager,
      canCancel: Boolean(isCanceller),
      isAdmin: eq(snapshot.admin, address),
      isAllocator: isProposerOnManager,
      isLoading: false,
      flavor: 'moolahVault',
    };
  }

  // MetaMorpho V1
  const isAdmin = eq(snapshot.admin, address);
  const isCurator = includes(snapshot.curators, address);
  const isGuardian = includes(snapshot.guardians, address);
  const isAllocator = includes(snapshot.allocators, address) || isAdmin;

  return {
    canCurate: isAdmin || isCurator,
    canManage: isAdmin,
    canPropose: isAdmin || isCurator,
    canCancel: isGuardian,
    isAdmin,
    isAllocator,
    isLoading: false,
    flavor: 'metaMorphoV1',
  };
}

/**
 * V2 permissions, derived from the reliable `useVaultInfo` data (owner +
 * curator) rather than the role-snapshot. `isAllocator` can't be read from
 * an enumerable list on V2 (per-address mapping), so it's checked on-chain
 * separately and passed in.
 */
function derivePermissionsV2(
  vault: VaultInfoV2,
  address: Address,
  isAllocatorOnChain: boolean,
): VaultPermissions {
  const isOwner = eq(vault.owner, address);
  const curatorSet = !!vault.curator && vault.curator !== ZERO_ADDRESS;
  const isCurator = curatorSet && eq(vault.curator, address);

  return {
    // Owner can bootstrap (owner-only setters) and is the ultimate admin;
    // curator drives the timelocked setters.
    canCurate: isOwner || isCurator,
    canManage: isOwner,
    canPropose: isOwner || isCurator,
    // Sentinels can also cancel, but there's no cheap enumeration; the owner
    // always can, which covers the gate's purpose.
    canCancel: isOwner,
    isAdmin: isOwner,
    isAllocator: isAllocatorOnChain || isOwner,
    isLoading: false,
    // No `metaMorphoV2` enum value — report `metaMorphoV1` (i.e. "not moolah")
    // so existing flavor branches behave as before.
    flavor: 'metaMorphoV1',
  };
}

/**
 * Main hook — call from any component that needs to know whether the
 * connected wallet can write. Consumes `useVaultSnapshot` internally so
 * callers don't have to thread the snapshot through.
 */
export function useVaultPermissions(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
): VaultPermissions {
  const { address } = useAccount();
  const { data: snapshot, isLoading } = useVaultSnapshot(chainId, vaultAddress);
  const { data: vault } = useVaultInfo(chainId, vaultAddress);
  const isV2 = vault?.version === 'v2';

  // V2 has no enumerable allocator list — check the connected wallet directly.
  // Always called (Rules of Hooks); enabled only for a connected V2 vault.
  const { data: isAllocatorV2 } = useReadContract({
    address: vaultAddress,
    abi: metaMorphoV2Abi,
    functionName: 'isAllocator',
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: Boolean(isV2 && address && vaultAddress) },
  });

  return useMemo(() => {
    if (!address) return EMPTY;
    if (isV2 && vault) {
      return derivePermissionsV2(vault as VaultInfoV2, address, Boolean(isAllocatorV2));
    }
    if (!snapshot || isLoading) return EMPTY;
    return computePermissions(snapshot, address);
  }, [snapshot, address, isLoading, isV2, vault, isAllocatorV2]);
}

/**
 * Pure computation variant — for components that already have the
 * snapshot and address (avoids a duplicate `useVaultSnapshot` call).
 */
export function derivePermissions(
  snapshot: VaultSnapshot | undefined,
  address: Address | undefined,
): VaultPermissions {
  if (!snapshot || !address) return EMPTY;
  return computePermissions(snapshot, address);
}
