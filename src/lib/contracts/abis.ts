/**
 * Morpho Protocol ABI definitions.
 * Only includes functions actually used by the curator app.
 *
 * Custom-error fragments (audit D5) are spread in from `./morphoErrors` so viem
 * can decode named Morpho reverts instead of opaque "execution reverted".
 */
import {
  MORPHO_METAMORPHO_V1_ERRORS,
  MORPHO_PUBLIC_ALLOCATOR_ERRORS,
} from './morphoErrors';

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
  // Custom errors — verbatim from @morpho-org/blue-sdk-viem `metaMorphoAbi`.
  ...MORPHO_METAMORPHO_V1_ERRORS,
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
// Moolah Vault Factory (Lista DAO — BNB Chain)
// ------------------------------------------------------------
// Fork of MetaMorpho with a different factory signature.
// Selector: 0x72147ee8 createMoolahVault(address,address,address,uint256,address,string,string)
// Constraints:
//   - timeLockDelay >= 86400 (1 day) — enforced by TimeLock constructor
//   - asset.decimals() == 18 — enforced by factory
//   - No salt (uses CREATE, not CREATE2)
// Returns: (vaultProxy, managerTimeLock, curatorTimeLock)
// Source: https://github.com/lista-dao/moolah/blob/main/src/moolah-vault/MoolahVaultFactory.sol
// ============================================================

export const moolahVaultFactoryAbi = [
  {
    inputs: [{ name: 'target', type: 'address' }],
    name: 'isMoolahVault',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'MOOLAH',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'manager', type: 'address' },
      { name: 'curator', type: 'address' },
      { name: 'guardian', type: 'address' },
      { name: 'timeLockDelay', type: 'uint256' },
      { name: 'asset', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'symbol', type: 'string' },
    ],
    name: 'createMoolahVault',
    outputs: [
      { name: 'vault', type: 'address' },
      { name: 'managerTimeLock', type: 'address' },
      { name: 'curatorTimeLock', type: 'address' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'moolahVault', type: 'address' },
      { indexed: false, name: 'implementation', type: 'address' },
      { indexed: false, name: 'managerTimeLock', type: 'address' },
      { indexed: false, name: 'curatorTimeLock', type: 'address' },
      { indexed: false, name: 'timeLockDelay', type: 'uint256' },
      { indexed: true, name: 'caller', type: 'address' },
      { indexed: false, name: 'manager', type: 'address' },
      { indexed: false, name: 'curator', type: 'address' },
      { indexed: false, name: 'guardian', type: 'address' },
      { indexed: true, name: 'asset', type: 'address' },
      { indexed: false, name: 'name', type: 'string' },
      { indexed: false, name: 'symbol', type: 'string' },
    ],
    name: 'CreateMoolahVault',
    type: 'event',
  },
] as const;

/** Moolah TimeLock minimum delay — enforced in TimeLock constructor. */
export const MOOLAH_MIN_TIMELOCK_DELAY = 86_400n; // 1 day

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
// MetaMorpho V2 Vault — single source of truth in metaMorphoV2Abi.ts
// ============================================================

export { metaMorphoV2Abi } from './metaMorphoV2Abi';

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
  {
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    name: 'allowance',
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
  {
    name: 'supplyCollateral', type: 'function', stateMutability: 'nonpayable',
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
      { name: 'onBehalf', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'borrow', type: 'function', stateMutability: 'nonpayable',
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
      { name: 'receiver', type: 'address' },
    ],
    outputs: [
      { name: 'assetsBorrowed', type: 'uint256' },
      { name: 'sharesBorrowed', type: 'uint256' },
    ],
  },
  {
    name: 'isLltvEnabled', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'lltv', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'isIrmEnabled', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'irm', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
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
  // Custom errors — verbatim from @morpho-org/blue-sdk-viem `publicAllocatorAbi`.
  ...MORPHO_PUBLIC_ALLOCATOR_ERRORS,
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
