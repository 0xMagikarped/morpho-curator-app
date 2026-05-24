/**
 * PR 20 — `useBatchSetCaps` submit→wait→execute behaviour pin.
 *
 * The wizard's caps step calls `useBatchSetCaps.execute(actions)`. On
 * `main` it called `vault.multicall([target1, target2, …])` directly,
 * which reverts `DataNotTimelocked` because each inner cap mutator
 * self-checks `executableAt`. PR 20 fixes this with two Safe txs:
 *
 *   tx 1: vault.multicall([submit(cd1), submit(cd2), …])
 *   tx 2: vault.multicall([cd1, cd2, …])
 *
 * This test runs the hook against mocked wagmi + publicClient and pins
 * the call sequence on three paths: fresh 0-timelock, non-zero timelock
 * (waiting), and resume.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { writeContractAsync, readContractMock, waitForTxMock } = vi.hoisted(() => ({
  writeContractAsync: vi.fn(),
  readContractMock: vi.fn(),
  waitForTxMock: vi.fn().mockResolvedValue({ logs: [] }),
}));

vi.mock('wagmi', () => ({
  usePublicClient: () => ({
    readContract: readContractMock,
    waitForTransactionReceipt: waitForTxMock,
  }),
}));

vi.mock('../useGuardedWriteContract', () => ({
  useGuardedWriteContract: () => ({ writeContractAsync, data: undefined }),
}));

import { useBatchSetCaps, type CapAction } from '../useSetCaps';

const VAULT = '0x3F4ed284A5Be70C34a28743AEE62d28A6a581a2f' as const;
const CHAIN = 50;
const ID_DATA_A = '0xaa' as `0x${string}`;
const ID_DATA_B = '0xbb' as `0x${string}`;
const CAP = 100_000_000n;
const REL_WAD = 10n ** 18n;

const INCREASE_ACTIONS: CapAction[] = [
  { label: 'abs', functionName: 'increaseAbsoluteCap', idData: ID_DATA_A, cap: CAP },
  { label: 'rel', functionName: 'increaseRelativeCap', idData: ID_DATA_B, cap: REL_WAD },
];

/**
 * Inspect the writeContractAsync call list by what it was *for*.
 *   - submit multicall: functionName='multicall' AND args[0] is an array of
 *     calldatas whose first 4 bytes are the `submit(bytes)` selector.
 *   - execute multicall: functionName='multicall' AND args[0] entries start
 *     with a cap-mutator selector.
 *   - direct submit: functionName='submit'.
 *   - direct execute: functionName in {increase…Cap, decrease…Cap}.
 */
const SUBMIT_SELECTOR = '0xef7fa71b'; // submit(bytes) — verified via viem toFunctionSelector
function countSubmits() {
  return writeContractAsync.mock.calls.filter((call: unknown[]) => {
    const args = call[0] as { functionName: string; args: unknown[] };
    if (args.functionName === 'submit') return true;
    if (args.functionName === 'multicall') {
      const inner = args.args[0] as `0x${string}`[];
      return Array.isArray(inner) && inner.every((cd) => cd.slice(0, 10) === SUBMIT_SELECTOR);
    }
    return false;
  }).length;
}
function countExecutes() {
  return writeContractAsync.mock.calls.filter((call: unknown[]) => {
    const args = call[0] as { functionName: string; args: unknown[] };
    if (args.functionName.startsWith('increase') || args.functionName.startsWith('decrease')) return true;
    if (args.functionName === 'multicall') {
      const inner = args.args[0] as `0x${string}`[];
      return Array.isArray(inner) && !inner.every((cd) => cd.slice(0, 10) === SUBMIT_SELECTOR);
    }
    return false;
  }).length;
}

beforeEach(() => {
  writeContractAsync.mockReset();
  writeContractAsync.mockResolvedValue('0xhash');
  readContractMock.mockReset();
  waitForTxMock.mockClear();
});

describe('useBatchSetCaps — submit→wait→execute timelock flow (PR 20)', () => {
  it('0-timelock vault: submit multicall then execute multicall → done', async () => {
    // Pre-submit reads: both executableAt = 0 → needsSubmit
    // Post-submit reads: both executableAt = 1 (elapsed)
    readContractMock
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(1n)
      .mockResolvedValueOnce(1n);

    const { result } = renderHook(() => useBatchSetCaps(VAULT, CHAIN));
    await act(async () => {
      await result.current.execute(INCREASE_ACTIONS);
    });

    expect(countSubmits()).toBe(1);
    expect(countExecutes()).toBe(1);
    expect(result.current.step).toBe('done');
    expect(result.current.executableAt).toBe(null);
  });

  it('non-zero-timelock vault: stops at waiting-timelock after submit', async () => {
    const FUTURE = BigInt(Math.floor(Date.now() / 1000)) + 86_400n;
    readContractMock
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(FUTURE)
      .mockResolvedValueOnce(FUTURE);

    const { result } = renderHook(() => useBatchSetCaps(VAULT, CHAIN));
    await act(async () => {
      await result.current.execute(INCREASE_ACTIONS);
    });

    expect(countSubmits()).toBe(1);
    expect(countExecutes()).toBe(0);
    expect(result.current.step).toBe('waiting-timelock');
    expect(result.current.executableAt).toBe(FUTURE);
  });

  it('resume case: existing elapsed executableAt → skip submit, only execute', async () => {
    readContractMock.mockResolvedValueOnce(1n).mockResolvedValueOnce(1n);

    const { result } = renderHook(() => useBatchSetCaps(VAULT, CHAIN));
    await act(async () => {
      await result.current.execute(INCREASE_ACTIONS);
    });

    expect(countSubmits()).toBe(0);
    expect(countExecutes()).toBe(1);
    expect(result.current.step).toBe('done');
  });

  it('empty action list is a no-op', async () => {
    const { result } = renderHook(() => useBatchSetCaps(VAULT, CHAIN));
    await act(async () => {
      await result.current.execute([]);
    });
    expect(writeContractAsync).not.toHaveBeenCalled();
    expect(result.current.step).toBe('idle');
  });
});
