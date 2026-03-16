/**
 * ABI for V2 vault registry operations.
 *
 * Used by the Set Registry & Abdicate flow.
 * setAdapterRegistry + abdicate are one-time, irreversible operations
 * that lock the vault to the Morpho Adapter Registry.
 */
export const vaultV2RegistryAbi = [
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
    inputs: [{ name: 'timelockId', type: 'bytes4' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'timelock',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'pendingTimelock',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'timelockId', type: 'bytes4' }],
    outputs: [
      { name: 'value', type: 'uint192' },
      { name: 'validAt', type: 'uint64' },
    ],
  },
  {
    name: 'setAdapterRegistry',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newAdapterRegistry', type: 'address' }],
    outputs: [],
  },
  {
    name: 'submit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'data', type: 'bytes' }],
    outputs: [],
  },
  {
    name: 'abdicate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'timelockId', type: 'bytes4' }],
    outputs: [],
  },
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;
