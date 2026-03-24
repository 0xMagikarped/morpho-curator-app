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
  raw_input: string;
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

  // Collect createMarket tx input data directly from the seitrace list response.
  // SEI public RPCs prune historical transactions, so eth_getTransactionByHash
  // returns null for older txs. The seitrace API includes raw_input in the list.
  const createMarketTxs: { raw_input: string; block: number }[] = [];
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
        if (tx.method === CREATE_MARKET_SELECTOR && tx.raw_input) {
          createMarketTxs.push({ raw_input: tx.raw_input, block: tx.block });
        }
      }

      onProgress?.({
        fromBlock: 0,
        toBlock: 0,
        currentBlock: 0,
        marketsFound: createMarketTxs.length,
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

  if (createMarketTxs.length === 0) return [];

  // Decode market params directly from seitrace raw_input (no RPC needed)
  const markets: DiscoveredMarket[] = [];

  for (const txData of createMarketTxs) {
    try {
      const input = txData.raw_input;
      if (input.length < 10) continue;

      // Strip 4-byte selector, decode (address, address, address, address, uint256)
      const paramsData = (`0x${input.slice(10)}`) as `0x${string}`;
      const [loanToken, collateralToken, oracle, irm, lltv] =
        decodeAbiParameters(marketParamsTypes, paramsData);

      // Compute market ID = keccak256(abi.encode(params))
      const encoded = encodeAbiParameters(marketParamsTypes, [
        loanToken, collateralToken, oracle, irm, lltv,
      ]);
      const marketId = keccak256(encoded);

      markets.push({
        id: marketId,
        loanToken: loanToken as Address,
        collateralToken: collateralToken as Address,
        oracle: oracle as Address,
        irm: irm as Address,
        lltv,
        discoveredAtBlock: txData.block,
        chainId,
      });
    } catch (err) {
      console.warn('Failed to decode createMarket tx:', err);
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
 * Hardcoded seed markets for SEI.
 * SEI public RPCs prune historical transactions, and seitrace pagination
 * can be unreliable. These seeds ensure known markets are always present.
 */
function getSeiSeedMarkets(): DiscoveredMarket[] {
  const chainId = 1329;
  const PYUSD0 = '0x142cdc44890978B506e745bB3Bd11607B7f7faEf' as Address;
  const IRM = '0x6eFA8e3Aa8279eB2fd46b6083A9E52dA72EA56c4' as Address;
  const ZERO = '0x0000000000000000000000000000000000000000' as Address;

  return [
    // PYUSD0 / wETH (LLTV 86%)
    {
      id: '0x7d754479f40d06180fa1ee66ce1bf0cd97fc156c8f8458e27a18a95b9d1ad46a',
      loanToken: PYUSD0,
      collateralToken: '0x160345fC359604fC6e70E3c5fAcbdE5F7A9342d8' as Address,
      oracle: '0xdca3f61f8c9a960fb0ef7b0a9b9c30bc735ce856' as Address,
      irm: IRM,
      lltv: 860000000000000000n,
      discoveredAtBlock: 197913946,
      chainId,
    },
    // PYUSD0 / wBTC (LLTV 86%)
    {
      id: '0xd2fa0b94b6f04615c9472bb25bcb755f5ad5a8f4c17fc04837a31046f0ba5c60',
      loanToken: PYUSD0,
      collateralToken: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c' as Address,
      oracle: '0x83bd34b6e835694953c323a0f0f5267f3708b727' as Address,
      irm: IRM,
      lltv: 860000000000000000n,
      discoveredAtBlock: 197917426,
      chainId,
    },
    // PYUSD0 / sfrxUSD (LLTV 91.5%)
    {
      id: '0xc56578519e8fb30628d3b8d459193017e776ce8477c0bbf0f2c8de82bd8dccc9',
      loanToken: PYUSD0,
      collateralToken: '0x5bff88ca1442c2496f7e475e9e7786383bc070c0' as Address,
      oracle: '0x6bd03632861bfef2c0a718216b23ede9a5c3b913' as Address,
      irm: IRM,
      lltv: 915000000000000000n,
      discoveredAtBlock: 197920846,
      chainId,
    },
    // PYUSD0 / IDLE (collateral=0x0, lltv=0)
    {
      id: '0xe3c959829d236e3838558318340129a737ae0fffa128d891d1d22728d081e419',
      loanToken: PYUSD0,
      collateralToken: ZERO,
      oracle: ZERO,
      irm: ZERO,
      lltv: 0n,
      discoveredAtBlock: 197922132,
      chainId,
    },
    // PYUSD0 / wsrUSD (LLTV 91.5%)
    {
      id: '0xbb3ef4b802087585438dc6ee178e295f404d133996880db5e23405d1d73f1d27',
      loanToken: PYUSD0,
      collateralToken: '0x4809010926aec940b550D34a46A52739f996D75D' as Address,
      oracle: '0xC2100520D7c5260735125A0DCC0Bd6095902cDA2' as Address,
      irm: IRM,
      lltv: 915000000000000000n,
      discoveredAtBlock: 197929589,
      chainId,
    },
    // PYUSD0 / USDY (LLTV 91.5%)
    {
      id: '0x583da8629bb612169bb4d5753d94d66bffa4390b4f16833a210b75944172f811',
      loanToken: PYUSD0,
      collateralToken: '0x54cd901491aef397084453f4372b93c33260e2a6' as Address,
      oracle: '0xd0884f4638FCc0F7DbA6C78B2ea6493876933a7B' as Address,
      irm: IRM,
      lltv: 915000000000000000n,
      discoveredAtBlock: 198336036,
      chainId,
    },
  ];
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

  // Step 0: Inject hardcoded seed markets (always present, avoids RPC/API fragility)
  if (chainId === 1329) {
    const seeds = getSeiSeedMarkets();
    allMarkets.push(...seeds);
  }

  // Step 1: Vault-based discovery (reliable, works on all RPCs)
  const knownVaultAddrs = getKnownVaultAddresses(chainId);
  if (knownVaultAddrs.length > 0) {
    const existingSeedIds = new Set(allMarkets.map((m) => m.id));
    const vaultMarkets = await discoverMarketsFromVaults(
      chainId, knownVaultAddrs, onProgress,
    );
    for (const m of vaultMarkets) {
      if (!existingSeedIds.has(m.id)) {
        allMarkets.push(m);
        existingSeedIds.add(m.id);
      }
    }
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
