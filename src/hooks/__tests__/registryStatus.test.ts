/**
 * PR 7 — useRegistryStatus derives the V2 submit→timelock→execute lifecycle.
 *
 * On `main` the hook reads non-existent functions (`timelock()` no-arg,
 * `pendingTimelock`) and exposes a coarse `status` — it has no `step` field
 * and no `executableAt`-driven sub-states, so this suite fails to import /
 * derive there. On branch it passes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { holder } = vi.hoisted(() => ({
  holder: { current: {} as Record<string, unknown> },
}));

vi.mock('wagmi', () => ({
  useReadContracts: () => holder.current.readContracts,
  useAccount: () => holder.current.account,
}));

import { useRegistryStatus } from '../useRegistryStatus';

const VAULT = '0x3F4ed284A5Be70C34a28743AEE62d28A6a581a2f' as const;
const XDC = 50;
const ZERO = '0x0000000000000000000000000000000000000000';
const REGISTRY = '0x79A8C4e9E502C1867cAf2E7202f0C6b89aaCd5c1';
const USER = '0x22d4dbfff37c7d7a0c7afb9427a51de6f90a676a';
const OTHER = '0x1111111111111111111111111111111111111111';

const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

/** Build the 6-read result array in the order useRegistryStatus expects. */
function reads(o: {
  registry?: string;
  abdicated?: boolean;
  owner?: string;
  curator?: string;
  execSet?: bigint;
  execAbd?: bigint;
}) {
  return {
    readContracts: {
      isLoading: false,
      error: null,
      data: [
        { result: o.registry ?? ZERO, status: 'success' },
        { result: o.abdicated ?? false, status: 'success' },
        { result: o.owner ?? USER, status: 'success' },
        { result: o.curator ?? USER, status: 'success' },
        { result: o.execSet ?? 0n, status: 'success' },
        { result: o.execAbd ?? 0n, status: 'success' },
      ],
    },
    account: { address: USER },
  };
}

beforeEach(() => {
  holder.current = reads({});
});

const stepOf = () => renderHook(() => useRegistryStatus(VAULT, XDC)).result.current.step;

describe('useRegistryStatus — V2 timelock lifecycle (PR 7)', () => {
  it('loading / error states', () => {
    holder.current = { readContracts: { isLoading: true, error: null, data: undefined }, account: { address: USER } };
    expect(stepOf()).toBe('loading');
    holder.current = { readContracts: { isLoading: false, error: new Error('rpc'), data: undefined }, account: { address: USER } };
    expect(stepOf()).toBe('error');
  });

  it('registry unset, nothing submitted → set_not_submitted', () => {
    holder.current = reads({ registry: ZERO, execSet: 0n });
    expect(stepOf()).toBe('set_not_submitted');
  });

  it('submitted, timelock not elapsed → set_pending', () => {
    holder.current = reads({ registry: ZERO, execSet: nowSec() + 10_000n });
    expect(stepOf()).toBe('set_pending');
  });

  it('submitted, timelock elapsed → set_executable', () => {
    holder.current = reads({ registry: ZERO, execSet: nowSec() - 100n });
    expect(stepOf()).toBe('set_executable');
  });

  it('registry set, abdication not submitted → abdicate_not_submitted', () => {
    holder.current = reads({ registry: REGISTRY, abdicated: false, execAbd: 0n });
    expect(stepOf()).toBe('abdicate_not_submitted');
  });

  it('registry set, abdication submitted & elapsed → abdicate_executable', () => {
    holder.current = reads({ registry: REGISTRY, abdicated: false, execAbd: nowSec() - 100n });
    expect(stepOf()).toBe('abdicate_executable');
  });

  it('registry set AND abdicated → complete', () => {
    holder.current = reads({ registry: REGISTRY, abdicated: true });
    expect(stepOf()).toBe('complete');
  });

  it('canManage is true for the owner, true for the curator, false for anyone else', () => {
    holder.current = reads({ owner: USER, curator: OTHER });
    expect(renderHook(() => useRegistryStatus(VAULT, XDC)).result.current.canManage).toBe(true); // owner

    holder.current = reads({ owner: OTHER, curator: USER });
    expect(renderHook(() => useRegistryStatus(VAULT, XDC)).result.current.canManage).toBe(true); // curator

    holder.current = reads({ owner: OTHER, curator: OTHER });
    expect(renderHook(() => useRegistryStatus(VAULT, XDC)).result.current.canManage).toBe(false);
  });
});
