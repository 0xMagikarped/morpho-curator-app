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

export const KNOWN_ABIS: KnownAbiEntry[] = [
  {
    label: 'MoolahVault',
    abi: moolahVaultAbi as Abi,
    match: (target, chainId) => {
      const config = getChainConfig(chainId);
      if (!config) return false;
      const known = config.knownVaults ?? {};
      if (known[target.toLowerCase()]?.flavor === 'moolahVault') return true;
      // Default on Moolah chains — vault addresses the app tracks but hasn't
      // seen before are probably MoolahVaults too.
      return config.protocol === 'moolah';
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
    // Superset of MoolahVault for the setters the write router schedules.
    // Useful when the target is a MoolahVault and moolahVaultAbi didn't
    // expose the setter (e.g. submitCap).
    abi: metaMorphoV1Abi as Abi,
    match: (_target, chainId) => getChainConfig(chainId) !== undefined,
  },
  {
    // Last resort — covers TimeLock self-calls (e.g. `updateDelay`).
    label: 'TimelockController',
    abi: timelockControllerAbi as Abi,
    match: () => true,
  },
];
