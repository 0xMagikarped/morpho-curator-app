import type { Address } from 'viem';
import { getPublicClient } from './rpcClient';
import { getChainConfig } from '../../config/chains';
import { morphoBlueAbi, oracleAbi, erc20Abi } from '../contracts/abis';
import { calcUtilization } from '../utils/format';
import {
  getCachedToken,
  saveToken,
  enrichMarketTokens,
  saveMarketStateRecord,
  type MarketRecord,
  type TokenRecord,
} from '../indexer/indexedDB';

// ============================================================
// Types
// ============================================================

export interface EnrichedMarketState {
  marketId: `0x${string}`;
  chainId: number;
  totalSupplyAssets: bigint;
  totalBorrowAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowShares: bigint;
  utilization: number;
  oraclePrice: bigint | null; // null if oracle reverted
  lastUpdate: number;
  fee: bigint;
  loanToken: TokenRecord;
  collateralToken: TokenRecord;
}

// ============================================================
// Token Metadata (cached in IndexedDB)
// ============================================================

async function fetchAndCacheToken(
  chainId: number,
  address: Address,
): Promise<TokenRecord> {
  // Check cache first
  const cached = await getCachedToken(chainId, address);
  if (cached) return cached;

  const client = getPublicClient(chainId);

  // Handle zero address (idle market with no collateral)
  if (address === '0x0000000000000000000000000000000000000000') {
    const record: TokenRecord = {
      chainId,
      address,
      symbol: 'NONE',
      name: 'No Collateral',
      decimals: 18,
    };
    await saveToken(record);
    return record;
  }

  try {
    const [name, symbol, decimals] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: 'name' }),
      client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
      client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
    ]);

    const record: TokenRecord = { chainId, address, symbol, name, decimals };
    await saveToken(record);
    return record;
  } catch {
    // Some tokens may not have name() — use fallback
    const record: TokenRecord = {
      chainId,
      address,
      symbol: `${address.slice(0, 6)}...`,
      name: 'Unknown Token',
      decimals: 18,
    };
    await saveToken(record);
    return record;
  }
}

// ============================================================
// Market State Enrichment
// ============================================================

/**
 * Fetch full enriched state for a single market.
 * Fetches on-chain state + oracle price + token metadata.
 * Oracle price() failures are handled gracefully (returns null).
 */
export async function fetchEnrichedMarketState(
  chainId: number,
  market: MarketRecord,
): Promise<EnrichedMarketState> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unsupported chain: ${chainId}`);

  const client = getPublicClient(chainId);

  // Fetch market state from Morpho Blue
  const stateResult = await client.readContract({
    address: chainConfig.morphoBlue,
    abi: morphoBlueAbi,
    functionName: 'market',
    args: [market.marketId],
  });

  const totalSupplyAssets = stateResult[0];
  const totalSupplyShares = stateResult[1];
  const totalBorrowAssets = stateResult[2];
  const totalBorrowShares = stateResult[3];
  const lastUpdate = stateResult[4];
  const fee = stateResult[5];

  // Fetch oracle price — may revert on pull-based oracles
  let oraclePrice: bigint | null = null;
  if (market.oracle !== '0x0000000000000000000000000000000000000000') {
    try {
      oraclePrice = await client.readContract({
        address: market.oracle as Address,
        abi: oracleAbi,
        functionName: 'price',
      });
    } catch {
      // Oracle reverted — stale pull-based oracle or invalid address
    }
  }

  // Fetch token metadata (cached)
  const [loanToken, collateralToken] = await Promise.all([
    fetchAndCacheToken(chainId, market.loanToken),
    fetchAndCacheToken(chainId, market.collateralToken),
  ]);

  // Enrich the IndexedDB market record with token metadata if needed
  if (!market.loanTokenSymbol || !market.collateralTokenSymbol) {
    await enrichMarketTokens(chainId, market.marketId, {
      loanTokenSymbol: loanToken.symbol,
      loanTokenDecimals: loanToken.decimals,
      collateralTokenSymbol: collateralToken.symbol,
      collateralTokenDecimals: collateralToken.decimals,
    });
  }

  const utilization = calcUtilization(totalBorrowAssets, totalSupplyAssets);

  // Cache the state in IndexedDB
  await saveMarketStateRecord(chainId, market.marketId, {
    totalSupplyAssets: totalSupplyAssets.toString(),
    totalBorrowAssets: totalBorrowAssets.toString(),
    utilization,
    supplyApy: 0, // TODO: compute from IRM
    borrowApy: 0,
    oraclePrice: oraclePrice?.toString() ?? '0',
    lastUpdate: Number(lastUpdate),
    fee: Number(fee),
    fetchedAt: Date.now(),
  });

  return {
    marketId: market.marketId,
    chainId,
    totalSupplyAssets,
    totalBorrowAssets,
    totalSupplyShares,
    totalBorrowShares,
    utilization,
    oraclePrice,
    lastUpdate: Number(lastUpdate),
    fee,
    loanToken,
    collateralToken,
  };
}

/**
 * Batch-fetch enriched states for multiple markets.
 * Groups into batches to avoid overwhelming the RPC.
 */
export async function fetchEnrichedMarketStates(
  chainId: number,
  markets: MarketRecord[],
  batchSize = 5,
): Promise<EnrichedMarketState[]> {
  const results: EnrichedMarketState[] = [];

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((m) => fetchEnrichedMarketState(chainId, m)),
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }
  }

  return results;
}
