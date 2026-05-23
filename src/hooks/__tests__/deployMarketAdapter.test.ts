/**
 * PR 9 — useDeployMarketAdapter idempotency + corrected event parsing.
 *
 * The factory is one-adapter-per-vault (CREATE2). On `main` the hook blindly
 * calls `create…`, which reverts when the adapter already exists. PR 9 reads
 * `morphoMarketV1AdapterV2(parentVault)` first; non-zero → skip the deploy.
 * The previous event ABI also had the adapter param non-indexed (wrong),
 * which silently lost the address on a *successful* deploy — fixed here too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { encodeEventTopics } from 'viem';
import { marketV1AdapterV2FactoryAbi } from '../../lib/contracts/marketAdapterFactoryAbi';

const { writeDeployAsync, writeAddAsync, readContractMock, waitForTxMock, counter } = vi.hoisted(() => ({
  writeDeployAsync: vi.fn().mockResolvedValue('0xdeploy'),
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

// The hook calls useGuardedWriteContract() twice (deploy + add). The counter
// hands out a deploy-instance on odd calls, an add-instance on even calls.
vi.mock('../useGuardedWriteContract', () => ({
  useGuardedWriteContract: () => {
    counter.n++;
    return counter.n % 2 === 1
      ? { writeContractAsync: writeDeployAsync, data: undefined }
      : { writeContractAsync: writeAddAsync, data: undefined };
  },
}));

import { useDeployMarketAdapter } from '../useDeployMarketAdapter';

const VAULT = '0x3F4ed284A5Be70C34a28743AEE62d28A6a581a2f' as const;
const CHAIN = 50; // XDC — added in feat/xdc-network; has the V2-adapter factory.
const FACTORY = '0x5C00c99F2235439725417E9f037B7D38FfF35d31' as const;
const EXISTING = '0x73b52f0807d407a3295f9d3f6c1864aecae3cdd6' as const;
const ZERO = '0x0000000000000000000000000000000000000000';

beforeEach(() => {
  writeDeployAsync.mockClear();
  writeAddAsync.mockClear();
  readContractMock.mockReset();
  waitForTxMock.mockReset();
  counter.n = 0;
});

describe('useDeployMarketAdapter — PR 9', () => {
  it('skips deploy and adds the EXISTING adapter when the factory already has one', async () => {
    readContractMock.mockResolvedValueOnce(EXISTING);
    // The add tx's receipt still needs to resolve.
    waitForTxMock.mockResolvedValue({ logs: [] });

    const { result } = renderHook(() => useDeployMarketAdapter(VAULT, CHAIN));
    await act(async () => {
      await result.current.deploy();
    });

    expect(writeDeployAsync).not.toHaveBeenCalled();
    expect(writeAddAsync).toHaveBeenCalledTimes(1);
    expect(writeAddAsync.mock.calls[0][0]).toMatchObject({
      functionName: 'addAdapter',
      args: [EXISTING],
    });
    expect(result.current.deployedAdapter).toBe(EXISTING);
    expect(result.current.step).toBe('done');
  });

  it('deploys when no adapter exists and extracts the new address from the indexed event', async () => {
    const NEW_ADAPTER = '0xaaaa000000000000000000000000000000000000' as const;
    readContractMock.mockResolvedValueOnce(ZERO);

    // Build a valid log for the corrected CreateMorphoMarketV1AdapterV2 event
    // (both params indexed → topics[0..2], empty data).
    const topics = encodeEventTopics({
      abi: marketV1AdapterV2FactoryAbi,
      eventName: 'CreateMorphoMarketV1AdapterV2',
      args: { parentVault: VAULT, morphoMarketV1AdapterV2: NEW_ADAPTER },
    });
    waitForTxMock
      .mockResolvedValueOnce({
        logs: [{ topics, data: '0x', address: FACTORY }],
      })
      .mockResolvedValueOnce({ logs: [] }); // add-tx receipt

    const { result } = renderHook(() => useDeployMarketAdapter(VAULT, CHAIN));
    await act(async () => {
      await result.current.deploy();
    });

    expect(writeDeployAsync).toHaveBeenCalledTimes(1);
    expect(result.current.deployedAdapter?.toLowerCase()).toBe(NEW_ADAPTER.toLowerCase());
    expect(writeAddAsync).toHaveBeenCalledTimes(1);
    expect(writeAddAsync.mock.calls[0][0]).toMatchObject({
      functionName: 'addAdapter',
    });
    expect(result.current.step).toBe('done');
  });
});
