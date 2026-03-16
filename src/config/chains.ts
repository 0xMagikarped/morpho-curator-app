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
    rpcUrls: [
      'https://sei-evm-rpc.publicnode.com',
    ],
    blockExplorer: 'https://seitrace.com',
    morphoBlue: '0xc9cdac20fceaaf616f7eb0bb6cd2c69dcfa9094c' as Address,
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
    rpcUrls: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com'],
    blockExplorer: 'https://etherscan.io',
    morphoBlue: '0xBBBBBbbBBb9cc5e90e3b3Af64bdAF62C37EEFFCb' as Address,
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
    rpcUrls: ['https://mainnet.base.org', 'https://base.llamarpc.com'],
    blockExplorer: 'https://basescan.org',
    morphoBlue: '0xBBBBBbbBBb9cc5e90e3b3Af64bdAF62C37EEFFCb' as Address,
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
};

/** Chains where Morpho GraphQL API is available */
export const MORPHO_API_CHAINS = Object.values(CHAIN_CONFIGS)
  .filter((c) => c.apiSupported)
  .map((c) => c.chainId);

/** Morpho GraphQL API endpoint */
export const MORPHO_API_URL = 'https://api.morpho.org/graphql';

/** Known vaults on SEI (discovered via on-chain verification) */
export const SEI_KNOWN_VAULTS: Record<string, { address: `0x${string}`; name: string }> = {
  featherUSDC: {
    address: '0x015F10a56e97e02437D294815D8e079e1903E41C',
    name: 'Feather USDC',
  },
};

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAIN_CONFIGS[chainId];
}

export function getSupportedChainIds(): number[] {
  return Object.keys(CHAIN_CONFIGS).map(Number);
}
