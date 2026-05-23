/**
 * ABIs for Market V1 Adapter V2 Factory and Vault V1 Adapter Factory.
 *
 * MorphoMarketV1AdapterV2Factory: deploys adapters that connect V2 vaults
 * to Morpho Blue markets. **One adapter per vault** (CREATE2) — re-creating
 * reverts. Use `morphoMarketV1AdapterV2(parentVault)` to read the existing
 * adapter and skip the deploy when it's already present (PR 9).
 *
 * MorphoVaultV1AdapterFactory: deploys adapters that connect V2 vaults
 * to existing V1 MetaMorpho vaults. One per (parentVault, morphoVaultV1)
 * pair — `morphoVaultV1Adapter` returns the existing one.
 *
 * Shapes are taken verbatim from `@morpho-org/blue-sdk-viem`'s
 * `morphoMarketV1AdapterV2FactoryAbi` / `morphoVaultV1AdapterFactoryAbi`
 * (PR 9 — the previous hand-written event ABIs had the adapter param
 * non-indexed, which is wrong: the real events emit it INDEXED. That
 * silently broke log parsing and is why a successful on-chain deploy was
 * mis-detected as a failure, leaving subsequent retries to revert against
 * the already-deployed adapter).
 *
 * No custom-error fragments: the SDK exposes 0 `type:'error'` entries for
 * these factory ABIs (string reverts only). Deliberately omitted.
 */

// ============================================================
// MorphoMarketV1AdapterV2Factory
// ============================================================

export const marketV1AdapterV2FactoryAbi = [
  // --- views ---
  {
    // Returns the already-deployed adapter for this parentVault, or 0x0 if
    // none has been created yet. Use this BEFORE calling `create…` to avoid
    // a revert on the one-per-vault factory.
    inputs: [{ name: 'parentVault', type: 'address' }],
    name: 'morphoMarketV1AdapterV2',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'isMorphoMarketV1AdapterV2',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  // --- writes ---
  {
    inputs: [{ name: 'parentVault', type: 'address' }],
    name: 'createMorphoMarketV1AdapterV2',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // --- events --- (BOTH params indexed; second param is named
  // `morphoMarketV1AdapterV2`, not `adapter`).
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'parentVault', type: 'address' },
      { indexed: true, name: 'morphoMarketV1AdapterV2', type: 'address' },
    ],
    name: 'CreateMorphoMarketV1AdapterV2',
    type: 'event',
  },
] as const;

// ============================================================
// MorphoVaultV1AdapterFactory
// ============================================================

export const vaultV1AdapterFactoryAbi = [
  // --- views ---
  {
    inputs: [
      { name: 'parentVault', type: 'address' },
      { name: 'morphoVaultV1', type: 'address' },
    ],
    name: 'morphoVaultV1Adapter',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'isMorphoVaultV1Adapter',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  // --- writes ---
  {
    inputs: [
      { name: 'parentVault', type: 'address' },
      { name: 'morphoVaultV1', type: 'address' },
    ],
    name: 'createMorphoVaultV1Adapter',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // --- events --- (all three params indexed; third is the adapter).
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'parentVault', type: 'address' },
      { indexed: true, name: 'morphoVaultV1', type: 'address' },
      { indexed: true, name: 'morphoVaultV1Adapter', type: 'address' },
    ],
    name: 'CreateMorphoVaultV1Adapter',
    type: 'event',
  },
] as const;
