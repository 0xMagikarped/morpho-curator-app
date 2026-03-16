import { parseAbiItem, type Address } from 'viem';
import { getPublicClient } from '../data/rpcClient';
import { getChainConfig, SEI_KNOWN_VAULTS } from '../../config/chains';
import { morphoBlueAbi, metaMorphoV1Abi, erc20Abi } from '../contracts/abis';
import {
  saveDiscoveredMarkets,
  getLastScannedBlock,
  saveScanProgress,
  resetScanProgress,
  getMarketsByChain,
  enrichMarketTokens,
  getCachedToken,
  saveToken,
  type MarketRecord,
  type TokenRecord,
} from '../indexer/indexedDB';

// ============================================================
// Types
// ============================================================

export interface DiscoveredMarket {
  id: `0x${string}`;
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
  discoveredAtBlock: number;
  chainId: number;
}

export interface ScanProgress {
  fromBlock: number;
  toBlock: number;
  currentBlock: number;
  marketsFound: number;
  isComplete: boolean;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

const createMarketEvent = parseAbiItem(
  'event CreateMarket(bytes32 indexed id, (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)',
);

// Supply event — indexed by market ID. Any market with recent supply activity
// will emit this, letting us discover markets whose CreateMarket event was pruned.
const supplyEvent = parseAbiItem(
  'event Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)',
);

// Borrow event — same logic, catches markets that only have borrow activity
const borrowEvent = parseAbiItem(
  'event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)',
);

// ============================================================
// Event Scanner — RPC-based
// ============================================================

/**
 * Get a client suitable for getLogs calls.
 * Uses the same client as eth_call — publicnode supports both on SEI.
 */
function getEventClient(chainId: number) {
  return getPublicClient(chainId);
}

/**
 * Scan a single block range for CreateMarket events with adaptive retry.
 * On failure, halves the range and retries sub-ranges.
 * This handles pruned RPCs where some block ranges fail but sub-ranges may succeed.
 */
async function scanRangeWithRetry(
  client: ReturnType<typeof getEventClient>,
  morphoBlue: Address,
  chainId: number,
  start: number,
  end: number,
  minBatchSize: number,
): Promise<DiscoveredMarket[]> {
  try {
    const logs = await client.getLogs({
      address: morphoBlue,
      event: createMarketEvent,
      fromBlock: BigInt(start),
      toBlock: BigInt(end),
    });

    const markets: DiscoveredMarket[] = [];
    for (const log of logs) {
      if (!log.args.id || !log.args.marketParams) continue;
      markets.push({
        id: log.args.id,
        loanToken: log.args.marketParams.loanToken as Address,
        collateralToken: log.args.marketParams.collateralToken as Address,
        oracle: log.args.marketParams.oracle as Address,
        irm: log.args.marketParams.irm as Address,
        lltv: log.args.marketParams.lltv,
        discoveredAtBlock: Number(log.blockNumber),
        chainId,
      });
    }
    return markets;
  } catch {
    // If range is already at minimum, this range is pruned — skip it
    const rangeSize = end - start;
    if (rangeSize <= minBatchSize) {
      return [];
    }
    // Split in half and try each sub-range
    const mid = start + Math.floor(rangeSize / 2);
    const [left, right] = await Promise.all([
      scanRangeWithRetry(client, morphoBlue, chainId, start, mid, minBatchSize),
      scanRangeWithRetry(client, morphoBlue, chainId, mid + 1, end, minBatchSize),
    ]);
    return [...left, ...right];
  }
}

/**
 * Scan CreateMarket events from Morpho Blue contract.
 * Uses large initial batch sizes (getLogs is not gas-limited) with adaptive
 * retry: on failure, halves the range to find working sub-ranges.
 * This handles SEI's pruned RPC where some block ranges fail.
 */
export async function scanCreateMarketEvents(
  chainId: number,
  fromBlock: number,
  toBlock: number,
  onProgress?: ScanProgressCallback,
): Promise<DiscoveredMarket[]> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unsupported chain: ${chainId}`);

  const client = getEventClient(chainId);
  // Use large batches — getLogs is a read query, not gas-limited.
  // 500K blocks per batch covers ~2.3 days on SEI (400ms blocks).
  const batchSize = 500_000;
  const minBatchSize = chainConfig.scanner.batchSize; // Smallest retry unit
  const markets: DiscoveredMarket[] = [];

  for (let start = fromBlock; start <= toBlock; start += batchSize) {
    const end = Math.min(start + batchSize - 1, toBlock);

    const batch = await scanRangeWithRetry(
      client, chainConfig.morphoBlue, chainId, start, end, minBatchSize,
    );
    markets.push(...batch);

    onProgress?.({
      fromBlock,
      toBlock,
      currentBlock: end,
      marketsFound: markets.length,
      isComplete: false,
    });
  }

  onProgress?.({
    fromBlock,
    toBlock,
    currentBlock: toBlock,
    marketsFound: markets.length,
    isComplete: true,
  });

  return markets;
}

// ============================================================
// Vault-Based Discovery — Fallback for chains with pruned logs
// ============================================================

/**
 * Discover markets by reading known vault supply/withdraw queues.
 * This works even when historical event logs are unavailable.
 * Uses eth_call (works on publicnode, drpc).
 */
export async function discoverMarketsFromVaults(
  chainId: number,
  vaultAddresses: Address[],
  onProgress?: ScanProgressCallback,
): Promise<DiscoveredMarket[]> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unsupported chain: ${chainId}`);

  const client = getPublicClient(chainId);
  const marketIdSet = new Set<string>();
  const markets: DiscoveredMarket[] = [];

  for (const vaultAddress of vaultAddresses) {
    try {
      // Read supply and withdraw queue lengths
      const [supplyLen, withdrawLen] = await Promise.all([
        client.readContract({
          address: vaultAddress,
          abi: metaMorphoV1Abi,
          functionName: 'supplyQueueLength',
        }),
        client.readContract({
          address: vaultAddress,
          abi: metaMorphoV1Abi,
          functionName: 'withdrawQueueLength',
        }),
      ]);

      // Read all market IDs from both queues
      const allPromises: Promise<`0x${string}`>[] = [];
      for (let i = 0; i < Number(supplyLen); i++) {
        allPromises.push(
          client.readContract({
            address: vaultAddress,
            abi: metaMorphoV1Abi,
            functionName: 'supplyQueue',
            args: [BigInt(i)],
          }) as Promise<`0x${string}`>,
        );
      }
      for (let i = 0; i < Number(withdrawLen); i++) {
        allPromises.push(
          client.readContract({
            address: vaultAddress,
            abi: metaMorphoV1Abi,
            functionName: 'withdrawQueue',
            args: [BigInt(i)],
          }) as Promise<`0x${string}`>,
        );
      }

      const marketIds = await Promise.all(allPromises);

      // Deduplicate and fetch params
      for (const marketId of marketIds) {
        if (marketIdSet.has(marketId)) continue;
        marketIdSet.add(marketId);

        try {
          const params = await client.readContract({
            address: chainConfig.morphoBlue,
            abi: morphoBlueAbi,
            functionName: 'idToMarketParams',
            args: [marketId],
          });

          markets.push({
            id: marketId,
            loanToken: params.loanToken as Address,
            collateralToken: params.collateralToken as Address,
            oracle: params.oracle as Address,
            irm: params.irm as Address,
            lltv: params.lltv as bigint,
            discoveredAtBlock: 0, // Unknown — discovered via vault queue
            chainId,
          });
        } catch (err) {
          console.warn(`Failed to fetch params for market ${marketId}:`, err);
        }
      }
    } catch (err) {
      console.warn(`Failed to read queues from vault ${vaultAddress}:`, err);
    }
  }

  onProgress?.({
    fromBlock: 0,
    toBlock: 0,
    currentBlock: 0,
    marketsFound: markets.length,
    isComplete: true,
  });

  return markets;
}

// ============================================================
// Activity-Based Discovery — catches markets with pruned CreateMarket events
// ============================================================

/**
 * Scan a single event type across a block range for unique market IDs.
 * Uses a single large getLogs call; on failure falls back to 2 halves.
 */
async function collectMarketIdsFromEvent(
  client: ReturnType<typeof getEventClient>,
  morphoBlue: Address,
  event: typeof supplyEvent | typeof borrowEvent,
  fromBlock: number,
  toBlock: number,
): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const logs = await client.getLogs({
      address: morphoBlue,
      event,
      fromBlock: BigInt(fromBlock),
      toBlock: BigInt(toBlock),
    });
    for (const log of logs) {
      if (log.args.id) ids.add(log.args.id);
    }
  } catch {
    // Split in half if range is large enough
    const range = toBlock - fromBlock;
    if (range > 50_000) {
      const mid = fromBlock + Math.floor(range / 2);
      const [left, right] = await Promise.all([
        collectMarketIdsFromEvent(client, morphoBlue, event, fromBlock, mid),
        collectMarketIdsFromEvent(client, morphoBlue, event, mid + 1, toBlock),
      ]);
      for (const id of left) ids.add(id);
      for (const id of right) ids.add(id);
    }
    // If range <= 50K and fails, it's pruned — skip
  }
  return ids;
}

/**
 * Discover markets by scanning Supply and Borrow events on recent blocks.
 * This catches markets whose CreateMarket event is in pruned block ranges.
 * Uses parallel scanning with adaptive splitting for speed.
 */
async function discoverMarketsFromActivity(
  chainId: number,
  recentBlocks: number,
  existingIds: Set<string>,
): Promise<DiscoveredMarket[]> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) return [];

  const client = getEventClient(chainId);
  const currentBlock = Number(await client.getBlockNumber());
  const fromBlock = Math.max(chainConfig.deploymentBlock, currentBlock - recentBlocks);

  // Scan Supply + Borrow events in parallel for unique market IDs
  const [supplyIds, borrowIds] = await Promise.all([
    collectMarketIdsFromEvent(client, chainConfig.morphoBlue, supplyEvent, fromBlock, currentBlock),
    collectMarketIdsFromEvent(client, chainConfig.morphoBlue, borrowEvent, fromBlock, currentBlock),
  ]);

  // Merge and filter out already-known
  const allIds = new Set([...supplyIds, ...borrowIds]);
  const newIds = [...allIds].filter((id) => !existingIds.has(id));
  if (newIds.length === 0) return [];

  // Fetch params for new market IDs in parallel
  const readClient = getPublicClient(chainId);
  const results = await Promise.allSettled(
    newIds.map(async (marketId) => {
      const params = await readClient.readContract({
        address: chainConfig.morphoBlue,
        abi: morphoBlueAbi,
        functionName: 'idToMarketParams',
        args: [marketId as `0x${string}`],
      });
      return {
        id: marketId as `0x${string}`,
        loanToken: params.loanToken as Address,
        collateralToken: params.collateralToken as Address,
        oracle: params.oracle as Address,
        irm: params.irm as Address,
        lltv: params.lltv as bigint,
        discoveredAtBlock: 0,
        chainId,
      } satisfies DiscoveredMarket;
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<DiscoveredMarket> => r.status === 'fulfilled')
    .map((r) => r.value);
}

// ============================================================
// Unified Discovery
// ============================================================

function toRecords(markets: DiscoveredMarket[]): MarketRecord[] {
  return markets.map((m) => ({
    chainId: m.chainId,
    marketId: m.id,
    loanToken: m.loanToken,
    collateralToken: m.collateralToken,
    oracle: m.oracle,
    irm: m.irm,
    lltv: m.lltv.toString(),
    discoveredAtBlock: m.discoveredAtBlock,
  }));
}

/**
 * Run an incremental scan: event logs + vault-based discovery.
 * For SEI: reads market IDs from known vault queues (always works),
 * then tries recent event logs for any newly created markets.
 */
export async function runIncrementalScan(
  chainId: number,
  onProgress?: ScanProgressCallback,
): Promise<DiscoveredMarket[]> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) throw new Error(`Unsupported chain: ${chainId}`);

  const allMarkets: DiscoveredMarket[] = [];

  // Step 1: Vault-based discovery (reliable, works on all RPCs)
  const knownVaultAddrs = getKnownVaultAddresses(chainId);
  if (knownVaultAddrs.length > 0) {
    const vaultMarkets = await discoverMarketsFromVaults(
      chainId,
      knownVaultAddrs,
      onProgress,
    );
    allMarkets.push(...vaultMarkets);
  }

  // Step 2: Try event scanning for additional markets via CreateMarket events
  // On first load, scan last 2M blocks for speed (~9 days on SEI).
  // On subsequent loads, resume from last scanned block.
  // Full scan from deployment block only happens via explicit Rescan button.
  try {
    const eventClient = getEventClient(chainId);
    const currentBlock = Number(await eventClient.getBlockNumber());
    const lastScanned = await getLastScannedBlock(chainId);

    const fromBlock = lastScanned != null
      ? lastScanned + 1
      : Math.max(chainConfig.deploymentBlock, currentBlock - 2_000_000);

    if (fromBlock <= currentBlock) {
      const eventMarkets = await scanCreateMarketEvents(
        chainId,
        fromBlock,
        currentBlock,
        onProgress,
      );
      // Add any markets not already found via vaults
      const existingIds = new Set(allMarkets.map((m) => m.id));
      for (const m of eventMarkets) {
        if (!existingIds.has(m.id)) {
          allMarkets.push(m);
        }
      }
      await saveScanProgress(chainId, currentBlock, allMarkets.length);
    }
  } catch (err) {
    console.warn('Event scanning failed (may be expected on pruned RPCs):', err);
  }

  // Step 3: Activity-based discovery (Supply/Borrow events on recent blocks)
  // Catches markets whose CreateMarket event is in pruned block ranges.
  // Scan last 500K blocks (~2.3 days on SEI) — fast, covers active markets.
  try {
    const existingIds = new Set(allMarkets.map((m) => m.id));
    const activityMarkets = await discoverMarketsFromActivity(
      chainId,
      500_000,
      existingIds,
    );
    allMarkets.push(...activityMarkets);
  } catch (err) {
    console.warn('Activity-based market discovery failed:', err);
  }

  // Persist
  const records = toRecords(allMarkets);
  if (records.length > 0) {
    await saveDiscoveredMarkets(records);
    // Enrich token symbols in the background
    await enrichTokensForMarkets(chainId, records);
  }

  const cachedMarkets = await getMarketsByChain(chainId);
  const client = getPublicClient(chainId);
  const headBlock = Number(await client.getBlockNumber());
  await saveScanProgress(chainId, headBlock, cachedMarkets.length);

  return allMarkets;
}

/**
 * Force a full rescan from deployment block.
 * Resets the last-scanned-block so the incremental scan starts over.
 */
export async function runFullScan(
  chainId: number,
  onProgress?: ScanProgressCallback,
): Promise<DiscoveredMarket[]> {
  // Delete scan state so incremental scan starts from deployment block
  await resetScanProgress(chainId);
  return runIncrementalScan(chainId, onProgress);
}

/**
 * Enrich market records with token symbols after discovery.
 */
async function enrichTokensForMarkets(
  chainId: number,
  markets: MarketRecord[],
): Promise<void> {
  const client = getPublicClient(chainId);

  // Collect unique token addresses
  const tokenAddrs = new Set<string>();
  for (const m of markets) {
    tokenAddrs.add(m.loanToken.toLowerCase());
    tokenAddrs.add(m.collateralToken.toLowerCase());
  }

  // Fetch and cache each token
  const tokenMap = new Map<string, TokenRecord>();
  for (const addr of tokenAddrs) {
    const cached = await getCachedToken(chainId, addr as Address);
    if (cached) {
      tokenMap.set(addr, cached);
      continue;
    }

    if (addr === '0x0000000000000000000000000000000000000000') {
      const record: TokenRecord = { chainId, address: addr as Address, symbol: 'NONE', name: 'No Collateral', decimals: 18 };
      await saveToken(record);
      tokenMap.set(addr, record);
      continue;
    }

    try {
      const [name, symbol, decimals] = await Promise.all([
        client.readContract({ address: addr as Address, abi: erc20Abi, functionName: 'name' }),
        client.readContract({ address: addr as Address, abi: erc20Abi, functionName: 'symbol' }),
        client.readContract({ address: addr as Address, abi: erc20Abi, functionName: 'decimals' }),
      ]);
      const record: TokenRecord = { chainId, address: addr as Address, symbol, name, decimals };
      await saveToken(record);
      tokenMap.set(addr, record);
    } catch {
      const record: TokenRecord = { chainId, address: addr as Address, symbol: `${addr.slice(0, 8)}...`, name: 'Unknown', decimals: 18 };
      await saveToken(record);
      tokenMap.set(addr, record);
    }
  }

  // Enrich each market record
  for (const m of markets) {
    const loan = tokenMap.get(m.loanToken.toLowerCase());
    const collateral = tokenMap.get(m.collateralToken.toLowerCase());
    if (loan && collateral) {
      await enrichMarketTokens(chainId, m.marketId, {
        loanTokenSymbol: loan.symbol,
        loanTokenDecimals: loan.decimals,
        collateralTokenSymbol: collateral.symbol,
        collateralTokenDecimals: collateral.decimals,
      });
    }
  }
}

/**
 * Get known vault addresses for a chain.
 */
function getKnownVaultAddresses(chainId: number): Address[] {
  if (chainId === 1329) {
    return Object.values(SEI_KNOWN_VAULTS).map((v) => v.address as Address);
  }
  // For other chains, the user's tracked vaults could also be used
  return [];
}
