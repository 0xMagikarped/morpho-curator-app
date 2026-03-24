import {
  parseAbiItem,
  decodeAbiParameters,
  parseAbiParameters,
  keccak256,
  encodeAbiParameters,
  type Address,
} from 'viem';
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
// Block Explorer API Discovery (SEI — seitrace/blockscout)
// ============================================================

/** createMarket(MarketParams) function selector */
const CREATE_MARKET_SELECTOR = '0x8c1358a2';

/** ABI types for decoding createMarket params */
const marketParamsTypes = parseAbiParameters(
  'address loanToken, address collateralToken, address oracle, address irm, uint256 lltv',
);

interface SeitraceTransaction {
  hash: string;
  method: string;
  block: number;
}

interface SeitracePage {
  items: SeitraceTransaction[];
  next_page_params: Record<string, string | number> | null;
}

/**
 * Discover ALL markets on SEI by scanning the block explorer API for
 * createMarket transactions to the Morpho Blue contract.
 *
 * SEI's RPC has a ~2000 block getLogs limit, making event-based scanning
 * useless across 32M+ blocks. The seitrace (blockscout) API provides
 * paginated transaction history without block range limits.
 */
async function discoverMarketsViaSeitrace(
  chainId: number,
  onProgress?: ScanProgressCallback,
): Promise<DiscoveredMarket[]> {
  const chainConfig = getChainConfig(chainId);
  if (!chainConfig) return [];

  const morphoBlue = chainConfig.morphoBlue;
  const baseUrl = `https://seitrace.com/pacific-1/api/v2/addresses/${morphoBlue}/transactions?filter=to`;

  const createMarketTxHashes: string[] = [];
  let nextParams = '';
  const MAX_PAGES = 30; // Safety limit

  // Paginate through all transactions to find createMarket calls
  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const url = baseUrl + nextParams;
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`Seitrace API returned ${resp.status} on page ${page}`);
        break;
      }
      const data: SeitracePage = await resp.json();
      const items = data.items ?? [];

      for (const tx of items) {
        if (tx.method === CREATE_MARKET_SELECTOR) {
          createMarketTxHashes.push(tx.hash);
        }
      }

      onProgress?.({
        fromBlock: 0,
        toBlock: 0,
        currentBlock: 0,
        marketsFound: createMarketTxHashes.length,
        isComplete: false,
      });

      if (!data.next_page_params) break;
      nextParams =
        '&' +
        Object.entries(data.next_page_params)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&');
    } catch (err) {
      console.warn(`Seitrace page ${page} failed:`, err);
      break;
    }
  }

  if (createMarketTxHashes.length === 0) return [];

  // Fetch tx input data and decode market params
  const client = getPublicClient(chainId);
  const markets: DiscoveredMarket[] = [];

  // Process in batches of 5 to avoid overwhelming the RPC
  for (let i = 0; i < createMarketTxHashes.length; i += 5) {
    const batch = createMarketTxHashes.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (txHash) => {
        const tx = await client.getTransaction({ hash: txHash as `0x${string}` });
        if (!tx.input || tx.input.length < 10) return null;

        // Strip 4-byte selector, decode (address, address, address, address, uint256)
        const paramsData = (`0x${tx.input.slice(10)}`) as `0x${string}`;
        const [loanToken, collateralToken, oracle, irm, lltv] =
          decodeAbiParameters(marketParamsTypes, paramsData);

        // Compute market ID = keccak256(abi.encode(params))
        const encoded = encodeAbiParameters(marketParamsTypes, [
          loanToken, collateralToken, oracle, irm, lltv,
        ]);
        const marketId = keccak256(encoded);

        return {
          id: marketId,
          loanToken: loanToken as Address,
          collateralToken: collateralToken as Address,
          oracle: oracle as Address,
          irm: irm as Address,
          lltv,
          discoveredAtBlock: Number(tx.blockNumber),
          chainId,
        } satisfies DiscoveredMarket;
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        markets.push(r.value);
      }
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
// Event Scanner — RPC-based (for chains with full getLogs support)
// ============================================================

function getEventClient(chainId: number) {
  return getPublicClient(chainId);
}

/**
 * Scan a block range for CreateMarket events with adaptive binary-split retry.
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
    const rangeSize = end - start;
    if (rangeSize <= minBatchSize) return [];
    const mid = start + Math.floor(rangeSize / 2);
    const [left, right] = await Promise.all([
      scanRangeWithRetry(client, morphoBlue, chainId, start, mid, minBatchSize),
      scanRangeWithRetry(client, morphoBlue, chainId, mid + 1, end, minBatchSize),
    ]);
    return [...left, ...right];
  }
}

/**
 * Scan CreateMarket events via RPC getLogs.
 * Works on Ethereum/Base but NOT on SEI (2K block limit).
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
  const batchSize = 500_000;
  const minBatchSize = chainConfig.scanner.batchSize;
  const markets: DiscoveredMarket[] = [];

  for (let start = fromBlock; start <= toBlock; start += batchSize) {
    const end = Math.min(start + batchSize - 1, toBlock);
    const batch = await scanRangeWithRetry(
      client, chainConfig.morphoBlue, chainId, start, end, minBatchSize,
    );
    markets.push(...batch);

    onProgress?.({
      fromBlock, toBlock, currentBlock: end,
      marketsFound: markets.length, isComplete: false,
    });
  }

  onProgress?.({
    fromBlock, toBlock, currentBlock: toBlock,
    marketsFound: markets.length, isComplete: true,
  });

  return markets;
}

// ============================================================
// Vault-Based Discovery — reads market IDs from vault queues
// ============================================================

/**
 * Discover markets by reading known vault supply/withdraw queues.
 * Uses eth_call — works on all RPCs including SEI.
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
            discoveredAtBlock: 0,
            chainId,
          });
        } catch (err) {
          console.warn(`Failed to fetch params for market ${marketId}:`, err);
        }
      }
    } catch (err) {
      // Vault may have empty queues or different ABI — skip silently
      console.warn(`Failed to read queues from vault ${vaultAddress}:`, err);
    }
  }

  onProgress?.({
    fromBlock: 0, toBlock: 0, currentBlock: 0,
    marketsFound: markets.length, isComplete: true,
  });

  return markets;
}

// ============================================================
// IDLE Market Detection
// ============================================================

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Detect idle markets (collateral = 0x0, LLTV = 0) for display tagging */
export function isIdleMarketRecord(market: MarketRecord): boolean {
  return (
    market.collateralToken.toLowerCase() === ZERO_ADDRESS &&
    (market.lltv === '0' || market.lltv === '0n')
  );
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
 * Check if a chain uses the block explorer API for market discovery.
 * SEI's RPC has a ~2000 block getLogs limit, making event scanning useless
 * across 32M+ blocks. We use the seitrace API instead.
 */
function usesExplorerApi(chainId: number): boolean {
  return chainId === 1329;
}

/**
 * Run an incremental scan to discover markets on a chain.
 *
 * Strategy per chain:
 * - SEI (1329): seitrace block explorer API + vault queue reads
 * - Ethereum/Base: RPC getLogs events + vault queue reads
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
      chainId, knownVaultAddrs, onProgress,
    );
    allMarkets.push(...vaultMarkets);
  }

  if (usesExplorerApi(chainId)) {
    // Step 2a: SEI — use block explorer API to find ALL createMarket txs
    try {
      const existingIds = new Set(allMarkets.map((m) => m.id));
      const explorerMarkets = await discoverMarketsViaSeitrace(chainId, onProgress);
      for (const m of explorerMarkets) {
        if (!existingIds.has(m.id)) {
          allMarkets.push(m);
          existingIds.add(m.id);
        }
      }
    } catch (err) {
      console.warn('Block explorer market discovery failed:', err);
    }
  } else {
    // Step 2b: Ethereum/Base — use RPC getLogs for CreateMarket events
    try {
      const eventClient = getEventClient(chainId);
      const currentBlock = Number(await eventClient.getBlockNumber());
      const lastScanned = await getLastScannedBlock(chainId);

      const fromBlock = lastScanned != null
        ? lastScanned + 1
        : Math.max(chainConfig.deploymentBlock, currentBlock - 2_000_000);

      if (fromBlock <= currentBlock) {
        const eventMarkets = await scanCreateMarketEvents(
          chainId, fromBlock, currentBlock, onProgress,
        );
        const existingIds = new Set(allMarkets.map((m) => m.id));
        for (const m of eventMarkets) {
          if (!existingIds.has(m.id)) {
            allMarkets.push(m);
          }
        }
        await saveScanProgress(chainId, currentBlock, allMarkets.length);
      }
    } catch (err) {
      console.warn('Event scanning failed:', err);
    }
  }

  // Persist all markets including idle (collateral=0x0, lltv=0)
  const records = toRecords(allMarkets);
  if (records.length > 0) {
    await saveDiscoveredMarkets(records);
    await enrichTokensForMarkets(chainId, records);
  }

  const cachedMarkets = await getMarketsByChain(chainId);
  const client = getPublicClient(chainId);
  const headBlock = Number(await client.getBlockNumber());
  await saveScanProgress(chainId, headBlock, cachedMarkets.length);

  return allMarkets;
}

/**
 * Force a full rescan from scratch.
 */
export async function runFullScan(
  chainId: number,
  onProgress?: ScanProgressCallback,
): Promise<DiscoveredMarket[]> {
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

  const tokenAddrs = new Set<string>();
  for (const m of markets) {
    tokenAddrs.add(m.loanToken.toLowerCase());
    tokenAddrs.add(m.collateralToken.toLowerCase());
  }

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
  return [];
}
