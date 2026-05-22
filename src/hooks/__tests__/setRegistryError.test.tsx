/**
 * PR 6 — Set Registry flow surfaces simulate/wallet errors.
 *
 * On `main`, useSetRegistry/useAbdicateRegistry destructure only the wagmi
 * write `error` — `simulateError` (PR 2's fail-closed preflight) and
 * `walletError` are dropped, so the page banner stays empty and the button
 * "does nothing". This suite asserts both are folded into the returned
 * `error`. On `main` the wrapper hooks ignore them → tests fail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Hoisted mutable holder so each test can set the mocked hook's return value.
const { guarded } = vi.hoisted(() => ({
  guarded: { current: {} as Record<string, unknown> },
}));

vi.mock('../useGuardedWriteContract', () => ({
  useGuardedWriteContract: () => guarded.current,
}));
vi.mock('wagmi', () => ({
  useWaitForTransactionReceipt: () => ({ isLoading: false, isSuccess: false }),
}));

import { useSetRegistry, useAbdicateRegistry } from '../useSetRegistryAndAbdicate';

const VAULT = '0x0000000000000000000000000000000000000001' as const;
const CHAIN = 1;

/** Baseline: a guarded-write hook with nothing wrong. */
function baseGuarded(): Record<string, unknown> {
  return {
    writeContract: vi.fn(),
    writeContractAsync: vi.fn(),
    data: undefined,
    isPending: false,
    isSimulating: false,
    error: null,
    simulateError: null,
    walletError: null,
    reset: vi.fn(),
  };
}

beforeEach(() => {
  guarded.current = baseGuarded();
});

describe('useSetRegistry / useAbdicateRegistry — error surfacing (PR 6)', () => {
  it('surfaces a decoded simulateError in the returned error', () => {
    guarded.current.simulateError = {
      errorName: 'Timelocked',
      args: null,
      shortMessage: 'function is timelocked',
      message: 'Timelocked',
      raw: null,
    };
    const { result } = renderHook(() => useSetRegistry(VAULT, CHAIN));
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toContain('Timelocked');
  });

  it('surfaces walletError when the wallet is not connected', () => {
    guarded.current.walletError = 'Please connect your wallet first';
    const { result } = renderHook(() => useSetRegistry(VAULT, CHAIN));
    expect(result.current.error?.message).toBe('Please connect your wallet first');
  });

  it('still surfaces a plain wagmi write error (no regression)', () => {
    guarded.current.error = new Error('user rejected request');
    const { result } = renderHook(() => useSetRegistry(VAULT, CHAIN));
    expect(result.current.error?.message).toBe('user rejected request');
  });

  it('returns null error when nothing failed', () => {
    const { result } = renderHook(() => useSetRegistry(VAULT, CHAIN));
    expect(result.current.error).toBeNull();
  });

  it('useAbdicateRegistry also surfaces a decoded simulateError', () => {
    guarded.current.simulateError = {
      errorName: 'AlreadyAbdicated',
      args: null,
      shortMessage: 'already abdicated',
      message: 'AlreadyAbdicated',
      raw: null,
    };
    const { result } = renderHook(() => useAbdicateRegistry(VAULT, CHAIN));
    expect(result.current.error?.message).toContain('AlreadyAbdicated');
  });

  it('passes isSimulating through both wrapper hooks', () => {
    guarded.current.isSimulating = true;
    const set = renderHook(() => useSetRegistry(VAULT, CHAIN));
    const abd = renderHook(() => useAbdicateRegistry(VAULT, CHAIN));
    expect(set.result.current.isSimulating).toBe(true);
    expect(abd.result.current.isSimulating).toBe(true);
  });
});
