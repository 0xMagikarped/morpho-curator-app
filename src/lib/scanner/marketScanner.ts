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
 * Scan CreateMarket events from Morpho Blue contract in batches.
 * Reports progress via callback for UI updates.
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
  const batchSize = chainConfig.scanner.batchSize;
  const markets: DiscoveredMarket[] = [];

  for (let start = fromBlock; start <= toBlock; start += batchSize) {
    const end = Math.min(start + batchSize - 1, toBlock);

    try {
      const logs = await client.getLogs({
        address: chainConfig.morphoBlue,
        event: createMarketEvent,
        fromBlock: BigInt(start),
        toBlock: BigInt(end),
      });

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
    } catch (err) {
      console.warn(`getLogs failed for blocks ${start}-${end}:`, err);
      // On SEI, historical blocks may be pruned — stop scanning older blocks
    }

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

  // Step 2: Try event scanning for additional markets
  // Scan from deployment block to catch ALL markets (including PYUSD etc.)
  // On pruned RPCs, getLogs for old blocks will fail per-batch but newer blocks succeed.
  try {
    const eventClient = getEventClient(chainId);
    const currentBlock = Number(await eventClient.getBlockNumber());
    const lastScanned = await getLastScannedBlock(chainId);

    // Always scan from deployment block on first run to catch all markets.
    // Subsequent runs resume from last scanned block.
    const fromBlock = lastScanned != null ? lastScanned + 1 : chainConfig.deploymentBlock;

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
