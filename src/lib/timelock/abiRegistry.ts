/**
 * ABI registry for TimeLock calldata decoding.
 *
 * Each entry carries a predicate that decides whether the entry's ABI
 * should be tried for a given target. `decodeCall` walks the registry
 * in order and returns the first successful decode. The final entry
 * (TimelockController) matches everything, so it's always tried last.
 *
 * Target-matching uses cheap address comparisons against known pins in
 * the chain config + the connected known-vaults map — no RPC calls.
 */

import type { Abi, Address } from 'viem';
import { metaMorphoV1Abi } from '../contracts/abis';
import {
  moolahMarketFactoryAbi,
  moolahSingletonAbi,
  moolahVaultAbi,
  timelockControllerAbi,
} from '../contracts/moolahAbis';
import { getChainConfig } from '../../config/chains';

export interface KnownAbiEntry {
  /** Human label attached to the decoded call (for UI headers). */
  label: string;
  /** Returns true when this ABI should be tried against the given target. */
  match: (target: Address, chainId: number) => boolean;
  abi: Abi;
}

function eq(a: Address | undefined, b: Address): boolean {
  return Boolean(a && a.toLowerCase() === b.toLowerCase());
}

/**
 * Selectors that appear in BOTH `metaMorphoV1Abi` and Moolah ABIs with
 * potentially diverging arg shapes. On those selectors the decoder
 * should refuse to trust a cross-flavor decode and fall through to the
 * `UnknownCall` renderer.
 *
 * Intentionally empty today: a static audit (2026-04-15) found no
 * diverging selectors — Moolah inherits OZ/ERC4626/AccessControl
 * verbatim. Add entries here if Moolah ever diverges on a shared
 * selector.
 */
export const COLLISION_SELECTORS = new Set<`0x${string}`>([]);

/**
 * Synchronous flavor lookup from static config overrides. We can't read
 * the React Query cache from a non-hook module, but knownVaults is
 * enough to scope decoding away from cross-flavor confusion.
 */
function staticFlavorFor(
  target: Address,
  chainId: number,
): 'metaMorphoV1' | 'moolahVault' | null {
  const config = getChainConfig(chainId);
  return config?.knownVaults?.[target.toLowerCase()]?.flavor ?? null;
}

export const KNOWN_ABIS: KnownAbiEntry[] = [
  {
    label: 'MoolahVault',
    abi: moolahVaultAbi as Abi,
    match: (target, chainId) => {
      // Prefer confirmed per-vault flavor (knownVaults override). If the
      // address is explicitly a MetaMorpho vault, don't try the Moolah
      // ABI at all. Fall back to the chain's `protocol` default so
      // newly-tracked vaults on Moolah chains still decode.
      const flavor = staticFlavorFor(target, chainId);
      if (flavor === 'moolahVault') return true;
      if (flavor === 'metaMorphoV1') return false;
      return getChainConfig(chainId)?.protocol === 'moolah';
    },
  },
  {
    label: 'Moolah Singleton',
    abi: moolahSingletonAbi as Abi,
    match: (target, chainId) => eq(getChainConfig(chainId)?.morphoBlue, target),
  },
  {
    label: 'Moolah MarketFactory',
    abi: moolahMarketFactoryAbi as Abi,
    match: (target, chainId) =>
      eq(getChainConfig(chainId)?.moolah?.marketFactory, target),
  },
  {
    label: 'MetaMorpho V1',
    // Scoped to Morpho-protocol chains. A target on a Moolah chain that
    // shares a selector should NOT fall through to MM V1 — the
    // MoolahVault + TimelockController entries handle it. Cross-flavor
    // decodes are the #1 wrong-decode risk; this keeps them bounded.
    abi: metaMorphoV1Abi as Abi,
    match: (target, chainId) => {
      const config = getChainConfig(chainId);
      if (!config) return false;
      if (config.protocol !== 'morpho') return false;
      // Never fire for a target we've explicitly flagged moolahVault.
      if (staticFlavorFor(target, chainId) === 'moolahVault') return false;
      return true;
    },
  },
  {
    // Last resort — covers TimeLock self-calls (e.g. `updateDelay`).
    label: 'TimelockController',
    abi: timelockControllerAbi as Abi,
    match: () => true,
  },
];
