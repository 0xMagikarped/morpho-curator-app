/**
 * MetaMorpho V2 Vault ABI (partial — curator-relevant functions only).
 *
 * Key V2 differences from V1:
 * - Adapter-based allocation (no supply/withdraw queues)
 * - sentinel() role for emergency actions
 * - submit(bytes)/execute(bytes) pattern for timelocked actions
 * - Caps addressed by bytes32 market ID (not MarketParams)
 * - forceDeallocate for emergency withdrawal
 *
 * NOTE: This ABI is based on Morpho V2 docs as of March 2026.
 * Verify against deployed bytecode if any calls fail.
 */

export const metaMorphoV2Abi = [
  // === ERC-4626 + Standard reads (shared with V1) ===
  { inputs: [], name: 'name', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'asset', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalAssets', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'shares', type: 'uint256' }], name: 'convertToAssets', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MORPHO', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },

  // === Roles ===
  { inputs: [], name: 'owner', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'curator', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'guardian', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'sentinel', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'allocator', type: 'address' }], name: 'isAllocator', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },

  // === Config ===
  { inputs: [], name: 'timelock', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'fee', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'feeRecipient', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'lastTotalAssets', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },

  // === Adapter Management ===
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'adapter',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },

  // === Caps (by market ID) ===
  {
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'newSupplyCap', type: 'uint256' },
    ],
    name: 'submitCap',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'acceptCap',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // === Timelocked submit/execute ===
  {
    inputs: [{ name: 'data', type: 'bytes' }],
    name: 'submit',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'data', type: 'bytes' }],
    name: 'execute',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // === Emergency ===
  {
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'assets', type: 'uint256' },
    ],
    name: 'forceDeallocate',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // === Role management ===
  {
    inputs: [{ name: 'newSentinel', type: 'address' }],
    name: 'setSentinel',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newCurator', type: 'address' }],
    name: 'setCurator',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'allocator', type: 'address' },
      { name: 'isAllocator', type: 'bool' },
    ],
    name: 'setIsAllocator',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newFee', type: 'uint256' }],
    name: 'setFee',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newFeeRecipient', type: 'address' }],
    name: 'setFeeRecipient',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;
