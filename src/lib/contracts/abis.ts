/**
 * Morpho Protocol ABI definitions.
 * Only includes functions actually used by the curator app.
 */

// ============================================================
// Morpho Blue Core
// ============================================================

export const morphoBlueAbi = [
  // Read functions
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'market',
    outputs: [
      { name: 'totalSupplyAssets', type: 'uint128' },
      { name: 'totalSupplyShares', type: 'uint128' },
      { name: 'totalBorrowAssets', type: 'uint128' },
      { name: 'totalBorrowShares', type: 'uint128' },
      { name: 'lastUpdate', type: 'uint128' },
      { name: 'fee', type: 'uint128' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'idToMarketParams',
    outputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    name: 'position',
    outputs: [
      { name: 'supplyShares', type: 'uint256' },
      { name: 'borrowShares', type: 'uint128' },
      { name: 'collateral', type: 'uint128' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'feeRecipient',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'id', type: 'bytes32' },
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
        indexed: false,
        name: 'marketParams',
        type: 'tuple',
      },
    ],
    name: 'CreateMarket',
    type: 'event',
  },
] as const;

// ============================================================
// MetaMorpho V1 Vault
// ============================================================

export const metaMorphoV1Abi = [
  // ERC-4626
  {
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'asset',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalAssets',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'shares', type: 'uint256' }],
    name: 'convertToAssets',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'assets', type: 'uint256' }],
    name: 'convertToShares',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Morpho references
  {
    inputs: [],
    name: 'MORPHO',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Roles
  {
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'curator',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'guardian',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'allocator', type: 'address' }],
    name: 'isAllocator',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Config
  {
    inputs: [],
    name: 'timelock',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'fee',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'feeRecipient',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'lastTotalAssets',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // Caps
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'config',
    outputs: [
      { name: 'cap', type: 'uint184' },
      { name: 'enabled', type: 'bool' },
      { name: 'removableAt', type: 'uint64' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'pendingCap',
    outputs: [
      { name: 'value', type: 'uint192' },
      { name: 'validAt', type: 'uint64' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // Pending actions
  {
    inputs: [],
    name: 'pendingFee',
    outputs: [
      { name: 'value', type: 'uint192' },
      { name: 'validAt', type: 'uint64' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'pendingTimelock',
    outputs: [
      { name: 'value', type: 'uint192' },
      { name: 'validAt', type: 'uint64' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'pendingGuardian',
    outputs: [
      { name: 'value', type: 'address' },
      { name: 'validAt', type: 'uint96' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  // Queues
  {
    inputs: [{ name: 'index', type: 'uint256' }],
    name: 'supplyQueue',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'supplyQueueLength',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'index', type: 'uint256' }],
    name: 'withdrawQueue',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'withdrawQueueLength',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // ---- Write Functions (Curator) ----
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
        name: 'marketParams',
        type: 'tuple',
      },
      { name: 'newSupplyCap', type: 'uint256' },
    ],
    name: 'submitCap',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
        name: 'marketParams',
        type: 'tuple',
      },
    ],
    name: 'acceptCap',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
        name: 'marketParams',
        type: 'tuple',
      },
    ],
    name: 'submitMarketRemoval',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // ---- Write Functions (Allocator) ----
  {
    inputs: [{ name: 'newSupplyQueue', type: 'bytes32[]' }],
    name: 'setSupplyQueue',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'indexes', type: 'uint256[]' }],
    name: 'updateWithdrawQueue',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              { name: 'loanToken', type: 'address' },
              { name: 'collateralToken', type: 'address' },
              { name: 'oracle', type: 'address' },
              { name: 'irm', type: 'address' },
              { name: 'lltv', type: 'uint256' },
            ],
            name: 'marketParams',
            type: 'tuple',
          },
          { name: 'assets', type: 'uint256' },
        ],
        name: 'allocations',
        type: 'tuple[]',
      },
    ],
    name: 'reallocate',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // ---- Write Functions (Owner) ----
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
    inputs: [{ name: 'newTimelock', type: 'uint256' }],
    name: 'submitTimelock',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newGuardian', type: 'address' }],
    name: 'submitGuardian',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // ---- Write Functions (Owner — additional) ----
  {
    inputs: [{ name: 'newSkimRecipient', type: 'address' }],
    name: 'setSkimRecipient',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'acceptTimelock',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'acceptGuardian',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newFee', type: 'uint256' }],
    name: 'submitFee',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'acceptFee',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'newOwner', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'acceptOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'pendingOwner',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  // ---- Write Functions (Guardian) ----
  {
    inputs: [],
    name: 'revokePendingTimelock',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'revokePendingGuardian',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'revokePendingCap',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'revokePendingMarketRemoval',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Multicall
  {
    inputs: [{ name: 'data', type: 'bytes[]' }],
    name: 'multicall',
    outputs: [{ name: 'results', type: 'bytes[]' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // Skim
  {
    inputs: [{ name: 'token', type: 'address' }],
    name: 'skim',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'data', type: 'bytes[]' }],
    name: 'multicall',
    outputs: [{ name: 'results', type: 'bytes[]' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// ============================================================
// MetaMorpho V1 Factory
// ============================================================

export const metaMorphoFactoryAbi = [
  {
    inputs: [{ name: 'target', type: 'address' }],
    name: 'isMetaMorpho',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'initialOwner', type: 'address' },
      { name: 'initialTimelock', type: 'uint256' },
      { name: 'asset', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
      { name: 'salt', type: 'bytes32' },
    ],
    name: 'createMetaMorpho',
    outputs: [{ name: 'metaMorpho', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MORPHO',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'metaMorpho', type: 'address' },
      { indexed: true, name: 'caller', type: 'address' },
      { indexed: false, name: 'initialOwner', type: 'address' },
      { indexed: false, name: 'initialTimelock', type: 'uint256' },
      { indexed: true, name: 'asset', type: 'address' },
      { indexed: false, name: 'name', type: 'string' },
      { indexed: false, name: 'symbol', type: 'string' },
      { indexed: false, name: 'salt', type: 'bytes32' },
    ],
    name: 'CreateMetaMorpho',
    type: 'event',
  },
] as const;

// ============================================================
// MetaMorpho V2 Factory
// ============================================================

export const metaMorphoV2FactoryAbi = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'isVaultV2',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    name: 'createVaultV2',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'asset', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    name: 'vaultV2',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'owner', type: 'address' },
      { indexed: true, name: 'asset', type: 'address' },
      { indexed: false, name: 'salt', type: 'bytes32' },
      { indexed: true, name: 'newVaultV2', type: 'address' },
    ],
    name: 'CreateVaultV2',
    type: 'event',
  },
] as const;

// ============================================================
// MetaMorpho V2 Vault (config functions)
// ============================================================

export const metaMorphoV2Abi = [
  // ---- Read Functions ----
  { inputs: [], name: 'name', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'asset', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalAssets', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'owner', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'curator', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'allocator', type: 'address' }], name: 'isAllocator', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'sentinel', type: 'address' }], name: 'isSentinel', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'performanceFee', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'managementFee', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'performanceFeeRecipient', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'managementFeeRecipient', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'adaptersLength', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [{ name: 'selector', type: 'bytes4' }],
    name: 'timelock',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  // ---- Write Functions (Curator — timelocked gate) ----
  {
    inputs: [{ name: 'data', type: 'bytes' }],
    name: 'submit', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  // ---- Write Functions (Owner) ----
  {
    inputs: [{ name: 'newName', type: 'string' }],
    name: 'setName', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'newSymbol', type: 'string' }],
    name: 'setSymbol', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'newCurator', type: 'address' }],
    name: 'setCurator', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'allocator', type: 'address' }, { name: 'isAllocator', type: 'bool' }],
    name: 'setIsAllocator', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'sentinel', type: 'address' }, { name: 'isSentinel', type: 'bool' }],
    name: 'setIsSentinel', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'newFee', type: 'uint256' }],
    name: 'setPerformanceFee', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'newFee', type: 'uint256' }],
    name: 'setManagementFee', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'newRecipient', type: 'address' }],
    name: 'setPerformanceFeeRecipient', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'newRecipient', type: 'address' }],
    name: 'setManagementFeeRecipient', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'selector', type: 'bytes4' }, { name: 'newDuration', type: 'uint256' }],
    name: 'increaseTimelock', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'adapter', type: 'address' }],
    name: 'submitAdapter', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'adapter', type: 'address' }],
    name: 'acceptAdapter', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'newOwner', type: 'address' }],
    name: 'transferOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [],
    name: 'acceptOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [],
    name: 'pendingOwner', outputs: [{ name: '', type: 'address' }], stateMutability: 'view', type: 'function',
  },
  // Multicall (V2 returns void; V1 returns bytes[] — void ABI works for sendTransaction on both)
  {
    inputs: [{ name: 'data', type: 'bytes[]' }],
    name: 'multicall',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// ============================================================
// IOracle
// ============================================================

export const oracleAbi = [
  {
    inputs: [],
    name: 'price',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ============================================================
// ERC-20 (minimal)
// ============================================================

export const erc20Abi = [
  {
    inputs: [],
    name: 'name',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ============================================================
// Morpho Blue — Additional functions for market creation & supply
// ============================================================

export const morphoBlueExtendedAbi = [
  {
    name: 'createMarket', type: 'function', stateMutability: 'nonpayable',
    inputs: [{
      name: 'marketParams', type: 'tuple',
      components: [
        { name: 'loanToken', type: 'address' },
        { name: 'collateralToken', type: 'address' },
        { name: 'oracle', type: 'address' },
        { name: 'irm', type: 'address' },
        { name: 'lltv', type: 'uint256' },
      ],
    }],
    outputs: [],
  },
  {
    name: 'supply', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'marketParams', type: 'tuple',
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
      },
      { name: 'assets', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [
      { name: 'assetsSupplied', type: 'uint256' },
      { name: 'sharesSupplied', type: 'uint256' },
    ],
  },
] as const;

// ============================================================
// ERC-20 Approve
// ============================================================

export const erc20ApproveAbi = [
  {
    name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

// ============================================================
// Oracle Introspection (MorphoChainlinkOracleV2)
// ============================================================

export const oracleIntrospectionAbi = [
  { name: 'price', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'SCALE_FACTOR', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'BASE_FEED_1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'BASE_FEED_2', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'QUOTE_FEED_1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'QUOTE_FEED_2', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'BASE_VAULT', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'QUOTE_VAULT', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'BASE_VAULT_CONVERSION_SAMPLE', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'QUOTE_VAULT_CONVERSION_SAMPLE', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

// ============================================================
// Chainlink Feed
// ============================================================

export const chainlinkFeedAbi = [
  {
    name: 'latestRoundData', type: 'function', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { name: 'description', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

// ============================================================
// MorphoChainlinkOracleV2 Factory
// ============================================================

export const oracleV2FactoryAbi = [
  {
    name: 'createMorphoChainlinkOracleV2',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'baseVault', type: 'address' },
      { name: 'baseVaultConversionSample', type: 'uint256' },
      { name: 'baseFeed1', type: 'address' },
      { name: 'baseFeed2', type: 'address' },
      { name: 'baseTokenDecimals', type: 'uint256' },
      { name: 'quoteVault', type: 'address' },
      { name: 'quoteVaultConversionSample', type: 'uint256' },
      { name: 'quoteFeed1', type: 'address' },
      { name: 'quoteFeed2', type: 'address' },
      { name: 'quoteTokenDecimals', type: 'uint256' },
    ],
    outputs: [{ name: 'oracle', type: 'address' }],
  },
] as const;

// ============================================================
// IRM (Adaptive Curve)
// ============================================================

// ============================================================
// Public Allocator
// ============================================================

export const publicAllocatorAbi = [
  // View
  { inputs: [], name: 'MORPHO', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'vault', type: 'address' }], name: 'admin', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'vault', type: 'address' }], name: 'fee', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'vault', type: 'address' }], name: 'accruedFee', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [{ name: 'vault', type: 'address' }, { name: 'id', type: 'bytes32' }],
    name: 'flowCaps',
    outputs: [{ name: 'maxIn', type: 'uint128' }, { name: 'maxOut', type: 'uint128' }],
    stateMutability: 'view', type: 'function',
  },
  // Admin / Owner
  {
    inputs: [{ name: 'vault', type: 'address' }, { name: 'newAdmin', type: 'address' }],
    name: 'setAdmin', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'vault', type: 'address' }, { name: 'newFee', type: 'uint256' }],
    name: 'setFee', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [
      { name: 'vault', type: 'address' },
      {
        name: 'config', type: 'tuple[]',
        components: [
          { name: 'id', type: 'bytes32' },
          { name: 'caps', type: 'tuple', components: [{ name: 'maxIn', type: 'uint128' }, { name: 'maxOut', type: 'uint128' }] },
        ],
      },
    ],
    name: 'setFlowCaps', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
  {
    inputs: [{ name: 'vault', type: 'address' }, { name: 'feeRecipient', type: 'address' }],
    name: 'transferFee', outputs: [], stateMutability: 'nonpayable', type: 'function',
  },
] as const;

// ============================================================
// IRM (Adaptive Curve)
// ============================================================

export const irmAbi = [
  {
    name: 'borrowRateView', type: 'function', stateMutability: 'view',
    inputs: [
      {
        name: 'marketParams', type: 'tuple',
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
      },
      {
        name: 'market', type: 'tuple',
        components: [
          { name: 'totalSupplyAssets', type: 'uint128' },
          { name: 'totalSupplyShares', type: 'uint128' },
          { name: 'totalBorrowAssets', type: 'uint128' },
          { name: 'totalBorrowShares', type: 'uint128' },
          { name: 'lastUpdate', type: 'uint128' },
          { name: 'fee', type: 'uint128' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
