import type { Address } from 'viem';
import type { ChainConfig } from '../types';

/**
 * Chain configurations for Morpho Protocol deployments.
 *
 * CRITICAL: On SEI, Morpho contracts are NOT at standard CREATE2 addresses.
 * The actual addresses were discovered via on-chain verification (March 2026).
 *
 * Verification method: eth_getCode + MORPHO() function call on known vaults.
 */

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  // ============================================================
  // SEI (Chain ID 1329) — V1 ONLY
  // ============================================================
  1329: {
    chainId: 1329,
    name: 'SEI',
    protocol: 'morpho',
    defaultVaultFlavor: 'metaMorphoV1',
    rpcUrls: [
      // sei-apis (official Sei Labs endpoint) first — publicnode has been
      // throttling burst reads. drpc + basementnodes diversify the
      // fallback so reads keep flowing if any one host is down.
      'https://evm-rpc.sei-apis.com',
      'https://sei.drpc.org',
      'https://evm-rpc.sei.basementnodes.ca',
      'https://sei-evm-rpc.publicnode.com',
    ],
    blockExplorer: 'https://seiscan.io',
    morphoBlue: '0xc9cDAc20FCeAAF616f7EB0bb6Cd2c69dcfa9094c' as Address,
    deployed: true,
    vaultFactories: {
      v1: '0x8Dea49ec5bd5AeAc8bcf96B3E187F59354118291' as Address, // MetaMorpho Factory V1.1
    },
    periphery: {
      bundler3: undefined,
      publicAllocator: '0xD878509446bE2C601f0f032F501851001B159D6B' as Address,
      adaptiveCurveIrm: '0x6eFA8e3Aa8279eB2fd46b6083A9E52dA72EA56c4' as Address,
      oracleV2Factory: '0x4bD68c2FF3274207EC07ED281C915758b6F23F07' as Address,
    },
    apiSupported: false, // Morpho GraphQL API does NOT index SEI
    blockTime: 400,
    finality: 'instant',
    gasConfig: {
      blockGasLimit: 10_000_000,
      sstoreCost: 72_000,
    },
    nativeToken: {
      symbol: 'SEI',
      decimals: 18,
      wrapped: '0xE30feDd158A2e3b13e9badaeABaFc5516e95e8C7' as Address,
    },
    stablecoins: [
      {
        symbol: 'USDC',
        address: '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392' as Address,
        decimals: 6,
      },
      {
        symbol: 'PYUSD',
        address: '0x142cdc44890978B506e745bB3Bd11607B7f7faEf' as Address,
        decimals: 6,
      },
    ],
    oracleProviders: ['chainlink-data-streams', 'pyth', 'redstone', 'api3'],
    deploymentBlock: 166036723, // Morpho Blue deployment block on SEI
    verified: true,
    scanner: {
      batchSize: 2000,        // SEI has 10M block gas limit — smaller batches
      pollIntervalMs: 5000,
    },
    migration: {
      usdcBridgedToNative: {
        status: 'pending',
        bridgedAddress: '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392' as Address,
        nativeAddress: null, // UPDATE WHEN KNOWN — native USDC not yet deployed on SEI
        announcementUrl: null,
      },
    },
  },

  // ============================================================
  // Ethereum Mainnet (Chain ID 1) — V1 + V2, STANDARD ADDRESSES
  // ============================================================
  1: {
    chainId: 1,
    name: 'Ethereum',
    protocol: 'morpho',
    defaultVaultFlavor: 'metaMorphoV1',
    rpcUrls: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
    blockExplorer: 'https://etherscan.io',
    morphoBlue: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as Address,
    deployed: true,
    vaultFactories: {
      v1: '0x1897A8997241C1cD4bD0698647e4EB7213535c24' as Address,
      v2: '0xA1D94F746dEfa1928926b84fB2596c06926C0405' as Address,
    },
    periphery: {
      bundler3: '0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245' as Address,
      publicAllocator:
        '0xfd32fA2ca22c76dD6E550706Ad913FC6CE91c75D' as Address,
      adaptiveCurveIrm:
        '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC' as Address,
      oracleV2Factory:
        '0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766' as Address,
      v2AdapterRegistry: '0x3696c5eAe4a7Ffd04Ea163564571E9CD8Ed9364e' as Address,
      morphoMarketV1AdapterV2Factory: '0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1' as Address,
      morphoVaultV1AdapterFactory: '0xD1B8E2dee25c2b89DCD2f98448a7ce87d6F63394' as Address,
    },
    apiSupported: true,
    blockTime: 12_000,
    finality: 'probabilistic',
    gasConfig: {
      blockGasLimit: 30_000_000,
      sstoreCost: 20_000,
    },
    nativeToken: {
      symbol: 'ETH',
      decimals: 18,
      wrapped: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
    },
    stablecoins: [
      {
        symbol: 'USDC',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
        decimals: 6,
      },
      {
        symbol: 'USDT',
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address,
        decimals: 6,
      },
      {
        symbol: 'DAI',
        address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' as Address,
        decimals: 18,
      },
    ],
    oracleProviders: ['chainlink-push', 'pyth', 'redstone'],
    deploymentBlock: 18_883_124,
    verified: true,
    scanner: {
      batchSize: 10_000,
      pollIntervalMs: 15_000,
    },
  },

  // ============================================================
  // Base (Chain ID 8453) — V1 + V2, STANDARD ADDRESSES
  // ============================================================
  8453: {
    chainId: 8453,
    name: 'Base',
    protocol: 'morpho',
    defaultVaultFlavor: 'metaMorphoV1',
    rpcUrls: ['https://mainnet.base.org', 'https://base.llamarpc.com'],
    blockExplorer: 'https://basescan.org',
    morphoBlue: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as Address,
    deployed: true,
    vaultFactories: {
      v1: '0xFf62A7c278C62eD665133147129245053Bbf5918' as Address,
      v2: '0x4501125508079A99ebBebCE205DeC9593C2b5857' as Address,
    },
    periphery: {
      publicAllocator: '0xA090dD1a701408Df1d4d0B85b716c87565f90467' as Address,
      adaptiveCurveIrm:
        '0x46415998764C29aB2a25CbeA6254146D50D22687' as Address,
      oracleV2Factory:
        '0x2DC205F24BCb6B311E5cdf0745B0741648Aebd3d' as Address,
      v2AdapterRegistry: '0x3696c5eAe4a7Ffd04Ea163564571E9CD8Ed9364e' as Address,
      morphoMarketV1AdapterV2Factory: '0x32BB1c0D48D8b1B3363e86eeB9A0300BAd61ccc1' as Address,
      morphoVaultV1AdapterFactory: '0xD1B8E2dee25c2b89DCD2f98448a7ce87d6F63394' as Address,
    },
    apiSupported: true,
    blockTime: 2_000,
    finality: 'probabilistic',
    gasConfig: {
      blockGasLimit: 30_000_000,
      sstoreCost: 20_000,
    },
    nativeToken: {
      symbol: 'ETH',
      decimals: 18,
      wrapped: '0x4200000000000000000000000000000000000006' as Address,
    },
    stablecoins: [
      {
        symbol: 'USDC',
        address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
        decimals: 6,
      },
    ],
    oracleProviders: ['chainlink-push', 'pyth', 'redstone'],
    deploymentBlock: 7_970_000,
    verified: true,
    scanner: {
      batchSize: 10_000,
      pollIntervalMs: 5_000,
    },
  },

  // ============================================================
  // BNB Smart Chain (Chain ID 56) — Lista DAO Moolah
  // ============================================================
  // Moolah is a Morpho Blue + MetaMorpho V1 fork. BNB defaults to
  // `moolahVault` flavor across the entire app — no vanilla Morpho on BNB.
  // Addresses verified April 2026 against `lista-dao/moolah` deploy scripts
  // and `lista-dao/lending-sdk` config. See `docs/bnb-lista-inventory.md`.
  // ============================================================
  56: {
    chainId: 56,
    name: 'BNB Chain',
    displayName: 'BNB Chain — Lista Moolah',
    protocol: 'moolah',
    defaultVaultFlavor: 'moolahVault',
    rpcUrls: [
      'https://bsc.publicnode.com',
      'https://bsc-dataseed1.binance.org',
      'https://bsc-dataseed2.binance.org',
    ],
    blockExplorer: 'https://bscscan.com',
    // Moolah singleton (ERC1967 proxy) — callable for reads and writes.
    morphoBlue: '0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C' as Address,
    deployed: true,
    vaultFactories: {
      v1: '0x2a0Cb6401FD3c6196750dc6b46702040761D9671' as Address, // MoolahVaultFactory
    },
    periphery: {
      // BSC-specific IRMs (previously cross-wired with Ethereum values).
      adaptiveCurveIrm: '0xFe7dAe87Ebb11a7BEB9F534BB23267992d9cDe7c' as Address,
      fixedRateIrm: ['0x5F9f9173B405C6CEAfa7f98d09e4B8447e9797E6' as Address],
    },
    moolah: {
      // MarketFactory proxy — confirmed from Lista's `docs.bsc.lista.org`
      // (llms-full.txt) + on-chain ERC1967 impl slot verification
      // (`0x12bb76cd6a2a1ccf2ac2cff64072fed6d8a128e3`). Override via
      // `VITE_BNB_MARKET_FACTORY` env var; auto-discovery fallback lives in
      // `src/lib/moolah/resolveMarketFactory.ts` if the address rotates.
      marketFactory: (
        import.meta.env?.VITE_BNB_MARKET_FACTORY ??
        '0xce26859127d236a61f168d2d0905f77d7E286Ab2'
      ) as Address,
      vaultAllocator: '0x9ECF66f016FCaA853FdA24d223bdb4276E5b524a' as Address,
      vaultAdmin: '0x07D274a68393E8b8a2CCf19A2ce4Ba3518735253' as Address,
      vaultImpl: '0xA1f832c7C7ECf91A53b4ff36E0ABdb5133C15982' as Address,
      brokerRateCalculator: '0xF81A3067ACF683B7f2f40a22bCF17c8310be2330' as Address,
      fixedRateIrm: '0x5F9f9173B405C6CEAfa7f98d09e4B8447e9797E6' as Address,
      liquidators: {
        liquidator: '0x6a87C15598929B2db22cF68a9a0dDE5Bf297a59a' as Address,
        publicLiquidator: '0x882475d622c687b079f149B69a15683FCbeCC6D9' as Address,
        brokerLiquidator: '0x3AA647a1e902833b61E503DbBFbc58992daa4868' as Address,
      },
      revenue: {
        revenueDistributor: '0x34B504A5CF0fF41F8A480580533b6Dda687fa3Da' as Address,
        buyback: '0x3b99A4177E3f430590A8473f353dD87a5a2e1BfC' as Address,
        autoBuyback: '0xFfd3a57E8DB4f51FA01c72F06Ff30BDFDa9908e6' as Address,
      },
      providers: {
        BNB: '0x367384C54756a25340c63057D87eA22d47Fd5701' as Address,
        slisBNB: '0x33f7A980a246f9B8FEA2254E3065576E127D4D5f' as Address,
        smartProvider: '0xcc93cb664Ed2abF4F428440A7868fdc3c30e5a1b' as Address,
      },
      roles: {
        operator: '0x8d388136d578dCD791D081c6042284CED6d9B0c6' as Address,
        pauser: '0xEEfebb1546d88EA0909435DF6f615084DD3c5Bd8' as Address,
      },
      docsUrl: 'https://docs.bsc.lista.org/',
    },
    knownVaults: {
      '0x57134a64b7cd9f9eb72f8255a671f5bf2fe3e2d0': { flavor: 'moolahVault', label: 'Lista DAO BNB Vault' },
      '0xfa27f172e0b6ebcef9c51abf817e2cb142fbe627': { flavor: 'moolahVault', label: 'Lista USD1 Vault' },
      '0x02a5ca3a749855d1002a78813e679584a96646d0': { flavor: 'moolahVault', label: 'Re7 USD1' },
      '0xce51d66343ed1ffaf82432b7436b5a128445ef2b': { flavor: 'moolahVault', label: 'Native BSC USDT' },
    },
    apiSupported: false,
    blockTime: 3_000,
    finality: 'probabilistic',
    gasConfig: {
      blockGasLimit: 140_000_000,
      sstoreCost: 20_000,
    },
    nativeToken: {
      symbol: 'BNB',
      decimals: 18,
      wrapped: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' as Address,
    },
    stablecoins: [
      {
        symbol: 'USDT',
        address: '0x55d398326f99059fF775485246999027B3197955' as Address,
        decimals: 18,
      },
      {
        symbol: 'USD1',
        address: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d' as Address,
        decimals: 18,
      },
    ],
    oracleProviders: ['chainlink-push', 'pyth', 'custom'],
    deploymentBlock: 48_174_557, // First CreateMarket on Moolah (2025-04-08)
    verified: true,
    scanner: {
      batchSize: 5_000,
      pollIntervalMs: 5_000,
    },
  },

  // ============================================================
  // Pharos (Chain ID 1672) — Official Morpho Deployment (RWA L1)
  // CONTRACTS NOT YET DEPLOYED — fill addresses when morpho-org/sdks ships Pharos support
  // Track: https://github.com/morpho-org/sdks → packages/blue-sdk/src/addresses.ts
  // ============================================================
  // ============================================================
  // Pharos Mainnet (Chain ID 1672) — Morpho V2 (Vault V2 + Adapters)
  // Addresses from morpho-org/sdks addresses.ts, verified April 2026.
  // ============================================================
  1672: {
    chainId: 1672,
    name: 'Pharos',
    protocol: 'morpho',
    defaultVaultFlavor: 'metaMorphoV1',
    rpcUrls: ['https://rpc.pharos.xyz'],
    blockExplorer: 'https://pharosscan.xyz',
    morphoBlue: '0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb' as Address,
    deployed: true,
    vaultFactories: {
      v2: '0x8E01ed1E1A41029b3137FcE9Aa880c0A54827498' as Address,
    },
    periphery: {
      adaptiveCurveIrm: '0xD5E02889C13230458506CC842347c4E62F8cDF3a' as Address,
      bundler3: '0x3c90c09F8c5d927a117F681fB924952DbbD99120' as Address,
      v2AdapterRegistry: '0xbe858d729548eB49BbFA05Acd3674ca8cdaAdD4b' as Address,
      morphoMarketV1AdapterV2Factory: '0xe510e1fcC429943cA3455A7bfBD79f0307Cd8403' as Address,
    },
    apiSupported: false,
    blockTime: 2_000,
    finality: 'probabilistic',
    gasConfig: {
      blockGasLimit: 30_000_000,
      sstoreCost: 20_000,
    },
    nativeToken: {
      symbol: 'ETH',
      decimals: 18,
      wrapped: '0x52C48d4213107b20bC583832b0d951FB9CA8F0B0' as Address,
    },
    stablecoins: [],
    oracleProviders: ['chainlink-push'],
    deploymentBlock: 0,
    verified: true,
    scanner: {
      batchSize: 5_000,
      pollIntervalMs: 5_000,
    },
  },

  // ============================================================
  // XDC Network (Chain ID 50) — Morpho Vault V2 only
  // ============================================================
  // XDC has the Morpho Vault V2 stack deployed but NO MetaMorpho V1
  // factory. Only `vaultFactories.v2` is populated, so the create-vault
  // wizard surfaces XDC under the V2 flow exclusively and never the V1
  // flow (`ChainAssetStep.tsx` filters chains by factory presence).
  // All addresses verified on-chain via eth_getCode (2026-05-22).
  // ============================================================
  50: {
    chainId: 50,
    name: 'XDC Network',
    protocol: 'morpho',
    defaultVaultFlavor: 'metaMorphoV1',
    rpcUrls: [
      'https://rpc.xinfin.network',
      'https://erpc.xdcrpc.com',
      'https://rpc.xdc.network',
    ],
    blockExplorer: 'https://xdcscan.com',
    morphoBlue: '0xEa49B0fE898aF913A3826F9f462eE2cDcb854fD9' as Address,
    deployed: true,
    vaultFactories: {
      v2: '0x227544d6989cD15c05AAB6dde4F29523dcfdbe2B' as Address,
    },
    periphery: {
      adaptiveCurveIrm: '0x15c7312B0f26aa0AA70B24a0D2AF87B9e7D614A0' as Address,
      oracleV2Factory: '0x6Ad93a3aA829514473D3DF67382894A76c7283B4' as Address,
      v2AdapterRegistry: '0x79A8C4e9E502C1867cAf2E7202f0C6b89aaCd5c1' as Address,
      morphoMarketV1AdapterV2Factory:
        '0x5C00c99F2235439725417E9f037B7D38FfF35d31' as Address,
    },
    apiSupported: false,
    blockTime: 2_000,
    finality: 'probabilistic',
    gasConfig: {
      blockGasLimit: 30_000_000,
      sstoreCost: 20_000,
    },
    nativeToken: {
      symbol: 'XDC',
      decimals: 18,
      wrapped: '0x951857744785E80e2De051c32EE7b25f9c458C42' as Address,
    },
    stablecoins: [],
    oracleProviders: ['chainlink-push'],
    deploymentBlock: 0,
    verified: true,
    scanner: {
      batchSize: 5_000,
      pollIntervalMs: 5_000,
    },
  },
};

/** Chains where Morpho GraphQL API is available */
export const MORPHO_API_CHAINS = Object.values(CHAIN_CONFIGS)
  .filter((c) => c.apiSupported)
  .map((c) => c.chainId);

/** Morpho GraphQL API endpoint */
export const MORPHO_API_URL = 'https://api.morpho.org/graphql';

/** Known vaults on SEI (discovered via on-chain verification + seitrace factory scan) */
export const SEI_KNOWN_VAULTS: Record<string, { address: `0x${string}`; name: string }> = {
  featherUSDC: {
    address: '0x015F10a56e97e02437D294815D8e079e1903E41C',
    name: 'Feather USDC',
  },
  pyusd0YieldNetwork: {
    address: '0x433Ee8A4Cda6e6f1D8009D5748Ab02c8E4430beB',
    name: 'PYUSD0 Yield Network',
  },
  seiLeveredRWA: {
    address: '0x959C4C55876C193132eaEC2675a13b7fE3e85648',
    name: 'Sei Levered RWA Vault',
  },
};

/** Known vaults on BNB / Lista Lending (pre-factory + factory-created, verified April 2026) */
export const BNB_KNOWN_VAULTS: Record<string, { address: `0x${string}`; name: string }> = {
  listaWbnb: {
    address: '0x57134a64B7cD9F9eb72F8255A671F5Bf2fe3E2d0',
    name: 'Lista DAO BNB Vault',
  },
  listaUsd1: {
    address: '0xfa27f172e0b6ebcEF9c51ABf817E2cb142FbE627',
    name: 'Lista USD1 Vault',
  },
  re7Usd1: {
    address: '0x02a5ca3a749855d1002a78813e679584a96646d0',
    name: 'Re7 USD1',
  },
  nativeUsdt: {
    address: '0xce51d66343ed1ffaf82432b7436b5a128445ef2b',
    name: 'Native BSC USDT',
  },
};

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAIN_CONFIGS[chainId];
}

export function getSupportedChainIds(): number[] {
  return Object.keys(CHAIN_CONFIGS).map(Number);
}

/**
 * Check if a chain has Morpho contracts deployed and configured.
 * Returns false for chains added to the config but awaiting deployment (e.g., Pharos).
 */
export function isChainDeployed(chainId: number): boolean {
  const config = CHAIN_CONFIGS[chainId];
  return config != null && config.deployed;
}

/** Protocol family for a chain — 'morpho' (default) or 'moolah' (BNB/Lista). */
export function getChainProtocol(chainId: number): 'morpho' | 'moolah' {
  return CHAIN_CONFIGS[chainId]?.protocol ?? 'morpho';
}

/**
 * Pre-detection flavor fallback: known-vault override > chain default > metaMorphoV1.
 * Used before the on-chain probe in `src/lib/vault/flavor.ts` completes.
 */
export function getDefaultVaultFlavor(
  chainId: number,
  vaultAddress?: Address,
): 'metaMorphoV1' | 'moolahVault' {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) return 'metaMorphoV1';
  if (vaultAddress) {
    const override = config.knownVaults?.[vaultAddress.toLowerCase()];
    if (override) return override.flavor;
  }
  return config.defaultVaultFlavor ?? 'metaMorphoV1';
}
