import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { SharePriceRecord } from './riskTypes';

// ============================================================
// Schema
// ============================================================

interface RiskDBSchema extends DBSchema {
  sharePriceHistory: {
    key: string;
    value: SharePriceRecord;
    indexes: {
      'by-vault-chain': [string, number];
    };
  };
  trackedVaults: {
    key: string;
    value: Record<string, unknown>;
    indexes: {
      'by-chain': number;
    };
  };
}

// ============================================================
// DB Singleton
// ============================================================

let riskDbPromise: Promise<IDBPDatabase<RiskDBSchema>> | null = null;

export function openRiskDB(): Promise<IDBPDatabase<RiskDBSchema>> {
  if (!riskDbPromise) {
    riskDbPromise = openDB<RiskDBSchema>('morpho-curator-risk', 1, {
      upgrade(db) {
        const spStore = db.createObjectStore('sharePriceHistory');
        spStore.createIndex('by-vault-chain', ['vaultAddress', 'chainId']);

        const tvStore = db.createObjectStore('trackedVaults');
        tvStore.createIndex('by-chain', 'chainId');
      },
    });
  }
  return riskDbPromise;
}

// ============================================================
// Share Price History
// ============================================================

const MAX_HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
let lastPruneTime = 0;

export async function saveSharePriceRecord(record: SharePriceRecord): Promise<void> {
  const db = await openRiskDB();
  const key = `${record.vaultAddress}-${record.chainId}-${record.timestamp}`;
  await db.put('sharePriceHistory', record, key);

  // Prune old records at most once per hour
  const now = Date.now();
  if (now - lastPruneTime > 60 * 60 * 1000) {
    lastPruneTime = now;
    pruneOldRecords().catch((err) => {
      console.error('[riskDB] Failed to prune old records:', err);
    });
  }
}

async function pruneOldRecords(): Promise<void> {
  const db = await openRiskDB();
  const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
  const tx = db.transaction('sharePriceHistory', 'readwrite');
  const store = tx.objectStore('sharePriceHistory');
  let cursor = await store.openCursor();
  while (cursor) {
    if (cursor.value.timestamp < cutoff) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getLatestSharePrice(
  vaultAddress: `0x${string}`,
  chainId: number,
  afterTimestamp?: number,
): Promise<SharePriceRecord | null> {
  const db = await openRiskDB();
  const all = await db.getAllFromIndex(
    'sharePriceHistory',
    'by-vault-chain',
    [vaultAddress, chainId],
  );
  if (all.length === 0) return null;

  // Filter by timestamp if provided
  const filtered = afterTimestamp
    ? all.filter((r) => r.timestamp >= afterTimestamp)
    : all;

  if (filtered.length === 0) return null;

  // Return the earliest one after the timestamp (for 24h comparison)
  filtered.sort((a, b) => a.timestamp - b.timestamp);
  return filtered[0];
}

export async function getSharePriceHistory(
  vaultAddress: `0x${string}`,
  chainId: number,
  limit = 100,
): Promise<SharePriceRecord[]> {
  const db = await openRiskDB();
  const all = await db.getAllFromIndex(
    'sharePriceHistory',
    'by-vault-chain',
    [vaultAddress, chainId],
  );
  all.sort((a, b) => b.timestamp - a.timestamp);
  return all.slice(0, limit);
}

