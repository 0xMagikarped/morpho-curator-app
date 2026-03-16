/**
 * ABIs for Market V1 Adapter V2 Factory and Vault V1 Adapter Factory.
 *
 * MorphoMarketV1AdapterV2Factory: deploys adapters that connect V2 vaults
 * to Morpho Blue markets. One adapter per vault — markets added via caps.
 * Takes only the parentVault as arg.
 *
 * MorphoVaultV1AdapterFactory: deploys adapters that connect V2 vaults
 * to existing V1 MetaMorpho vaults. Takes (parentVault, morphoVaultV1).
 *
 * IMPORTANT: Factory events emit adapter address in data (NOT indexed).
 */

// ============================================================
// MorphoMarketV1AdapterV2Factory
// ============================================================

export const marketV1AdapterV2FactoryAbi = [
  {
    inputs: [{ name: 'parentVault', type: 'address' }],
    name: 'createMorphoMarketV1AdapterV2',
    outputs: [{ name: 'adapter', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'adapter', type: 'address' }],
    name: 'isMorphoMarketV1AdapterV2',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'parentVault', type: 'address' },
      { indexed: false, name: 'adapter', type: 'address' },
    ],
    name: 'CreateMorphoMarketV1AdapterV2',
    type: 'event',
  },
] as const;

// ============================================================
// MorphoVaultV1AdapterFactory
// ============================================================

export const vaultV1AdapterFactoryAbi = [
  {
    inputs: [
      { name: 'parentVault', type: 'address' },
      { name: 'morphoVaultV1', type: 'address' },
    ],
    name: 'createMorphoVaultV1Adapter',
    outputs: [{ name: 'adapter', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'adapter', type: 'address' }],
    name: 'isMorphoVaultV1Adapter',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'parentVault', type: 'address' },
      { indexed: false, name: 'adapter', type: 'address' },
    ],
    name: 'CreateMorphoVaultV1Adapter',
    type: 'event',
  },
] as const;
