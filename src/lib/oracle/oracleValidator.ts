import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { getChainConfig } from '../../config/chains';
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
] as const;

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
    return {
      id: 'feed-liveness',
      name: 'Feed Liveness',
      status: 'warn',
      message: 'One or more feeds are stale or have round mismatches.',
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

  // Compute rough price using BigInt arithmetic
  // price = 10^exponent * bf1Answer * bf2Answer / (qf1Answer * qf2Answer)
  const scaleFactor = exponent >= 0 ? 10n ** BigInt(exponent) : 1n;
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

  const scaleFactor = 10n ** BigInt(exponent);

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

export async function validateOracleConfig(
  config: OracleTestConfig,
): Promise<ValidationResult[]> {
  const chainConfig = getChainConfig(config.chainId);
  if (!chainConfig) {
    return [
      {
        id: 'chain-config',
        name: 'Chain Configuration',
        status: 'fail',
        message: `No chain configuration found for chainId ${config.chainId}.`,
      },
    ];
  }

  const client = createPublicClient({
    transport: http(chainConfig.rpcUrls[0]),
  });

  const [liveness, decimals, priceSanity, vaultCompat, overflow] = await Promise.all([
    checkFeedLiveness(client, config),
    checkDecimalsConsistency(client, config),
    checkPriceSanity(client, config),
    checkVaultCompatibility(client, config),
    checkScaleFactorOverflow(client, config),
  ]);

  return [liveness, decimals, priceSanity, vaultCompat, overflow];
}
