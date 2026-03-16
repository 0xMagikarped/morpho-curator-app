import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { Address } from 'viem';

// ============================================================
// Schema
// ============================================================

interface MarketRecord {
  chainId: number;
  marketId: `0x${string}`;
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: string; // BigInt serialized
  discoveredAtBlock: number;
  loanTokenSymbol?: string;
  loanTokenDecimals?: number;
  collateralTokenSymbol?: string;
  collateralTokenDecimals?: number;
}

interface MarketStateRecord {
  chainId: number;
  marketId: `0x${string}`;
  totalSupplyAssets: string;
  totalBorrowAssets: string;
  utilization: number;
  supplyApy: number;
  borrowApy: number;
  oraclePrice: string;
  lastUpdate: number;
  fee: number;
  fetchedAt: number;
}

interface ScannerStateRecord {
  chainId: number;
  lastScannedBlock: number;
  totalMarketsFound: number;
  lastScanTimestamp: number;
}

interface TokenRecord {
  chainId: number;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
}

interface MorphoCuratorDB extends DBSchema {
  markets: {
    key: string;
    value: MarketRecord;
    indexes: {
      'by-chain': number;
      'by-loan-token': string;
      'by-collateral': string;
    };
  };
  marketStates: {
    key: string;
    value: MarketStateRecord;
  };
  scannerState: {
    key: number;
    value: ScannerStateRecord;
  };
  tokens: {
    key: string;
    value: TokenRecord;
  };
}

// ============================================================
// DB Singleton
// ============================================================

let dbPromise: Promise<IDBPDatabase<MorphoCuratorDB>> | null = null;

export function openMarketDB(): Promise<IDBPDatabase<MorphoCuratorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MorphoCuratorDB>('morpho-curator', 1, {
      upgrade(db) {
        // Markets store
        const marketStore = db.createObjectStore('markets', { keyPath: undefined });
        marketStore.createIndex('by-chain', 'chainId');
        marketStore.createIndex('by-loan-token', 'loanToken');
        marketStore.createIndex('by-collateral', 'collateralToken');

        // Market states store
        db.createObjectStore('marketStates');

        // Scanner state store
        db.createObjectStore('scannerState', { keyPath: 'chainId' });

        // Token cache store
        db.createObjectStore('tokens');
      },
    });
  }
  return dbPromise;
}

function marketKey(chainId: number, marketId: `0x${string}`): string {
  return `${chainId}:${marketId}`;
}

function tokenKey(chainId: number, address: Address): string {
  return `${chainId}:${address.toLowerCase()}`;
}

// ============================================================
// Market CRUD
// ============================================================

export async function saveDiscoveredMarkets(markets: MarketRecord[]): Promise<void> {
  const db = await openMarketDB();
  const tx = db.transaction('markets', 'readwrite');
  for (const m of markets) {
    const key = marketKey(m.chainId, m.marketId);
    await tx.store.put(m, key);
  }
  await tx.done;
}

export async function getMarketsByChain(
  chainId: number,
  loanToken?: Address,
): Promise<MarketRecord[]> {
  const db = await openMarketDB();
  const all = await db.getAllFromIndex('markets', 'by-chain', chainId);
  if (loanToken) {
    const lower = loanToken.toLowerCase();
    return all.filter((m) => m.loanToken.toLowerCase() === lower);
  }
  return all;
}

export async function getMarketRecord(
  chainId: number,
  marketId: `0x${string}`,
): Promise<MarketRecord | undefined> {
  const db = await openMarketDB();
  return db.get('markets', marketKey(chainId, marketId));
}

export async function enrichMarketTokens(
  chainId: number,
  marketId: `0x${string}`,
  data: {
    loanTokenSymbol: string;
    loanTokenDecimals: number;
    collateralTokenSymbol: string;
    collateralTokenDecimals: number;
  },
): Promise<void> {
  const db = await openMarketDB();
  const key = marketKey(chainId, marketId);
  const existing = await db.get('markets', key);
  if (existing) {
    await db.put('markets', { ...existing, ...data }, key);
  }
}

// ============================================================
// Scanner State
// ============================================================

export async function getLastScannedBlock(chainId: number): Promise<number | null> {
  const db = await openMarketDB();
  const state = await db.get('scannerState', chainId);
  return state?.lastScannedBlock ?? null;
}

export async function saveScanProgress(
  chainId: number,
  lastScannedBlock: number,
  totalMarketsFound: number,
): Promise<void> {
  const db = await openMarketDB();
  await db.put('scannerState', {
    chainId,
    lastScannedBlock,
    totalMarketsFound,
    lastScanTimestamp: Date.now(),
  });
}

export async function getScannerState(chainId: number): Promise<ScannerStateRecord | undefined> {
  const db = await openMarketDB();
  return db.get('scannerState', chainId);
}

export async function resetScanProgress(chainId: number): Promise<void> {
  const db = await openMarketDB();
  await db.delete('scannerState', chainId);
}

// ============================================================
// Market State Cache
// ============================================================

export async function saveMarketStateRecord(
  chainId: number,
  marketId: `0x${string}`,
  state: Omit<MarketStateRecord, 'chainId' | 'marketId'>,
): Promise<void> {
  const db = await openMarketDB();
  await db.put(
    'marketStates',
    { chainId, marketId, ...state },
    marketKey(chainId, marketId),
  );
}

export async function getCachedMarketState(
  chainId: number,
  marketId: `0x${string}`,
  maxAgeMs: number,
): Promise<MarketStateRecord | null> {
  const db = await openMarketDB();
  const record = await db.get('marketStates', marketKey(chainId, marketId));
  if (!record) return null;
  if (Date.now() - record.fetchedAt > maxAgeMs) return null;
  return record;
}

// ============================================================
// Token Cache
// ============================================================

export async function getCachedToken(
  chainId: number,
  address: Address,
): Promise<TokenRecord | undefined> {
  const db = await openMarketDB();
  return db.get('tokens', tokenKey(chainId, address));
}

export async function saveToken(token: TokenRecord): Promise<void> {
  const db = await openMarketDB();
  await db.put('tokens', token, tokenKey(token.chainId, token.address));
}

// ============================================================
// Clear Cache
// ============================================================

export async function clearAllMarketData(): Promise<void> {
  const db = await openMarketDB();
  const tx = db.transaction(
    ['markets', 'marketStates', 'scannerState', 'tokens'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('markets').clear(),
    tx.objectStore('marketStates').clear(),
    tx.objectStore('scannerState').clear(),
    tx.objectStore('tokens').clear(),
    tx.done,
  ]);
}

export async function clearChainData(chainId: number): Promise<void> {
  const db = await openMarketDB();

  // Clear scanner state
  await db.delete('scannerState', chainId);

  // Clear markets for this chain
  const markets = await db.getAllFromIndex('markets', 'by-chain', chainId);
  const tx = db.transaction(['markets', 'marketStates'], 'readwrite');
  for (const m of markets) {
    const key = marketKey(m.chainId, m.marketId);
    await tx.objectStore('markets').delete(key);
    await tx.objectStore('marketStates').delete(key);
  }
  await tx.done;
}

export type { MarketRecord, MarketStateRecord, ScannerStateRecord, TokenRecord };
