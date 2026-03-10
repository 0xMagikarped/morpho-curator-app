// Morpho SDK augmentation.
//
// The @morpho-org/blue-sdk-viem package contains augmentation files that add
// static .fetch() methods to blue-sdk classes (Vault.fetch(), Market.fetch(), etc).
// However, the package only exports the root — subpath imports for augmentations
// are not available in the current version (v4.5.0).
//
// Instead, we use the standalone fetch functions directly:
//   import { fetchVault, fetchMarket, fetchAccrualVault } from "@morpho-org/blue-sdk-viem";
//
// This file is kept as a placeholder. If a future SDK version adds subpath exports,
// the augmentation imports can be added here.
