/**
 * Flavor-aware vault permissions.
 *
 * On MetaMorpho V1, write authority = `owner()` or `curator()`.
 * On Moolah, write authority = PROPOSER_ROLE on the relevant TimeLock.
 *
 * This hook consumes the VaultSnapshot (which already enumerates timelock
 * role members) and the connected wallet address to produce a simple
 * boolean map that every write-gated component can branch on without
 * knowing anything about timelocks.
 */

import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import type { VaultFlavor } from '../types';
import type { VaultSnapshot } from '../lib/vault/adapter';
import { useVaultSnapshot } from '../lib/vault/adapter';

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

  return useMemo(() => {
    if (!snapshot || !address || isLoading) return EMPTY;
    return computePermissions(snapshot, address);
  }, [snapshot, address, isLoading]);
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
