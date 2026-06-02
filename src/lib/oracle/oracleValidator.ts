import { type Address, type PublicClient } from 'viem';
import { getChainConfig } from '../../config/chains';
import { getPublicClient } from '../data/rpcClient';
import { chainlinkFeedAbi } from '../contracts/abis';

// ============================================================
// Constants
// ============================================================

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const MAX_STALENESS_SECONDS = 86400; // 24 hours

// ============================================================
// Types
// ============================================================

export type ValidationStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface ValidationResult {
  id: string;
  name: string;
  status: ValidationStatus;
  message: string;
  details?: string;
}

export interface OracleTestConfig {
  chainId: number;
  baseFeed1: Address;
  baseFeed2: Address;
  quoteFeed1: Address;
  quoteFeed2: Address;
  baseVault: Address;
  quoteVault: Address;
  baseTokenAddress: Address;
  quoteTokenAddress: Address;
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
  /**
   * Power-of-10 conversion samples for the ERC-4626 wrappers. Morpho's
   * MorphoChainlinkOracleV2 documents that each sample should be picked so
   * `vault.convertToAssets(sample)` lands in `[1e18, 1e36]` to minimise
   * precision loss; for a zero-address vault the spec says use 1. The
   * deployer probes the vault on validate and surfaces the result here.
   */
  baseVaultConversionSample: bigint;
  quoteVaultConversionSample: bigint;
  /** CREATE2 salt for deterministic addressing; 0x0…0 is acceptable. */
  salt: `0x${string}`;
}

// ============================================================
// Vault asset ABI (inline)
// ============================================================

const vaultAssetAbi = [
  {
    name: 'asset',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    name: 'convertToAssets',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Probe an ERC-4626 vault for the smallest `10**k` such that
 * `convertToAssets(10**k)` lands in `[1e18, 1e36]` (Morpho's documented
 * range for minimising scale-factor precision loss). Returns `1n` when
 * the vault is the zero address (the Morpho spec sentinel). Returns
 * `null` if probing failed for every k — surfaced as a validation
 * failure rather than silently substituting a bad default.
 */
export async function pickVaultConversionSample(
  client: PublicClient,
  vault: Address,
): Promise<bigint | null> {
  if (vault === ZERO_ADDRESS) return 1n;
  const LOWER = 10n ** 18n;
  const UPPER = 10n ** 36n;
  // Test k from 0 up to 36 — enough headroom for any sensible vault. Stop
  // at the first power that lands in band.
  for (let k = 0; k <= 36; k++) {
    const sample = 10n ** BigInt(k);
    try {
      const out = (await client.readContract({
        address: vault,
        abi: vaultAssetAbi,
        functionName: 'convertToAssets',
        args: [sample],
      })) as bigint;
      if (out >= LOWER && out <= UPPER) return sample;
    } catch {
      // Not a 4626, or RPC failed for this k. Keep trying smaller/larger
      // samples — a one-off revert at k=0 (some vaults guard zero) doesn't
      // disqualify the vault.
      continue;
    }
  }
  return null;
}

// ============================================================
// Helpers
// ============================================================

function isNonZero(addr: Address): boolean {
  return addr !== ZERO_ADDRESS;
}

function getFeedAddresses(config: OracleTestConfig): { label: string; address: Address }[] {
  return [
    { label: 'baseFeed1', address: config.baseFeed1 },
    { label: 'baseFeed2', address: config.baseFeed2 },
    { label: 'quoteFeed1', address: config.quoteFeed1 },
    { label: 'quoteFeed2', address: config.quoteFeed2 },
  ];
}

// ============================================================
// Check 1: Feed Liveness
// ============================================================

async function checkFeedLiveness(
  client: PublicClient,
  config: OracleTestConfig,
): Promise<ValidationResult> {
  const feeds = getFeedAddresses(config).filter((f) => isNonZero(f.address));

  if (feeds.length === 0) {
    return {
      id: 'feed-liveness',
      name: 'Feed Liveness',
      status: 'skip',
      message: 'All feed addresses are zero — no feeds to check.',
    };
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const issues: string[] = [];
  let hasStale = false;
  let hasFatal = false;

  const results = await Promise.allSettled(
    feeds.map(async (feed) => {
      const data = await client.readContract({
        address: feed.address,
        abi: chainlinkFeedAbi,
        functionName: 'latestRoundData',
      });

      const [roundId, answer, , updatedAt, answeredInRound] = data as [
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
      ];

      if (answer <= 0n) {
        hasFatal = true;
        issues.push(`${feed.label}: answer <= 0 (${answer.toString()})`);
        return;
      }

      const age = nowSeconds - updatedAt;
      if (age > BigInt(MAX_STALENESS_SECONDS)) {
        hasStale = true;
        issues.push(
          `${feed.label}: stale by ${(age - BigInt(MAX_STALENESS_SECONDS)).toString()}s beyond 24h threshold`,
        );
      }

      if (answeredInRound < roundId) {
        hasStale = true;
        issues.push(
          `${feed.label}: answeredInRound (${answeredInRound.toString()}) < roundId (${roundId.toString()})`,
        );
      }
    }),
  );

  // Check for reverts
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      hasFatal = true;
      issues.push(`${feeds[i].label}: call reverted — ${String(r.reason)}`);
    }
  }

  if (hasFatal) {
    return {
      id: 'feed-liveness',
      name: 'Feed Liveness',
      status: 'fail',
      message: 'One or more feeds returned invalid data or reverted.',
      details: issues.join('\n'),
    };
  }

  if (hasStale) {
    // Promoted from `warn` to `fail` (H2 audit): deploying an oracle off
    // a stale Chainlink feed gets users liquidated when the feed
    // eventually wakes and snaps to a new price. Curators must
    // explicitly resolve the staleness (different feed, or wait for
    // refresh) — there is no "I acknowledge stale feed" path.
    return {
      id: 'feed-liveness',
      name: 'Feed Liveness',
      status: 'fail',
      message: 'One or more feeds are stale (>24h) or have round mismatches.',
      details: issues.join('\n'),
    };
  }

  return {
    id: 'feed-liveness',
    name: 'Feed Liveness',
    status: 'pass',
    message: `All ${feeds.length} feed(s) are live and fresh.`,
  };
}

// ============================================================
// Check 2: Feed Decimals Consistency
// ============================================================

async function checkDecimalsConsistency(
  client: PublicClient,
  config: OracleTestConfig,
): Promise<ValidationResult> {
  const feeds = getFeedAddresses(config);

  // Read decimals for each non-zero feed, default to 0 for zero-address feeds
  const feedDecimals = await Promise.all(
    feeds.map(async (feed) => {
      if (!isNonZero(feed.address)) return 0;
      try {
        const dec = await client.readContract({
          address: feed.address,
          abi: chainlinkFeedAbi,
          functionName: 'decimals',
        });
        return Number(dec);
      } catch {
        return 0;
      }
    }),
  );

  const [bf1Dec, bf2Dec, qf1Dec, qf2Dec] = feedDecimals;

  // Vault conversion samples are 1 if vault is zero address (no conversion needed)
  // The vault sample ratio doesn't affect the exponent, only the magnitude,
  // so we focus on the exponent for this check.
  const exponent =
    36 +
    config.quoteTokenDecimals +
    qf1Dec +
    qf2Dec -
    config.baseTokenDecimals -
    bf1Dec -
    bf2Dec;

  const details = [
    `Exponent = 36 + ${config.quoteTokenDecimals} + ${qf1Dec} + ${qf2Dec} - ${config.baseTokenDecimals} - ${bf1Dec} - ${bf2Dec} = ${exponent}`,
    `Feed decimals: baseFeed1=${bf1Dec}, baseFeed2=${bf2Dec}, quoteFeed1=${qf1Dec}, quoteFeed2=${qf2Dec}`,
    `Token decimals: base=${config.baseTokenDecimals}, quote=${config.quoteTokenDecimals}`,
  ].join('\n');

  if (exponent < 0) {
    return {
      id: 'decimals-consistency',
      name: 'Feed Decimals Consistency',
      status: 'fail',
      message: `Scale factor exponent is negative (${exponent}). This will cause underflow.`,
      details,
    };
  }

  if (exponent === 0) {
    return {
      id: 'decimals-consistency',
      name: 'Feed Decimals Consistency',
      status: 'warn',
      message: 'Scale factor exponent is exactly 0. Price resolution may be very low.',
      details,
    };
  }

  return {
    id: 'decimals-consistency',
    name: 'Feed Decimals Consistency',
    status: 'pass',
    message: `Scale factor exponent is ${exponent} — decimals are consistent.`,
    details,
  };
}

// ============================================================
// Check 3: Price Sanity
// ============================================================

async function checkPriceSanity(
  client: PublicClient,
  config: OracleTestConfig,
): Promise<ValidationResult> {
  const feeds = getFeedAddresses(config);

  // Read answers from non-zero feeds, default to 1n for zero-address feeds
  const answers = await Promise.all(
    feeds.map(async (feed) => {
      if (!isNonZero(feed.address)) return 1n;
      try {
        const data = await client.readContract({
          address: feed.address,
          abi: chainlinkFeedAbi,
          functionName: 'latestRoundData',
        });
        const [, answer] = data as [bigint, bigint, bigint, bigint, bigint];
        return answer > 0n ? answer : 0n;
      } catch {
        return 0n;
      }
    }),
  );

  const [bf1Answer, bf2Answer, qf1Answer, qf2Answer] = answers;

  // Read feed decimals for scale factor computation
  const feedDecimals = await Promise.all(
    feeds.map(async (feed) => {
      if (!isNonZero(feed.address)) return 0;
      try {
        const dec = await client.readContract({
          address: feed.address,
          abi: chainlinkFeedAbi,
          functionName: 'decimals',
        });
        return Number(dec);
      } catch {
        return 0;
      }
    }),
  );

  const [bf1Dec, bf2Dec, qf1Dec, qf2Dec] = feedDecimals;

  const exponent =
    36 +
    config.quoteTokenDecimals +
    qf1Dec +
    qf2Dec -
    config.baseTokenDecimals -
    bf1Dec -
    bf2Dec;

  // If any active feed returned 0 or exponent is negative, fail
  if (bf1Answer === 0n || bf2Answer === 0n) {
    return {
      id: 'price-sanity',
      name: 'Price Sanity',
      status: 'fail',
      message: 'Base feed answer is zero — cannot compute a valid price.',
      details: `baseFeed1Answer=${bf1Answer}, baseFeed2Answer=${bf2Answer}`,
    };
  }

  if (qf1Answer === 0n || qf2Answer === 0n) {
    return {
      id: 'price-sanity',
      name: 'Price Sanity',
      status: 'fail',
      message: 'Quote feed answer is zero — division by zero in price computation.',
      details: `quoteFeed1Answer=${qf1Answer}, quoteFeed2Answer=${qf2Answer}`,
    };
  }

  // Compute rough price using BigInt arithmetic. The on-chain SCALE_FACTOR
  // is `10^exponent * quoteVaultConversionSample / baseVaultConversionSample`
  // (C4 audit fix — the previous version dropped the sample ratio,
  // silently shifting the sanity-checked price by orders of magnitude
  // whenever a vault was supplied).
  //   price = SCALE_FACTOR * bf1 * bf2 / (qf1 * qf2)
  const expPart = exponent >= 0 ? 10n ** BigInt(exponent) : 1n;
  const scaleFactor =
    (expPart * config.quoteVaultConversionSample) / config.baseVaultConversionSample;
  const numerator = scaleFactor * bf1Answer * bf2Answer;
  const denominator = qf1Answer * qf2Answer;
  const price = numerator / denominator;

  if (price === 0n) {
    return {
      id: 'price-sanity',
      name: 'Price Sanity',
      status: 'fail',
      message: 'Computed price is zero. The oracle configuration is likely incorrect.',
      details: `scaleFactor=10^${exponent}, numerator=${numerator}, denominator=${denominator}`,
    };
  }

  // Heuristic: warn if price is astronomically large (> 10^60) or extremely small
  // These thresholds are rough sanity bounds
  const MAX_REASONABLE = 10n ** 60n;
  const MIN_REASONABLE = 1n; // price in raw 36-decimal form; 1 means essentially zero

  const details = `Computed price (raw 36-dec) = ${price.toString()}\nscaleFactor exponent = ${exponent}`;

  if (price > MAX_REASONABLE) {
    return {
      id: 'price-sanity',
      name: 'Price Sanity',
      status: 'warn',
      message: 'Computed price is extremely large — may indicate misconfiguration.',
      details,
    };
  }

  if (price <= MIN_REASONABLE) {
    return {
      id: 'price-sanity',
      name: 'Price Sanity',
      status: 'warn',
      message: 'Computed price is extremely small — may indicate misconfiguration.',
      details,
    };
  }

  return {
    id: 'price-sanity',
    name: 'Price Sanity',
    status: 'pass',
    message: 'Oracle price is non-zero and within reasonable bounds.',
    details,
  };
}

// ============================================================
// Check 4: Vault Compatibility
// ============================================================

async function checkVaultCompatibility(
  client: PublicClient,
  config: OracleTestConfig,
): Promise<ValidationResult> {
  const vaults = [
    { label: 'baseVault', address: config.baseVault, expectedAsset: config.baseTokenAddress },
    { label: 'quoteVault', address: config.quoteVault, expectedAsset: config.quoteTokenAddress },
  ].filter((v) => isNonZero(v.address));

  if (vaults.length === 0) {
    return {
      id: 'vault-compatibility',
      name: 'Vault Compatibility',
      status: 'skip',
      message: 'Both vault addresses are zero — no vaults to check.',
    };
  }

  const issues: string[] = [];
  let hasMismatch = false;
  let hasUnreadable = false;

  await Promise.all(
    vaults.map(async (vault) => {
      try {
        const asset = await client.readContract({
          address: vault.address,
          abi: vaultAssetAbi,
          functionName: 'asset',
        });

        const assetAddr = (asset as string).toLowerCase();
        const expectedAddr = vault.expectedAsset.toLowerCase();

        if (assetAddr !== expectedAddr) {
          hasMismatch = true;
          issues.push(
            `${vault.label}: asset() returned ${asset}, expected ${vault.expectedAsset}`,
          );
        }
      } catch (err) {
        hasUnreadable = true;
        issues.push(`${vault.label}: could not read asset() — ${String(err)}`);
      }
    }),
  );

  if (hasMismatch) {
    return {
      id: 'vault-compatibility',
      name: 'Vault Compatibility',
      status: 'fail',
      message: 'Vault asset does not match the expected token address.',
      details: issues.join('\n'),
    };
  }

  if (hasUnreadable) {
    return {
      id: 'vault-compatibility',
      name: 'Vault Compatibility',
      status: 'warn',
      message: 'Could not read asset() from one or more vaults.',
      details: issues.join('\n'),
    };
  }

  return {
    id: 'vault-compatibility',
    name: 'Vault Compatibility',
    status: 'pass',
    message: `All ${vaults.length} vault(s) have matching asset addresses.`,
  };
}

// ============================================================
// Check 5: Scale Factor Overflow
// ============================================================

async function checkScaleFactorOverflow(
  client: PublicClient,
  config: OracleTestConfig,
): Promise<ValidationResult> {
  const MAX_UINT256 = 2n ** 256n - 1n;
  const WARN_THRESHOLD = 2n ** 240n; // Warn if scale factor alone exceeds 2^240

  const feeds = getFeedAddresses(config);

  // Read feed decimals
  const feedDecimals = await Promise.all(
    feeds.map(async (feed) => {
      if (!isNonZero(feed.address)) return 0;
      try {
        const dec = await client.readContract({
          address: feed.address,
          abi: chainlinkFeedAbi,
          functionName: 'decimals',
        });
        return Number(dec);
      } catch {
        return 0;
      }
    }),
  );

  const [bf1Dec, bf2Dec, qf1Dec, qf2Dec] = feedDecimals;

  const exponent =
    36 +
    config.quoteTokenDecimals +
    qf1Dec +
    qf2Dec -
    config.baseTokenDecimals -
    bf1Dec -
    bf2Dec;

  // If exponent is negative, scaleFactor is < 1 — no overflow risk from scale
  if (exponent < 0) {
    return {
      id: 'scale-factor-overflow',
      name: 'Scale Factor Overflow',
      status: 'pass',
      message: 'Scale factor exponent is negative — no overflow risk from scale factor.',
      details: `Exponent = ${exponent}`,
    };
  }

  // C4 audit fix: include vault sample ratio. On-chain SCALE_FACTOR is
  //   10^exponent * quoteVaultConversionSample / baseVaultConversionSample
  // Ignoring the sample term silently shifted the overflow gate by up to
  // 10^36 — a vault config that fits in uint256 in the validator would
  // overflow on chain, or vice versa.
  const expPart = 10n ** BigInt(exponent);
  const scaleFactor =
    (expPart * config.quoteVaultConversionSample) / config.baseVaultConversionSample;

  if (scaleFactor > MAX_UINT256) {
    return {
      id: 'scale-factor-overflow',
      name: 'Scale Factor Overflow',
      status: 'fail',
      message: `Scale factor (10^${exponent}) exceeds uint256 max.`,
      details: `10^${exponent} > 2^256 - 1`,
    };
  }

  // Read current feed answers to estimate max product with headroom
  const feedAnswers = await Promise.all(
    feeds.map(async (feed) => {
      if (!isNonZero(feed.address)) return 1n;
      try {
        const data = await client.readContract({
          address: feed.address,
          abi: chainlinkFeedAbi,
          functionName: 'latestRoundData',
        });
        const [, answer] = data as [bigint, bigint, bigint, bigint, bigint];
        return answer > 0n ? answer : 1n;
      } catch {
        return 1n;
      }
    }),
  );

  // Use 100x headroom on each feed answer to simulate worst-case
  const maxBf1 = feedAnswers[0] * 100n;
  const maxBf2 = feedAnswers[1] * 100n;
  const maxProduct = scaleFactor * maxBf1 * maxBf2;

  if (maxProduct > MAX_UINT256) {
    return {
      id: 'scale-factor-overflow',
      name: 'Scale Factor Overflow',
      status: 'fail',
      message: 'Scale factor * max feed answers would overflow uint256.',
      details: `scaleFactor (10^${exponent}) * baseFeed1 (${maxBf1}) * baseFeed2 (${maxBf2}) = ${maxProduct} > 2^256`,
    };
  }

  if (scaleFactor > WARN_THRESHOLD || maxProduct > WARN_THRESHOLD) {
    return {
      id: 'scale-factor-overflow',
      name: 'Scale Factor Overflow',
      status: 'warn',
      message: 'Scale factor or computed product is close to uint256 limits.',
      details: `scaleFactor = 10^${exponent}, maxProduct = ${maxProduct}`,
    };
  }

  return {
    id: 'scale-factor-overflow',
    name: 'Scale Factor Overflow',
    status: 'pass',
    message: 'No overflow risk detected for scale factor or price computation.',
    details: `scaleFactor = 10^${exponent}, maxProduct with 100x headroom = ${maxProduct}`,
  };
}

// ============================================================
// Main Validation Entry Point
// ============================================================

/**
 * Side-channel from the validator: the exact feed decimals the on-chain
 * factory will use when computing SCALE_FACTOR. Hoisted out of the
 * individual checks so the UI's "previewed scale factor" can match
 * reality — the preview was previously hardcoded to `feedDecimals: 0`
 * everywhere, which only matched when all feeds were zero-address.
 *
 * Returns 0 for any feed whose `decimals()` read failed (also surfaced
 * as a `feed-decimals-readable` validation failure so curators can't
 * silently proceed with bad feed metadata).
 */
export interface FeedDecimalsBundle {
  baseFeed1: number;
  baseFeed2: number;
  quoteFeed1: number;
  quoteFeed2: number;
  /** True iff every NON-zero-address feed returned a usable `decimals()`. */
  allReadable: boolean;
}

async function readFeedDecimalsBundle(
  client: PublicClient,
  config: OracleTestConfig,
): Promise<FeedDecimalsBundle> {
  const slots: (keyof FeedDecimalsBundle)[] = ['baseFeed1', 'baseFeed2', 'quoteFeed1', 'quoteFeed2'];
  const addrs: Address[] = [config.baseFeed1, config.baseFeed2, config.quoteFeed1, config.quoteFeed2];
  const out: FeedDecimalsBundle = {
    baseFeed1: 0,
    baseFeed2: 0,
    quoteFeed1: 0,
    quoteFeed2: 0,
    allReadable: true,
  };
  await Promise.all(
    addrs.map(async (addr, i) => {
      if (addr === ZERO_ADDRESS) return; // 0d is correct for absent feed
      try {
        const d = (await client.readContract({
          address: addr,
          abi: chainlinkFeedAbi,
          functionName: 'decimals',
        })) as number;
        out[slots[i]] = Number(d) as never;
      } catch {
        out.allReadable = false;
      }
    }),
  );
  return out;
}

export interface OracleValidationReport {
  results: ValidationResult[];
  feedDecimals: FeedDecimalsBundle;
}

export async function validateOracleConfig(
  config: OracleTestConfig,
): Promise<OracleValidationReport> {
  const chainConfig = getChainConfig(config.chainId);
  if (!chainConfig) {
    return {
      results: [
        {
          id: 'chain-config',
          name: 'Chain Configuration',
          status: 'fail',
          message: `No chain configuration found for chainId ${config.chainId}.`,
        },
      ],
      feedDecimals: { baseFeed1: 0, baseFeed2: 0, quoteFeed1: 0, quoteFeed2: 0, allReadable: false },
    };
  }

  const client = getPublicClient(config.chainId);

  const [liveness, decimals, priceSanity, vaultCompat, overflow, feedDecimals] = await Promise.all([
    checkFeedLiveness(client, config),
    checkDecimalsConsistency(client, config),
    checkPriceSanity(client, config),
    checkVaultCompatibility(client, config),
    checkScaleFactorOverflow(client, config),
    readFeedDecimalsBundle(client, config),
  ]);

  const results: ValidationResult[] = [liveness, decimals, priceSanity, vaultCompat, overflow];
  if (!feedDecimals.allReadable) {
    // Surface as fail rather than letting feed decimals silently default
    // to 0 in the scale-factor math (the previous behaviour).
    results.push({
      id: 'feed-decimals-readable',
      name: 'Feed Decimals Readable',
      status: 'fail',
      message:
        'One or more price feeds did not return a valid decimals() — cannot compute scale factor reliably.',
      details: JSON.stringify(feedDecimals, null, 2),
    });
  }

  return { results, feedDecimals };
}
