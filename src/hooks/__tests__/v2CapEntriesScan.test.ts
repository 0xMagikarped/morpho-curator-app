/**
 * The cap-entry scan must cover the vault's FULL history without blocking a
 * tab on it.
 *
 * Regression: `fetchVaultCapEntries` scanned deployment → head on every call,
 * uncached. For RockawayX USDC on Pharos that is 1.43M blocks = 143 paginated
 * `getLogs` pages per event, measured at ~57s against the live RPC — and
 * `discoverAllCappedMarkets` ran a second, independent copy of the same scan
 * on the Allocation tab's render-blocking path. The tab shimmered for minutes.
 *
 * A cap set once and never touched again lives at whatever block it was set,
 * so recency is not a valid bound either. These tests pin the two-phase scan:
 * a fast foreground window that paints immediately, and a stepped backfill
 * toward the deployment block whose results persist so later loads are a
 * delta scan.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { readContractSpy, getBlockNumberSpy, scanSpy, deploymentSpy } = vi.hoisted(() => ({
  readContractSpy: vi.fn(),
  getBlockNumberSpy: vi.fn(),
  scanSpy: vi.fn(),
  deploymentSpy: vi.fn(),
}));

vi.mock('../../lib/data/rpcClient', () => ({
  getPublicClient: () => ({
    getBlockNumber: getBlockNumberSpy,
    readContract: readContractSpy,
  }),
  fetchTokenInfo: vi.fn().mockResolvedValue({
    address: '0x0000000000000000000000000000000000000009',
    name: 'Collateral',
    symbol: 'COLL',
    decimals: 18,
  }),
}));

vi.mock('../../lib/data/eventScan', () => ({
  scanContractEvent: scanSpy,
  findDeploymentBlock: deploymentSpy,
}));

import { fetchVaultCapEntries, backfillCapEventHistory } from '../useV2VaultCapEntries';
import { adapterIdData, marketIdData } from '../../lib/v2/adapterCapUtils';

const CHAIN = 1672; // Pharos — defaultScan 200k.
const VAULT = '0xa5fb3eca411926e64c41cd9d200440953a936378' as const;
const ADAPTER = '0xba3b2605b3a7f0c3d3a0f1e5c9d2a6b7c8e9f012' as const;

/** RockawayX USDC on Pharos: head, deployment, and the syzUSD cap block. */
const LATEST = 14_635_500n;
const DEPLOYMENT = 13_207_345n;
/** Cap set 307k blocks before head — below the 200k first-paint window. */
const SYZ_CAP_BLOCK = 14_328_123n;

const PARAMS = {
  loanToken: '0xc879c018db60520f4355c26ed1a6d572cdac1815' as `0x${string}`,
  collateralToken: '0x54df79d800000000000000000000000000008934' as `0x${string}`,
  oracle: '0x0000000000000000000000000000000000000001' as `0x${string}`,
  irm: '0xd5e02889c13230458506cc842347c4e62f8cdf3a' as `0x${string}`,
  lltv: 915_000_000_000_000_000n,
};

const ADAPTER_ID = ('0x' + 'aa'.repeat(32)) as `0x${string}`;
const MARKET_ID = ('0x' + 'bb'.repeat(32)) as `0x${string}`;

const capLog = (id: `0x${string}`, idData: `0x${string}`) => ({ args: { id, idData } });

/** Minimal localStorage so the persisted cursor is exercised, not stubbed out. */
function installLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  return store;
}

/** Every cap read resolves to a non-zero value so entries survive to the output. */
function stubCapReads() {
  readContractSpy.mockImplementation(async () => 1_000n);
}

beforeEach(() => {
  readContractSpy.mockReset();
  getBlockNumberSpy.mockReset().mockResolvedValue(LATEST);
  scanSpy.mockReset().mockResolvedValue([]);
  deploymentSpy.mockReset().mockResolvedValue(DEPLOYMENT);
  installLocalStorage();
  stubCapReads();
});

describe('fetchVaultCapEntries — first paint', () => {
  it('scans only the recent window and reports the coverage as partial', async () => {
    const result = await fetchVaultCapEntries(CHAIN, VAULT);

    // One call per cap-creating event (IncreaseAbsoluteCap / IncreaseRelativeCap).
    expect(scanSpy).toHaveBeenCalledTimes(2);
    for (const call of scanSpy.mock.calls) {
      const [, , , , from, to] = call;
      expect(from).toBe(LATEST - 200_000n);
      expect(to).toBe(LATEST);
    }
    // The honest signal that entries older than the window are unaccounted
    // for — the UI hangs "still scanning" off this rather than claiming the
    // adapter has no markets configured.
    expect(result.isFullHistory).toBe(false);
    expect(result.fromBlock).toBe(LATEST - 200_000n);
    expect(result.marketCaps).toEqual([]);
  });

  it('never walks below the deployment block', async () => {
    deploymentSpy.mockResolvedValue(LATEST - 1_000n);

    const result = await fetchVaultCapEntries(CHAIN, VAULT);

    expect(result.fromBlock).toBe(LATEST - 1_000n);
    expect(result.isFullHistory).toBe(true);
  });

  it('classifies entries found in the window by their idData tag', async () => {
    scanSpy.mockResolvedValue([
      capLog(ADAPTER_ID, adapterIdData(ADAPTER)),
      capLog(MARKET_ID, marketIdData(ADAPTER, PARAMS)),
    ]);

    const result = await fetchVaultCapEntries(CHAIN, VAULT);

    expect(result.adapterCaps.map((a) => a.adapter.toLowerCase())).toEqual([ADAPTER]);
    expect(result.marketCaps).toHaveLength(1);
    expect(result.marketCaps[0].params.lltv).toBe(PARAMS.lltv);
    expect(result.marketCaps[0].absoluteCap).toBe(1_000n);
  });
});

describe('fetchVaultCapEntries — delta scan against the persisted cursor', () => {
  it('rescans only what arrived since the cursor, and keeps the cached entries', async () => {
    scanSpy.mockResolvedValue([capLog(MARKET_ID, marketIdData(ADAPTER, PARAMS))]);
    await fetchVaultCapEntries(CHAIN, VAULT);

    // Head advances; the entry itself is no longer in any scanned range.
    const newer = LATEST + 5_000n;
    getBlockNumberSpy.mockResolvedValue(newer);
    scanSpy.mockClear().mockResolvedValue([]);

    const result = await fetchVaultCapEntries(CHAIN, VAULT);

    for (const call of scanSpy.mock.calls) {
      const [, , , , from, to] = call;
      expect(from).toBe(LATEST + 1n); // strictly the delta
      expect(to).toBe(newer);
    }
    // Cached, so still rendered — a one-page delta scan must not drop history.
    expect(result.marketCaps).toHaveLength(1);
    expect(result.fromBlock).toBe(LATEST - 200_000n);
  });

  it('reuses the cached deployment block instead of re-binary-searching it', async () => {
    await fetchVaultCapEntries(CHAIN, VAULT);
    expect(deploymentSpy).toHaveBeenCalledTimes(1);

    await fetchVaultCapEntries(CHAIN, VAULT);
    expect(deploymentSpy).toHaveBeenCalledTimes(1);
  });
});

describe('backfillCapEventHistory — stepped walk toward deployment', () => {
  it('does nothing without a cursor to resume from', async () => {
    expect(await backfillCapEventHistory(CHAIN, VAULT)).toEqual({ extended: false, done: true });
    expect(scanSpy).not.toHaveBeenCalled();
  });

  it('widens by one bounded step and commits the new floor', async () => {
    await fetchVaultCapEntries(CHAIN, VAULT);
    const firstFloor = LATEST - 200_000n;
    scanSpy.mockClear();

    const step = await backfillCapEventHistory(CHAIN, VAULT);

    expect(step).toEqual({ extended: true, done: false });
    for (const call of scanSpy.mock.calls) {
      const [, , , , from, to] = call;
      expect(from).toBe(firstFloor - 500_000n);
      expect(to).toBe(firstFloor - 1n);
    }
    // Committed: the next foreground fetch reports the widened coverage.
    scanSpy.mockClear().mockResolvedValue([]);
    const after = await fetchVaultCapEntries(CHAIN, VAULT);
    expect(after.fromBlock).toBe(firstFloor - 500_000n);
    expect(after.isFullHistory).toBe(false);
  });

  it('surfaces a cap set below the first-paint window once the step covering it runs', async () => {
    await fetchVaultCapEntries(CHAIN, VAULT);

    // The step that spans SYZ_CAP_BLOCK returns it; every other step is empty.
    scanSpy.mockImplementation(async (...args: unknown[]) => {
      const from = args[4] as bigint;
      const to = args[5] as bigint;
      return from <= SYZ_CAP_BLOCK && SYZ_CAP_BLOCK <= to
        ? [capLog(MARKET_ID, marketIdData(ADAPTER, PARAMS))]
        : [];
    });

    let guard = 0;
    for (;;) {
      const { done } = await backfillCapEventHistory(CHAIN, VAULT);
      if (done || ++guard > 20) break;
    }

    const result = await fetchVaultCapEntries(CHAIN, VAULT);
    expect(result.isFullHistory).toBe(true);
    expect(result.fromBlock).toBe(DEPLOYMENT);
    expect(result.marketCaps).toHaveLength(1);
    expect(result.marketCaps[0].params.collateralToken.toLowerCase()).toBe(PARAMS.collateralToken);
  });

  it('clamps the final step to the deployment block and reports done', async () => {
    await fetchVaultCapEntries(CHAIN, VAULT);
    // Pull the floor to within one step of deployment.
    deploymentSpy.mockResolvedValue(DEPLOYMENT);
    let last: { extended: boolean; done: boolean } = { extended: false, done: false };
    let guard = 0;
    while (!last.done && guard++ < 20) last = await backfillCapEventHistory(CHAIN, VAULT);

    const floors = scanSpy.mock.calls.map((c) => c[4] as bigint);
    expect(floors.every((f) => f >= DEPLOYMENT)).toBe(true);
    expect(last.done).toBe(true);
  });
});
