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
  priceFloat: number; // human-readable price: 1 collateral ≈ priceFloat loan tokens
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
  // Human-readable price = (base-side floats) / (quote-side floats), where each
  // Chainlink feed contributes answer/10^decimals and each ERC-4626 vault
  // contributes assetsPerShare/conversionSample; a zero-address feed/vault is a
  // factor of 1. This is decimals-correct for ANY loan/collateral pair —
  // unlike `price()/1e36`, which is only right when loan and collateral share
  // the same decimals (Morpho's price() is scaled by 36 + loanDec − collatDec,
  // e.g. 24 for a USDC(6)/WPROS(18) market, so /1e36 under-scales to ~0).
  const feedFloat = (f: DecodedFeed | null): number =>
    f ? Number(f.latestAnswer) / 10 ** f.decimals : 1;
  const vaultFloat = (v: DecodedVault | null): number =>
    v && v.conversionSample > 0n ? Number(v.assetsPerShare) / Number(v.conversionSample) : 1;
  const baseFloat = feedFloat(baseFeed1Info) * feedFloat(baseFeed2Info) * vaultFloat(baseVaultInfo);
  const quoteFloat = feedFloat(quoteFeed1Info) * feedFloat(quoteFeed2Info) * vaultFloat(quoteVaultInfo);
  const priceFloat = quoteFloat > 0 ? baseFloat / quoteFloat : 0;

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

export interface ScaleFactorParams {
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
  baseFeed1Decimals: number;
  baseFeed2Decimals: number;
  quoteFeed1Decimals: number;
  quoteFeed2Decimals: number;
  baseVaultConversionSample: bigint;
  quoteVaultConversionSample: bigint;
}

export interface ScaleFactorResult {
  /** Decimals exponent `36 + qDecs - bDecs`. Negative = invalid config. */
  exponent: number;
  /**
   * Computed scale factor (≥ 1 when exponent ≥ 0). Set to 0n when the
   * exponent is negative — Morpho's on-chain `10**(uint256 exponent)` will
   * revert (underflow on the unsigned subtraction), and we'd otherwise
   * throw `RangeError: Exponent must be non-negative` inside the JS BigInt
   * power op. The validator surfaces the negative-exponent case as a hard
   * fail; consumers should check `valid` before trusting `scaleFactor`.
   */
  scaleFactor: bigint;
  valid: boolean;
}

/**
 * Compute the expected SCALE_FACTOR for a MorphoChainlinkOracleV2.
 *
 * Formula (matches `MorphoChainlinkOracleV2.SCALE_FACTOR`):
 *   10^(36 + quoteTokenDec + qf1Dec + qf2Dec - baseTokenDec - bf1Dec - bf2Dec)
 *     * quoteVaultSample / baseVaultSample
 *
 * Zero-address feed → decimals = 0. Zero-address vault → sample = 1.
 *
 * Negative-exponent configs are NOT valid Morpho oracles (the contract's
 * unchecked uint256 math would underflow). We return `{ valid: false,
 * scaleFactor: 0n }` instead of throwing so callers can surface a clean
 * "configuration invalid" error to the user.
 */
export function computeScaleFactor(params: ScaleFactorParams): ScaleFactorResult {
  const exponent =
    36 +
    params.quoteTokenDecimals +
    params.quoteFeed1Decimals +
    params.quoteFeed2Decimals -
    params.baseTokenDecimals -
    params.baseFeed1Decimals -
    params.baseFeed2Decimals;

  if (exponent < 0) {
    return { exponent, scaleFactor: 0n, valid: false };
  }

  const base = 10n ** BigInt(exponent);
  const scaleFactor =
    (base * params.quoteVaultConversionSample) / params.baseVaultConversionSample;
  return { exponent, scaleFactor, valid: true };
}
