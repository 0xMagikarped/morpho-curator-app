import { createPublicClient, http, getAddress, type Address } from 'viem';
import { getChainConfig } from '../../config/chains';
import { oracleIntrospectionAbi } from '../contracts/abis';
import type { OracleInfo, OracleType, OracleFeedInfo } from './oracleTypes';

// ============================================================
// Known oracle bytecode signatures
// ============================================================

const CHAINLINK_AGGREGATOR_SELECTOR = '0x50d25bcd'; // latestAnswer()
const CHAINLINK_ROUND_SELECTOR = '0xfeaf968c';     // latestRoundData()
const PYTH_GET_PRICE_SELECTOR = '0x5f338e26';      // getPrice(bytes32)

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

// ============================================================
// Classify a single oracle address
// ============================================================

export async function classifyOracle(
  chainId: number,
  oracleAddress: Address,
): Promise<OracleInfo> {
  if (oracleAddress === ZERO_ADDRESS) {
    return {
      address: oracleAddress,
      chainId,
      type: 'none',
      model: 'none',
      label: 'No Oracle',
      isMorphoWrapper: false,
    };
  }

  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) {
    return makeUnknown(chainId, oracleAddress);
  }

  const client = createPublicClient({
    transport: http(chainConfig.rpcUrls[0]),
  });

  try {
    // Try introspection-based classification first (most accurate)
    const introspectionResult = await classifyByIntrospection(client, oracleAddress);
    if (introspectionResult) {
      return {
        address: oracleAddress,
        chainId,
        type: introspectionResult.type,
        model: 'push',
        label: introspectionResult.label,
        underlyingFeeds: introspectionResult.feeds,
        feedInfo: introspectionResult.feedInfo,
        isMorphoWrapper: true,
      };
    }

    // Check bytecode for known patterns
    const code = await client.getCode({ address: oracleAddress });
    if (!code || code === '0x') {
      return makeUnknown(chainId, oracleAddress);
    }

    // Try Chainlink aggregator interface
    const hasLatestRoundData = code.includes(CHAINLINK_ROUND_SELECTOR.slice(2));
    const hasLatestAnswer = code.includes(CHAINLINK_AGGREGATOR_SELECTOR.slice(2));
    if (hasLatestRoundData || hasLatestAnswer) {
      const isDS = chainConfig.oracleProviders.includes('chainlink-data-streams');
      const type: OracleType = isDS ? 'chainlink-data-streams' : 'chainlink-push';
      return {
        address: oracleAddress,
        chainId,
        type,
        model: isDS ? 'pull' : 'push',
        label: isDS ? 'Chainlink Data Streams' : 'Chainlink Aggregator',
        isMorphoWrapper: false,
      };
    }

    // Try Pyth interface
    if (code.includes(PYTH_GET_PRICE_SELECTOR.slice(2))) {
      return {
        address: oracleAddress,
        chainId,
        type: 'pyth',
        model: 'pull',
        label: 'Pyth Network',
        isMorphoWrapper: false,
      };
    }

    // If chain supports RedStone and no other oracle matched,
    // classify as RedStone (they may use non-standard interfaces)
    if (chainConfig.oracleProviders.includes('redstone')) {
      return {
        address: oracleAddress,
        chainId,
        type: 'redstone',
        model: 'pull',
        label: 'RedStone (inferred)',
        isMorphoWrapper: false,
      };
    }

    return makeUnknown(chainId, oracleAddress);
  } catch {
    return makeUnknown(chainId, oracleAddress);
  }
}

// ============================================================
// Helpers
// ============================================================

function makeUnknown(chainId: number, address: Address): OracleInfo {
  return {
    address,
    chainId,
    type: 'custom',
    model: 'push',
    label: 'Custom Oracle',
    isMorphoWrapper: false,
  };
}

async function classifyByIntrospection(
  client: ReturnType<typeof createPublicClient>,
  oracleAddress: Address,
): Promise<{ type: OracleType; label: string; feeds: Address[]; feedInfo: OracleFeedInfo } | null> {
  try {
    const ZERO = '0x0000000000000000000000000000000000000000' as Address;
    const read = (fn: string) =>
      client.readContract({
        address: oracleAddress,
        abi: oracleIntrospectionAbi,
        functionName: fn as any,
      }).catch(() => null);

    const [baseFeed1, baseFeed2, quoteFeed1, quoteFeed2, baseVault, quoteVault, scaleFactor] =
      await Promise.all([
        read('BASE_FEED_1'), read('BASE_FEED_2'),
        read('QUOTE_FEED_1'), read('QUOTE_FEED_2'),
        read('BASE_VAULT'), read('QUOTE_VAULT'),
        read('SCALE_FACTOR'),
      ]);

    if (baseFeed1 === null) return null;

    const feedInfo: OracleFeedInfo = {
      baseFeed1: baseFeed1 as Address | null,
      baseFeed2: baseFeed2 as Address | null,
      quoteFeed1: quoteFeed1 as Address | null,
      quoteFeed2: quoteFeed2 as Address | null,
      baseVault: baseVault as Address | null,
      quoteVault: quoteVault as Address | null,
      scaleFactor: scaleFactor as bigint | null,
    };

    const feeds: Address[] = [];
    for (const f of [baseFeed1, baseFeed2, quoteFeed1, quoteFeed2] as (Address | null)[]) {
      if (f && f !== ZERO) feeds.push(getAddress(f));
    }

    const hasChainlink = feeds.length > 0;
    const hasVault = [baseVault, quoteVault].some(v => v && v !== ZERO);

    let type: OracleType;
    let label: string;
    if (hasVault && hasChainlink) {
      type = 'chainlink-erc4626-hybrid';
      label = 'Chainlink + ERC-4626 Hybrid';
    } else if (hasVault) {
      type = 'erc4626-exchange-rate';
      label = 'ERC-4626 Exchange Rate';
    } else if (hasChainlink) {
      type = 'chainlink-v2';
      label = 'MorphoChainlinkOracleV2';
    } else {
      type = 'morpho-oracle-unknown';
      label = 'Morpho Oracle (unknown feeds)';
    }

    return { type, label, feeds, feedInfo };
  } catch {
    return null;
  }
}
