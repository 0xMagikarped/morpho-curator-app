/**
 * Unified vault adapter — flavor-aware reads normalised to one shape.
 *
 * UI components consume `VaultSnapshot` and never branch on flavor themselves.
 * This keeps the Role Assignments card, write router, and Pending Proposals
 * panel drivable from a single data model while MetaMorpho and Moolah keep
 * their very different contracts underneath.
 *
 * Used as a *supplement* to the existing `fetchVaultBasicInfo` in rpcClient —
 * not a replacement, because a lot of legacy code still reads the V1/V2 shape.
 * The snapshot adds the Moolah-only surfaces (two timelocks, role-member
 * enumeration, protocol pause) that don't fit the legacy `VaultInfo` type.
 */

import { keccak256, toHex, type Address, type PublicClient } from 'viem';
import { useQuery } from '@tanstack/react-query';
import type { VaultFlavor } from '../../types';
import { getPublicClient } from '../data/rpcClient';
import { metaMorphoV1Abi } from '../contracts/abis';
import { moolahSingletonAbi, moolahVaultAbi, timelockControllerAbi } from '../contracts/moolahAbis';
import { useVaultFlavor } from './flavor';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const ZERO_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

// OZ keccak256("MANAGER") / keccak256("CURATOR") / keccak256("ALLOCATOR")
// Pre-computed to avoid runtime calls when we can.
const MANAGER_ROLE = keccak256(toHex('MANAGER'));
const CURATOR_ROLE = keccak256(toHex('CURATOR'));
const ALLOCATOR_ROLE = keccak256(toHex('ALLOCATOR'));

export interface TimelockEntry {
  /** Human label for the timelock. */
  label: 'MetaMorpho' | 'Manager' | 'Curator';
  /** Timelock contract address; null for MetaMorpho (delay lives on the vault). */
  address: Address | null;
  /** Current min delay in seconds. */
  minDelay: bigint;
  /** Pending delay change (MetaMorpho only). */
  pending?: { newDelay: bigint; validAt: bigint };
  /** Role holders on this timelock (Moolah only). */
  proposers?: Address[];
  executors?: Address[];
  cancellers?: Address[];
}

export interface MoolahExtras {
  /** Current UUPS implementation address (read from EIP-1967 slot). */
  implementation: Address | null;
  /** Moolah singleton `paused()` state — drives the global banner. */
  isPaused: boolean;
  /** Enumerated role members on the vault itself. */
  roleHolders: {
    admin: Address[];
    manager: Address[];
    curator: Address[];
    allocator: Address[];
  };
}

export interface VaultSnapshot {
  flavor: VaultFlavor;
  address: Address;
  chainId: number;

  asset: Address;
  name: string;
  symbol: string;
  decimals: number;

  /** Protocol admin — vault owner on MetaMorpho, vaultAdmin (DAO Safe) on Moolah. */
  admin: Address;
  /**
   * Curator addresses.
   * - MetaMorpho: `[curator()]` (or empty if zero).
   * - Moolah: role members of CURATOR role — typically `[curatorTimeLock]`.
   */
  curators: Address[];
  /** Manager addresses — empty on MetaMorpho, role members on Moolah (typically `[managerTimeLock]`). */
  managers: Address[];
  /** Known allocator addresses discovered via the role/mapping. */
  allocators: Address[];
  /** Guardian / canceller addresses. On MetaMorpho: `[guardian()]`. On Moolah: CANCELLER_ROLE holders across both timelocks. */
  guardians: Address[];
  feeRecipient: Address;

  /** One entry on MetaMorpho, two on Moolah. */
  timelocks: TimelockEntry[];

  totalAssets: bigint;
  totalSupply: bigint;
  fee: bigint;

  /** Moolah-only augmentations. Undefined for MetaMorpho vaults. */
  moolahExtras?: MoolahExtras;
}

/** EIP-1967 implementation storage slot (`bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)`). */
const EIP1967_IMPL_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const;

async function readImplementation(
  client: PublicClient,
  vault: Address,
): Promise<Address | null> {
  try {
    const raw = await client.getStorageAt({ address: vault, slot: EIP1967_IMPL_SLOT });
    if (!raw || raw === ZERO_HASH) return null;
    return (`0x${raw.slice(-40)}`) as Address;
  } catch {
    return null;
  }
}

async function enumerateRole(
  client: PublicClient,
  target: Address,
  abi: typeof moolahVaultAbi | typeof timelockControllerAbi,
  role: `0x${string}`,
): Promise<Address[]> {
  try {
    const count = (await client.readContract({
      address: target,
      abi,
      functionName: 'getRoleMemberCount',
      args: [role],
    } as never)) as bigint;
    if (count === 0n) return [];
    const members = await Promise.all(
      Array.from({ length: Number(count) }, (_, i) =>
        client.readContract({
          address: target,
          abi,
          functionName: 'getRoleMember',
          args: [role, BigInt(i)],
        } as never) as Promise<Address>,
      ),
    );
    return members;
  } catch {
    return [];
  }
}

async function readSnapshotMoolah(
  client: PublicClient,
  chainId: number,
  vault: Address,
  moolahSingleton: Address | undefined,
): Promise<VaultSnapshot> {
  // Batch: identity + ERC4626 + feeRecipient/fee + roles count.
  const [
    asset,
    name,
    symbol,
    decimals,
    totalAssets,
    totalSupply,
    feeRecipient,
    fee,
    adminMembers,
    managerMembers,
    curatorMembers,
    allocatorMembers,
    implementation,
    isPaused,
  ] = await Promise.all([
    client.readContract({ address: vault, abi: moolahVaultAbi, functionName: 'asset' }) as Promise<Address>,
    client.readContract({ address: vault, abi: moolahVaultAbi, functionName: 'name' }) as Promise<string>,
    client.readContract({ address: vault, abi: moolahVaultAbi, functionName: 'symbol' }) as Promise<string>,
    client.readContract({ address: vault, abi: moolahVaultAbi, functionName: 'decimals' }) as Promise<number>,
    client.readContract({ address: vault, abi: moolahVaultAbi, functionName: 'totalAssets' }) as Promise<bigint>,
    client.readContract({ address: vault, abi: moolahVaultAbi, functionName: 'totalSupply' }) as Promise<bigint>,
    client.readContract({ address: vault, abi: moolahVaultAbi, functionName: 'feeRecipient' }).catch(() => ZERO_ADDRESS) as Promise<Address>,
    client.readContract({ address: vault, abi: moolahVaultAbi, functionName: 'fee' }).catch(() => 0n) as Promise<bigint>,
    enumerateRole(client, vault, moolahVaultAbi, ZERO_HASH),
    enumerateRole(client, vault, moolahVaultAbi, MANAGER_ROLE),
    enumerateRole(client, vault, moolahVaultAbi, CURATOR_ROLE),
    enumerateRole(client, vault, moolahVaultAbi, ALLOCATOR_ROLE),
    readImplementation(client, vault),
    moolahSingleton
      ? (client
          .readContract({ address: moolahSingleton, abi: moolahSingletonAbi, functionName: 'paused' })
          .catch(() => false) as Promise<boolean>)
      : Promise.resolve(false),
  ]);

  // For Moolah, curator role is typically held by the curatorTimeLock *contract*.
  // We use that contract as the timelock address and probe its delay + role members.
  const curatorTl = curatorMembers[0];
  const managerTl = managerMembers[0];

  const [curatorDelay, managerDelay, curatorProposers, curatorExecutors, curatorCancellers, managerProposers, managerExecutors, managerCancellers] = await Promise.all([
    curatorTl
      ? (client.readContract({ address: curatorTl, abi: timelockControllerAbi, functionName: 'getMinDelay' }).catch(() => 0n) as Promise<bigint>)
      : Promise.resolve(0n),
    managerTl
      ? (client.readContract({ address: managerTl, abi: timelockControllerAbi, functionName: 'getMinDelay' }).catch(() => 0n) as Promise<bigint>)
      : Promise.resolve(0n),
    curatorTl ? enumerateRole(client, curatorTl, timelockControllerAbi, keccak256(toHex('PROPOSER_ROLE'))) : Promise.resolve([]),
    curatorTl ? enumerateRole(client, curatorTl, timelockControllerAbi, keccak256(toHex('EXECUTOR_ROLE'))) : Promise.resolve([]),
    curatorTl ? enumerateRole(client, curatorTl, timelockControllerAbi, keccak256(toHex('CANCELLER_ROLE'))) : Promise.resolve([]),
    managerTl ? enumerateRole(client, managerTl, timelockControllerAbi, keccak256(toHex('PROPOSER_ROLE'))) : Promise.resolve([]),
    managerTl ? enumerateRole(client, managerTl, timelockControllerAbi, keccak256(toHex('EXECUTOR_ROLE'))) : Promise.resolve([]),
    managerTl ? enumerateRole(client, managerTl, timelockControllerAbi, keccak256(toHex('CANCELLER_ROLE'))) : Promise.resolve([]),
  ]);

  // Allocators on Moolah = members of the vault's ALLOCATOR role +
  // PROPOSER role members on the managerTimeLock (which are the ones who
  // can actually schedule reallocation operations).
  const uniqueAllocators = Array.from(
    new Set([...allocatorMembers, ...managerProposers].map((a) => a.toLowerCase())),
  ) as Address[];

  const guardians = Array.from(
    new Set([...curatorCancellers, ...managerCancellers].map((a) => a.toLowerCase())),
  ) as Address[];

  return {
    flavor: 'moolahVault',
    address: vault,
    chainId,
    asset,
    name,
    symbol,
    decimals,
    admin: adminMembers[0] ?? ZERO_ADDRESS,
    curators: curatorMembers,
    managers: managerMembers,
    allocators: uniqueAllocators,
    guardians,
    feeRecipient,
    timelocks: [
      {
        label: 'Manager',
        address: managerTl ?? null,
        minDelay: managerDelay,
        proposers: managerProposers,
        executors: managerExecutors,
        cancellers: managerCancellers,
      },
      {
        label: 'Curator',
        address: curatorTl ?? null,
        minDelay: curatorDelay,
        proposers: curatorProposers,
        executors: curatorExecutors,
        cancellers: curatorCancellers,
      },
    ],
    totalAssets,
    totalSupply,
    fee,
    moolahExtras: {
      implementation,
      isPaused,
      roleHolders: {
        admin: adminMembers,
        manager: managerMembers,
        curator: curatorMembers,
        allocator: allocatorMembers,
      },
    },
  };
}

async function readSnapshotMetaMorphoV1(
  client: PublicClient,
  chainId: number,
  vault: Address,
): Promise<VaultSnapshot> {
  const [asset, name, symbol, decimals, totalAssets, totalSupply, feeRecipient, fee, owner, curator, guardian, timelock] =
    await Promise.all([
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'asset' }) as Promise<Address>,
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'name' }) as Promise<string>,
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'symbol' }) as Promise<string>,
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'decimals' }).catch(() => 18) as Promise<number>,
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'totalAssets' }) as Promise<bigint>,
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'totalSupply' }) as Promise<bigint>,
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'feeRecipient' }).catch(() => ZERO_ADDRESS) as Promise<Address>,
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'fee' }).catch(() => 0n) as Promise<bigint>,
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'owner' }) as Promise<Address>,
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'curator' }).catch(() => ZERO_ADDRESS) as Promise<Address>,
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'guardian' }).catch(() => ZERO_ADDRESS) as Promise<Address>,
      client.readContract({ address: vault, abi: metaMorphoV1Abi, functionName: 'timelock' }).catch(() => 0n) as Promise<bigint>,
    ]);

  return {
    flavor: 'metaMorphoV1',
    address: vault,
    chainId,
    asset,
    name,
    symbol,
    decimals,
    admin: owner,
    curators: curator === ZERO_ADDRESS ? [] : [curator],
    managers: [],
    allocators: [],
    guardians: guardian === ZERO_ADDRESS ? [] : [guardian],
    feeRecipient,
    timelocks: [
      { label: 'MetaMorpho', address: null, minDelay: timelock },
    ],
    totalAssets,
    totalSupply,
    fee,
  };
}

export async function readVaultSnapshot(
  client: PublicClient,
  chainId: number,
  vault: Address,
  flavor: VaultFlavor,
  moolahSingleton?: Address,
): Promise<VaultSnapshot> {
  if (flavor === 'moolahVault') {
    return readSnapshotMoolah(client, chainId, vault, moolahSingleton);
  }
  return readSnapshotMetaMorphoV1(client, chainId, vault);
}

/** React Query hook. Cache is shared per (chain, vault) and refetches every minute. */
export function useVaultSnapshot(
  chainId: number | undefined,
  vault: Address | undefined,
) {
  const { data: flavor } = useVaultFlavor(chainId, vault);

  return useQuery({
    queryKey: ['vault-snapshot', chainId, vault?.toLowerCase(), flavor],
    queryFn: async (): Promise<VaultSnapshot> => {
      if (!chainId || !vault || !flavor) throw new Error('vault-snapshot: missing inputs');
      const client = getPublicClient(chainId);
      const { getChainConfig } = await import('../../config/chains');
      const moolahSingleton = getChainConfig(chainId)?.morphoBlue;
      return readVaultSnapshot(client, chainId, vault, flavor, moolahSingleton);
    },
    enabled: Boolean(chainId && vault && flavor),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
