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
  { inputs: [{ name: 'addr', type: 'address' }], name: 'isSentinel', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },

  // === Config ===
  { inputs: [], name: 'timelock', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'fee', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'feeRecipient', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'lastTotalAssets', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },

  // === Adapter reads ===
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'adapter',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  { inputs: [], name: 'adaptersLength', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'index', type: 'uint256' }], name: 'adapters', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'adapter', type: 'address' }], name: 'isAdapterEnabled', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'liquidityAdapter', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },

  // === Cap reads ===
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'absoluteCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'relativeCap', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'id', type: 'bytes32' }], name: 'allocation', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'actionHash', type: 'bytes32' }], name: 'pendingAction', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },

  // === Caps (by market ID) — timelocked submit ===
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

  // === Adapter management — Curator (timelocked) ===
  {
    inputs: [{ name: 'adapter', type: 'address' }],
    name: 'addAdapter',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'adapter', type: 'address' }],
    name: 'removeAdapter',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'idData', type: 'bytes' },
      { name: 'cap', type: 'uint256' },
    ],
    name: 'increaseAbsoluteCap',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'idData', type: 'bytes' },
      { name: 'cap', type: 'uint256' },
    ],
    name: 'decreaseAbsoluteCap',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'idData', type: 'bytes' },
      { name: 'cap', type: 'uint256' },
    ],
    name: 'setRelativeCap',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'adapter', type: 'address' },
      { name: 'penalty', type: 'uint256' },
    ],
    name: 'setForceDeallocatePenalty',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // === Allocator actions (immediate) ===
  {
    inputs: [
      { name: 'adapter', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    name: 'allocate',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'adapter', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    name: 'deallocate',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'adapter', type: 'address' }],
    name: 'setLiquidityAdapter',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // === Sentinel actions ===
  {
    inputs: [{ name: 'actionHash', type: 'bytes32' }],
    name: 'revoke',
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

/**
 * ABI for V1 vault adapter contracts (MorphoVaultV1Adapter).
 */
export const v1VaultAdapterAbi = [
  { inputs: [], name: 'VAULT', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'realAssets', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'name', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'asset', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
    ],
    name: 'skim',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

/**
 * ABI for V1 market adapter contracts (MorphoMarketV1AdapterV2).
 */
export const v1MarketAdapterAbi = [
  { inputs: [], name: 'MORPHO', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'realAssets', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'name', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'asset', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
] as const;
