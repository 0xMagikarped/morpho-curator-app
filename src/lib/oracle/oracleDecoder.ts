/**
 * Oracle Decoder — reads all 9 immutable variables from MorphoChainlinkOracleV2,
 * resolves each feed's latestRoundData/decimals/description, resolves ERC-4626
 * vault conversion rates, and computes the oracle price.
 */

import { type Address, type PublicClient } from 'viem';
import { getChainConfig } from '../../config/chains';
import { getPublicClient } from '../data/rpcClient';
import { oracleIntrospectionAbi, chainlinkFeedAbi, metaMorphoV1Abi } from '../contracts/abis';

// ============================================================
// CONSTANTS
// ============================================================

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

// ============================================================
// TYPES
// ============================================================

export interface DecodedFeed {
  address: Address;
  description: string;
  decimals: number;
  latestAnswer: bigint;
  updatedAt: number; // unix seconds
  staleness: number; // seconds since updatedAt
}

export interface DecodedVault {
  address: Address;
  name: string;
  conversionSample: bigint;
  assetsPerShare: bigint; // convertToAssets(conversionSample)
}

export interface DecodedOracle {
  address: Address;
  chainId: number;
  // 9 immutables
  baseFeed1: Address;
  baseFeed2: Address;
  quoteFeed1: Address;
  quoteFeed2: Address;
  baseVault: Address;
  quoteVault: Address;
  baseVaultConversionSample: bigint;
  quoteVaultConversionSample: bigint;
  scaleFactor: bigint;
  // Resolved feed info
  baseFeed1Info: DecodedFeed | null;
  baseFeed2Info: DecodedFeed | null;
  quoteFeed1Info: DecodedFeed | null;
  quoteFeed2Info: DecodedFeed | null;
  // Resolved vault info
  baseVaultInfo: DecodedVault | null;
  quoteVaultInfo: DecodedVault | null;
  // Computed
  price: bigint;
  priceFloat: number; // price / 1e36 for display
  classification: string; // 'Pure Chainlink' | 'Chainlink + ERC-4626' | 'ERC-4626 Only' | 'Unknown'
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Read a Chainlink feed's latestRoundData, decimals, and description.
 * Returns null if the address is zero or if all reads fail.
 */
async function readFeed(client: PublicClient, address: Address): Promise<DecodedFeed | null> {
  if (address === ZERO_ADDRESS) return null;

  try {
    const results = await client.multicall({
      contracts: [
        {
          address,
          abi: chainlinkFeedAbi,
          functionName: 'latestRoundData',
        },
        {
          address,
          abi: chainlinkFeedAbi,
          functionName: 'decimals',
        },
        {
          address,
          abi: chainlinkFeedAbi,
          functionName: 'description',
        },
      ],
      allowFailure: true,
    });

    const roundData = results[0].status === 'success' ? results[0].result : null;
    const decimals = results[1].status === 'success' ? Number(results[1].result) : 0;
    const description = results[2].status === 'success' ? (results[2].result as string) : 'Unknown';

    // latestRoundData returns [roundId, answer, startedAt, updatedAt, answeredInRound]
    const latestAnswer = roundData ? BigInt(roundData[1]) : 0n;
    const updatedAt = roundData ? Number(roundData[3]) : 0;
    const staleness = updatedAt > 0 ? Math.floor(Date.now() / 1000) - updatedAt : 0;

    return {
      address,
      description,
      decimals,
      latestAnswer,
      updatedAt,
      staleness,
    };
  } catch {
    // If multicall itself fails, return partial data
    return {
      address,
      description: 'Read failed',
      decimals: 0,
      latestAnswer: 0n,
      updatedAt: 0,
      staleness: 0,
    };
  }
}

/**
 * Read an ERC-4626 vault's name and convertToAssets(sample).
 * Returns null if the address is zero or if all reads fail.
 */
async function readVault(
  client: PublicClient,
  address: Address,
  sample: bigint,
): Promise<DecodedVault | null> {
  if (address === ZERO_ADDRESS) return null;

  try {
    const results = await client.multicall({
      contracts: [
        {
          address,
          abi: metaMorphoV1Abi,
          functionName: 'name',
        },
        {
          address,
          abi: metaMorphoV1Abi,
          functionName: 'convertToAssets',
          args: [sample],
        },
      ],
      allowFailure: true,
    });

    const name = results[0].status === 'success' ? (results[0].result as string) : 'Unknown';
    const assetsPerShare = results[1].status === 'success' ? BigInt(results[1].result as bigint) : sample;

    return {
      address,
      name,
      conversionSample: sample,
      assetsPerShare,
    };
  } catch {
    return {
      address,
      name: 'Read failed',
      conversionSample: sample,
      assetsPerShare: sample,
    };
  }
}

/**
 * Classify the oracle based on which feeds and vaults are non-zero.
 */
function classifyOracle(
  baseFeed1: Address,
  baseFeed2: Address,
  quoteFeed1: Address,
  quoteFeed2: Address,
  baseVault: Address,
  quoteVault: Address,
): string {
  const hasFeeds =
    baseFeed1 !== ZERO_ADDRESS ||
    baseFeed2 !== ZERO_ADDRESS ||
    quoteFeed1 !== ZERO_ADDRESS ||
    quoteFeed2 !== ZERO_ADDRESS;
  const hasVaults = baseVault !== ZERO_ADDRESS || quoteVault !== ZERO_ADDRESS;

  if (hasFeeds && hasVaults) return 'Chainlink + ERC-4626';
  if (hasFeeds && !hasVaults) return 'Pure Chainlink';
  if (!hasFeeds && hasVaults) return 'ERC-4626 Only';
  return 'Unknown';
}

// ============================================================
// MAIN DECODER
// ============================================================

/**
 * Decode a MorphoChainlinkOracleV2 — reads all 9 immutables + price(),
 * resolves feeds and vaults, and computes classification.
 */
export async function decodeOracle(
  chainId: number,
  oracleAddress: Address,
): Promise<DecodedOracle> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) {
    throw new Error(`Unsupported chain: ${chainId}`);
  }

  const client = getPublicClient(chainId);

  // Step 1: Read all 9 immutables + price() in one multicall batch
  const immutableResults = await client.multicall({
    contracts: [
      { address: oracleAddress, abi: oracleIntrospectionAbi, functionName: 'BASE_FEED_1' },
      { address: oracleAddress, abi: oracleIntrospectionAbi, functionName: 'BASE_FEED_2' },
      { address: oracleAddress, abi: oracleIntrospectionAbi, functionName: 'QUOTE_FEED_1' },
      { address: oracleAddress, abi: oracleIntrospectionAbi, functionName: 'QUOTE_FEED_2' },
      { address: oracleAddress, abi: oracleIntrospectionAbi, functionName: 'BASE_VAULT' },
      { address: oracleAddress, abi: oracleIntrospectionAbi, functionName: 'QUOTE_VAULT' },
      { address: oracleAddress, abi: oracleIntrospectionAbi, functionName: 'BASE_VAULT_CONVERSION_SAMPLE' },
      { address: oracleAddress, abi: oracleIntrospectionAbi, functionName: 'QUOTE_VAULT_CONVERSION_SAMPLE' },
      { address: oracleAddress, abi: oracleIntrospectionAbi, functionName: 'SCALE_FACTOR' },
      { address: oracleAddress, abi: oracleIntrospectionAbi, functionName: 'price' },
    ],
    allowFailure: true,
  });

  const baseFeed1 = immutableResults[0].status === 'success' ? (immutableResults[0].result as Address) : ZERO_ADDRESS;
  const baseFeed2 = immutableResults[1].status === 'success' ? (immutableResults[1].result as Address) : ZERO_ADDRESS;
  const quoteFeed1 = immutableResults[2].status === 'success' ? (immutableResults[2].result as Address) : ZERO_ADDRESS;
  const quoteFeed2 = immutableResults[3].status === 'success' ? (immutableResults[3].result as Address) : ZERO_ADDRESS;
  const baseVault = immutableResults[4].status === 'success' ? (immutableResults[4].result as Address) : ZERO_ADDRESS;
  const quoteVault = immutableResults[5].status === 'success' ? (immutableResults[5].result as Address) : ZERO_ADDRESS;
  const baseVaultConversionSample = immutableResults[6].status === 'success' ? BigInt(immutableResults[6].result as bigint) : 1n;
  const quoteVaultConversionSample = immutableResults[7].status === 'success' ? BigInt(immutableResults[7].result as bigint) : 1n;
  const scaleFactor = immutableResults[8].status === 'success' ? BigInt(immutableResults[8].result as bigint) : 0n;
  const price = immutableResults[9].status === 'success' ? BigInt(immutableResults[9].result as bigint) : 0n;

  // Step 2: Read feed details in parallel
  const [baseFeed1Info, baseFeed2Info, quoteFeed1Info, quoteFeed2Info] = await Promise.all([
    readFeed(client, baseFeed1),
    readFeed(client, baseFeed2),
    readFeed(client, quoteFeed1),
    readFeed(client, quoteFeed2),
  ]);

  // Step 3: Read vault details in parallel
  const [baseVaultInfo, quoteVaultInfo] = await Promise.all([
    readVault(client, baseVault, baseVaultConversionSample),
    readVault(client, quoteVault, quoteVaultConversionSample),
  ]);

  // Step 4: Classify and compute display price
  const classification = classifyOracle(baseFeed1, baseFeed2, quoteFeed1, quoteFeed2, baseVault, quoteVault);
  const priceFloat = Number(price) / 1e36;

  return {
    address: oracleAddress,
    chainId,
    baseFeed1,
    baseFeed2,
    quoteFeed1,
    quoteFeed2,
    baseVault,
    quoteVault,
    baseVaultConversionSample,
    quoteVaultConversionSample,
    scaleFactor,
    baseFeed1Info,
    baseFeed2Info,
    quoteFeed1Info,
    quoteFeed2Info,
    baseVaultInfo,
    quoteVaultInfo,
    price,
    priceFloat,
    classification,
  };
}

// ============================================================
// SCALE FACTOR COMPUTATION
// ============================================================

/**
 * Compute the expected SCALE_FACTOR for a MorphoChainlinkOracleV2.
 *
 * Formula:
 *   10^(36 + quoteTokenDec + qf1Dec + qf2Dec - baseTokenDec - bf1Dec - bf2Dec)
 *     * quoteVaultSample / baseVaultSample
 *
 * When a feed is zero address, its decimals = 0.
 * When a vault is zero address, its sample = 1.
 */
export function computeScaleFactor(params: {
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
  baseFeed1Decimals: number;
  baseFeed2Decimals: number;
  quoteFeed1Decimals: number;
  quoteFeed2Decimals: number;
  baseVaultConversionSample: bigint;
  quoteVaultConversionSample: bigint;
}): bigint {
  const exponent =
    36 +
    params.quoteTokenDecimals +
    params.quoteFeed1Decimals +
    params.quoteFeed2Decimals -
    params.baseTokenDecimals -
    params.baseFeed1Decimals -
    params.baseFeed2Decimals;

  const base = 10n ** BigInt(exponent);
  return (base * params.quoteVaultConversionSample) / params.baseVaultConversionSample;
}
