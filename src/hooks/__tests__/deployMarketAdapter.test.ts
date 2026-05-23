/**
 * PR 9 + PR 11 — useDeployMarketAdapter behaviour pinning.
 *
 * PR 9: factory idempotency (one-adapter-per-vault, CREATE2; non-zero
 * `morphoMarketV1AdapterV2(parentVault)` → skip factory deploy) plus the
 * corrected indexed-event ABI for `CreateMorphoMarketV1AdapterV2`.
 *
 * PR 11: V2 governance — `addAdapter` is timelocked, so the hook must follow
 * submit(addAdapter calldata) → wait until executableAt ≤ now → addAdapter
 * (direct, self-checks the timelock). The previous direct-call path reverted
 * `DataNotTimelocked` on any vault with a non-trivial timelock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { encodeEventTopics } from 'viem';
import { marketV1AdapterV2FactoryAbi } from '../../lib/contracts/marketAdapterFactoryAbi';

const { writeDeployAsync, writeSubmitAsync, writeAddAsync, readContractMock, waitForTxMock, counter } =
  vi.hoisted(() => ({
    writeDeployAsync: vi.fn().mockResolvedValue('0xdeploy'),
    writeSubmitAsync: vi.fn().mockResolvedValue('0xsubmit'),
    writeAddAsync: vi.fn().mockResolvedValue('0xadd'),
    readContractMock: vi.fn(),
    waitForTxMock: vi.fn(),
    counter: { n: 0 },
  }));

vi.mock('wagmi', () => ({
  usePublicClient: () => ({
    readContract: readContractMock,
    waitForTransactionReceipt: waitForTxMock,
  }),
}));

// The hook calls useGuardedWriteContract() three times (deploy + submit +
// add). The counter hands out the matching mock in order of first
// invocation; React invokes the hooks in the same order on every render so
// this is stable.
vi.mock('../useGuardedWriteContract', () => ({
  useGuardedWriteContract: () => {
    counter.n++;
    if (counter.n === 1) return { writeContractAsync: writeDeployAsync, data: undefined };
    if (counter.n === 2) return { writeContractAsync: writeSubmitAsync, data: undefined };
    return { writeContractAsync: writeAddAsync, data: undefined };
  },
}));

import { useDeployMarketAdapter } from '../useDeployMarketAdapter';

const VAULT = '0x3F4ed284A5Be70C34a28743AEE62d28A6a581a2f' as const;
const CHAIN = 50; // XDC — has the V2-adapter factory.
const FACTORY = '0x5C00c99F2235439725417E9f037B7D38FfF35d31' as const;
const EXISTING = '0x73b52f0807d407a3295f9d3f6c1864aecae3cdd6' as const;
const ZERO = '0x0000000000000000000000000000000000000000';

beforeEach(() => {
  writeDeployAsync.mockClear();
  writeSubmitAsync.mockClear();
  writeAddAsync.mockClear();
  readContractMock.mockReset();
  waitForTxMock.mockReset();
  counter.n = 0;
});

/**
 * Convenience: route `readContract` by functionName instead of relying on
 * call order. Both `isAdapter` and `executableAt` fire inside `Promise.all`
 * so ordering is not portable. Queues let later calls (post-submit) return
 * different values.
 */
function setupReads(opts: {
  factoryAdapter: string;
  isAdapter: boolean[];      // queue, one per Promise.all round
  executableAt: bigint[];    // queue, one per Promise.all round
}) {
  const isAdapterQueue = [...opts.isAdapter];
  const executableAtQueue = [...opts.executableAt];
  readContractMock.mockImplementation((args: { functionName: string }) => {
    if (args.functionName === 'morphoMarketV1AdapterV2') return Promise.resolve(opts.factoryAdapter);
    if (args.functionName === 'isAdapter') return Promise.resolve(isAdapterQueue.shift() ?? false);
    if (args.functionName === 'executableAt') return Promise.resolve(executableAtQueue.shift() ?? 0n);
    return Promise.reject(new Error(`unmocked readContract: ${args.functionName}`));
  });
}

describe('useDeployMarketAdapter — PR 9 idempotency + PR 11 timelock flow', () => {
  it('skips factory deploy when adapter exists, then submit → execute (0-timelock)', async () => {
    setupReads({
      factoryAdapter: EXISTING,
      // Round 1 (before submit): not on vault, executableAt = 0.
      // Round 2 (after submit): not on vault, executableAt elapsed.
      isAdapter: [false, false],
      executableAt: [0n, 1n],
    });
    waitForTxMock.mockResolvedValue({ logs: [] });

    const { result } = renderHook(() => useDeployMarketAdapter(VAULT, CHAIN));
    await act(async () => {
      await result.current.deploy();
    });

    // PR 9: factory deploy skipped.
    expect(writeDeployAsync).not.toHaveBeenCalled();
    // PR 11: submit and execute, in that order.
    expect(writeSubmitAsync).toHaveBeenCalledTimes(1);
    expect(writeSubmitAsync.mock.calls[0][0]).toMatchObject({
      address: VAULT,
      functionName: 'submit',
    });
    expect(writeAddAsync).toHaveBeenCalledTimes(1);
    expect(writeAddAsync.mock.calls[0][0]).toMatchObject({
      functionName: 'addAdapter',
      args: [EXISTING],
    });
    expect(result.current.deployedAdapter).toBe(EXISTING);
    expect(result.current.step).toBe('done');
  });

  it('short-circuits to done when the adapter is already on the vault', async () => {
    setupReads({
      factoryAdapter: EXISTING,
      isAdapter: [true],
      executableAt: [0n],
    });
    waitForTxMock.mockResolvedValue({ logs: [] });

    const { result } = renderHook(() => useDeployMarketAdapter(VAULT, CHAIN));
    await act(async () => {
      await result.current.deploy();
    });

    // Neither write fires — nothing to do.
    expect(writeDeployAsync).not.toHaveBeenCalled();
    expect(writeSubmitAsync).not.toHaveBeenCalled();
    expect(writeAddAsync).not.toHaveBeenCalled();
    expect(result.current.step).toBe('done');
    expect(result.current.deployedAdapter).toBe(EXISTING);
  });

  it('stops at waiting-timelock when executableAt is in the future after submit', async () => {
    const FUTURE = BigInt(Math.floor(Date.now() / 1000)) + 86_400n; // 1d ahead
    setupReads({
      factoryAdapter: EXISTING,
      isAdapter: [false, false],
      executableAt: [0n, FUTURE],
    });
    waitForTxMock.mockResolvedValue({ logs: [] });

    const { result } = renderHook(() => useDeployMarketAdapter(VAULT, CHAIN));
    await act(async () => {
      await result.current.deploy();
    });

    expect(writeSubmitAsync).toHaveBeenCalledTimes(1);
    expect(writeAddAsync).not.toHaveBeenCalled();
    expect(result.current.step).toBe('waiting-timelock');
    expect(result.current.executableAt).toBe(FUTURE);
  });

  it('deploys when no adapter exists, extracts indexed event address, then submit → execute', async () => {
    const NEW_ADAPTER = '0xaaaa000000000000000000000000000000000000' as const;
    setupReads({
      factoryAdapter: ZERO,
      isAdapter: [false, false],
      executableAt: [0n, 1n],
    });

    const topics = encodeEventTopics({
      abi: marketV1AdapterV2FactoryAbi,
      eventName: 'CreateMorphoMarketV1AdapterV2',
      args: { parentVault: VAULT, morphoMarketV1AdapterV2: NEW_ADAPTER },
    });
    waitForTxMock
      .mockResolvedValueOnce({ logs: [{ topics, data: '0x', address: FACTORY }] }) // deploy receipt
      .mockResolvedValueOnce({ logs: [] })                                          // submit receipt
      .mockResolvedValueOnce({ logs: [] });                                         // add receipt

    const { result } = renderHook(() => useDeployMarketAdapter(VAULT, CHAIN));
    await act(async () => {
      await result.current.deploy();
    });

    expect(writeDeployAsync).toHaveBeenCalledTimes(1);
    expect(result.current.deployedAdapter?.toLowerCase()).toBe(NEW_ADAPTER.toLowerCase());
    expect(writeSubmitAsync).toHaveBeenCalledTimes(1);
    expect(writeAddAsync).toHaveBeenCalledTimes(1);
    expect(writeAddAsync.mock.calls[0][0]).toMatchObject({
      functionName: 'addAdapter',
    });
    expect(result.current.step).toBe('done');
  });
});
