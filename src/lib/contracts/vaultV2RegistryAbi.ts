/**
 * ABI for Morpho Vault V2 registry / timelock operations.
 *
 * Used by the Set Registry & Abdicate flow. Morpho Vault V2 governs config
 * changes through a per-selector timelock queue:
 *   1. `submit(calldata)` records `executableAt[calldata] = now + timelock(selector)`.
 *   2. After `executableAt`, the target function (e.g. `setAdapterRegistry`) is
 *      called directly — it self-checks `executableAt` and reverts
 *      `DataNotTimelocked()` if the calldata was never submitted / not elapsed.
 *
 * Function shapes are taken verbatim from `@morpho-org/blue-sdk-viem`'s
 * `vaultV2Abi` (PR 7). The error fragments are spread in so viem decodes
 * `DataNotTimelocked` & co. to names instead of raw selectors.
 */
import { MORPHO_METAMORPHO_V2_ERRORS } from './morphoErrors';

export const vaultV2RegistryAbi = [
  // --- views ---
  {
    name: 'adapterRegistry',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'abdicated',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'selector', type: 'bytes4' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    // Per-selector timelock DURATION (seconds). Note: takes a bytes4 selector —
    // there is no zero-arg `timelock()` on Vault V2.
    name: 'timelock',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'selector', type: 'bytes4' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    // Unix timestamp at which submitted `data` becomes executable. 0 = not
    // submitted (or already executed/revoked).
    name: 'executableAt',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'data', type: 'bytes' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'curator',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  // --- writes ---
  {
    // Queue calldata into the timelock. Curator-gated on Vault V2.
    name: 'submit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'data', type: 'bytes' }],
    outputs: [],
  },
  {
    // Cancel a still-pending submitted operation.
    name: 'revoke',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'data', type: 'bytes' }],
    outputs: [],
  },
  {
    // The timelocked target — called directly after `executableAt`.
    name: 'setAdapterRegistry',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newAdapterRegistry', type: 'address' }],
    outputs: [],
  },
  {
    name: 'abdicate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'selector', type: 'bytes4' }],
    outputs: [],
  },
  // Custom errors — verbatim from @morpho-org/blue-sdk-viem `vaultV2Abi`.
  ...MORPHO_METAMORPHO_V2_ERRORS,
] as const;
