/**
 * The V2 timelock queue must cover the vault's FULL history.
 *
 * Regression: `fetchPendingActions` bounded its `Submit` scan to
 * `latest - defaultScan` (200k blocks on Pharos ≈ 2 days at ~0.9s blocks).
 * RockawayX USDC on Pharos had five live entries submitted at blocks 8.67M
 * and 10.75M against a head of 14.16M — every one of them below the floor —
 * so the Timelock Queue rendered "Empty" while the vault sat on a queued
 * `setCurator` and four cap increases.
 *
 * A queued action never expires, so recency is not a valid bound. These tests
 * pin the two-phase scan: a fast foreground window that paints immediately,
 * and a one-shot backfill down to the deployment block whose results persist
 * so later loads are a delta scan.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { readContractSpy, getBlockNumberSpy, scanSpy, deploymentSpy } = vi.hoisted(() => ({
  readContractSpy: vi.fn(),
  getBlockNumberSpy: vi.fn(),
  scanSpy: vi.fn(),
  deploymentSpy: vi.fn(),
}));

vi.mock('../../data/rpcClient', () => ({
  getPublicClient: () => ({
    getBlockNumber: getBlockNumberSpy,
    readContract: readContractSpy,
  }),
  fetchTokenInfo: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../data/eventScan', () => ({
  scanContractEvent: scanSpy,
  findDeploymentBlock: deploymentSpy,
}));

import { fetchPendingActions, backfillSubmitHistory } from '../useV2PendingActions';

const CHAIN = 1672; // Pharos — defaultScan 200k.
const VAULT = '0x047cd0a91e9b92ed979189a6c8a120bf280f02e5' as const;

const LATEST = 14_162_000n;
const DEPLOYMENT = 8_405_011n;
/** Real live entry: `setCurator(...)`, submitted 5.49M blocks before head. */
const OLD_SUBMIT_BLOCK = 8_671_147n;
const OLD_CALLDATA =
  ('0xe90956cf' + '000000000000000000000000' + '22d4dbfff37c7d7a0c7afb9427a51de6f90a676a') as `0x${string}`;

const submitLog = (data: `0x${string}`, selector: string, blockNumber: bigint) => ({
  args: { selector: selector as `0x${string}`, data },
  blockNumber,
});

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

beforeEach(() => {
  readContractSpy.mockReset();
  getBlockNumberSpy.mockReset().mockResolvedValue(LATEST);
  scanSpy.mockReset().mockResolvedValue([]);
  deploymentSpy.mockReset().mockResolvedValue(DEPLOYMENT);
  installLocalStorage();
});

describe('fetchPendingActions — first paint', () => {
  it('scans the recent window and reports the coverage as partial', async () => {
    const result = await fetchPendingActions(CHAIN, VAULT, 6, 'USDC');

    expect(scanSpy).toHaveBeenCalledTimes(1);
    const [, , , , from, to] = scanSpy.mock.calls[0];
    expect(from).toBe(LATEST - 200_000n);
    expect(to).toBe(LATEST);
    // The honest signal that the deep entries are not accounted for yet —
    // the UI hangs its "Scanning…" state off this rather than claiming Empty.
    expect(result.isFullHistory).toBe(false);
    expect(result.actions).toEqual([]);
  });
});

describe('backfillSubmitHistory — deployment → window', () => {
  it('recovers a submit 5.5M blocks deep that the window missed', async () => {
    await fetchPendingActions(CHAIN, VAULT, 6, 'USDC');

    scanSpy.mockResolvedValueOnce([submitLog(OLD_CALLDATA, '0xe90956cf', OLD_SUBMIT_BLOCK)]);
    const { extended } = await backfillSubmitHistory(CHAIN, VAULT);
    expect(extended).toBe(true);

    // Scanned exactly the gap below the foreground window, from deployment.
    const [, , , , from, to] = scanSpy.mock.calls[1];
    expect(from).toBe(DEPLOYMENT);
    expect(to).toBe(LATEST - 200_000n - 1n);

    // Re-running the foreground query now surfaces the recovered entry, and
    // the coverage claim widens to the vault's full history.
    readContractSpy.mockResolvedValue(1_780_045_797n);
    scanSpy.mockResolvedValueOnce([]);
    const result = await fetchPendingActions(CHAIN, VAULT, 6, 'USDC');

    expect(result.isFullHistory).toBe(true);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      data: OLD_CALLDATA,
      functionName: 'setCurator',
      label: 'Set curator',
      executableAt: 1_780_045_797n,
    });
  });

  it('is a no-op once coverage already reaches deployment', async () => {
    deploymentSpy.mockResolvedValue(LATEST - 100n); // vault deployed inside the window
    await fetchPendingActions(CHAIN, VAULT, 6, 'USDC');
    scanSpy.mockClear();

    expect(await backfillSubmitHistory(CHAIN, VAULT)).toEqual({ extended: false });
    expect(scanSpy).not.toHaveBeenCalled();
  });
});

describe('fetchPendingActions — persisted cursor', () => {
  it('re-scans only the delta on a later load', async () => {
    await fetchPendingActions(CHAIN, VAULT, 6, 'USDC');
    scanSpy.mockClear();

    getBlockNumberSpy.mockResolvedValue(LATEST + 500n);
    await fetchPendingActions(CHAIN, VAULT, 6, 'USDC');

    const [, , , , from, to] = scanSpy.mock.calls[0];
    expect(from).toBe(LATEST + 1n); // resumes at the cached cursor, not the window floor
    expect(to).toBe(LATEST + 500n);
  });

  it('drops settled entries so the cursor tracks the live queue', async () => {
    scanSpy.mockResolvedValueOnce([submitLog(OLD_CALLDATA, '0xe90956cf', LATEST - 10n)]);
    readContractSpy.mockResolvedValue(0n); // executed or revoked
    const first = await fetchPendingActions(CHAIN, VAULT, 6, 'USDC');
    expect(first.actions).toEqual([]);

    // Second pass must not re-read it — it is no longer in the cursor.
    readContractSpy.mockClear();
    scanSpy.mockResolvedValueOnce([]);
    await fetchPendingActions(CHAIN, VAULT, 6, 'USDC');
    expect(readContractSpy).not.toHaveBeenCalled();
  });
});
