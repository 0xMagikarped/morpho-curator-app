/**
 * PR 2 — audit finding D4: simulate-before-write guard.
 *
 * Pre-fix (on `main`) the hook has NO preflight: `writeContract` dispatches
 * immediately and there is no `simulateError` field — tests 1-4 fail.
 * Post-fix every write is simulated on its exact args and blocked fail-closed
 * if it would revert; the decoded reason is exposed and reaches the DOM.
 *
 * No wagmi/renderHook harness existed before — this suite establishes one by
 * mocking `wagmi` (useAccount/useWriteContract) and the `getPublicClient`
 * factory so `simulateContract` can be made to resolve or revert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, act, screen } from '@testing-library/react';
import {
  encodeErrorResult,
  ContractFunctionRevertedError,
  type Hex,
} from 'viem';
import { metaMorphoV1Abi } from '../../lib/contracts/abis';

// --- mocks -----------------------------------------------------------------
const writeContractSpy = vi.fn();
const writeContractAsyncSpy = vi.fn().mockResolvedValue('0xhash');
const resetSpy = vi.fn();

vi.mock('wagmi', () => ({
  useAccount: () => ({ isConnected: true, address: '0x1111111111111111111111111111111111111111', chainId: 1 }),
  useWriteContract: () => ({
    writeContract: writeContractSpy,
    writeContractAsync: writeContractAsyncSpy,
    data: undefined,
    error: null,
    isPending: false,
    status: 'idle',
    reset: resetSpy,
  }),
}));

const simulateContractMock = vi.fn();
vi.mock('../../lib/data/rpcClient', () => ({
  getPublicClient: () => ({ simulateContract: simulateContractMock }),
}));

import { useGuardedWriteContract } from '../useGuardedWriteContract';

const WRITE_ARGS = {
  address: '0x2222222222222222222222222222222222222222' as const,
  abi: metaMorphoV1Abi,
  functionName: 'submitTimelock',
  args: [86_400n],
  chainId: 1,
} as const;

/** A viem revert as simulateContract would throw it (BaseError subclass). */
function revertWith(data: Hex) {
  return new ContractFunctionRevertedError({
    abi: metaMorphoV1Abi,
    data,
    functionName: 'submitTimelock',
  });
}

beforeEach(() => {
  writeContractSpy.mockClear();
  writeContractAsyncSpy.mockClear();
  simulateContractMock.mockReset();
});

describe('useGuardedWriteContract — simulate-before-write guard (audit D4)', () => {
  it('simulate succeeds → write proceeds exactly once, no simulateError', async () => {
    simulateContractMock.mockResolvedValue({ request: {} });
    const { result } = renderHook(() => useGuardedWriteContract());

    await act(async () => {
      result.current.writeContract(WRITE_ARGS);
    });

    expect(simulateContractMock).toHaveBeenCalledTimes(1);
    expect(writeContractSpy).toHaveBeenCalledTimes(1);
    expect(result.current.simulateError).toBeNull();
  });

  it('writeContract WITHOUT chainId → falls back to the connected chain, write proceeds (PR 8)', async () => {
    // The adapter drawers call writeContract without `chainId`. Pre-PR-8 the
    // guard hard-failed "Missing chainId"; now it uses the connected chain.
    simulateContractMock.mockResolvedValue({ request: {} });
    const { chainId: _omit, ...noChainArgs } = WRITE_ARGS;
    void _omit;
    const { result } = renderHook(() => useGuardedWriteContract());

    await act(async () => {
      result.current.writeContract(noChainArgs);
    });

    expect(simulateContractMock).toHaveBeenCalledTimes(1);
    expect(writeContractSpy).toHaveBeenCalledTimes(1);
    expect(result.current.simulateError).toBeNull();
  });

  it('simulate reverts with a known error → write BLOCKED, decoded errorName exposed', async () => {
    const encoded = encodeErrorResult({ abi: metaMorphoV1Abi, errorName: 'AboveMaxTimelock' });
    simulateContractMock.mockRejectedValue(revertWith(encoded));
    const { result } = renderHook(() => useGuardedWriteContract());

    await act(async () => {
      result.current.writeContract(WRITE_ARGS);
    });

    expect(writeContractSpy).not.toHaveBeenCalled();
    expect(result.current.simulateError?.errorName).toBe('AboveMaxTimelock');
    expect(result.current.simulateError?.message).toContain('AboveMaxTimelock');
  });

  it('simulate reverts with an unknown selector → write BLOCKED (fail-closed), raw hex kept', async () => {
    simulateContractMock.mockRejectedValue(revertWith('0xdeadbeef'));
    const { result } = renderHook(() => useGuardedWriteContract());

    await act(async () => {
      result.current.writeContract(WRITE_ARGS);
    });

    expect(writeContractSpy).not.toHaveBeenCalled();
    expect(result.current.simulateError).not.toBeNull();
    expect(result.current.simulateError?.errorName).toBeNull();
    expect(result.current.simulateError?.raw).toBe('0xdeadbeef');
  });

  it('writeContractAsync rejects (does not resolve) when the preflight reverts', async () => {
    const encoded = encodeErrorResult({ abi: metaMorphoV1Abi, errorName: 'AlreadyPending' });
    simulateContractMock.mockRejectedValue(revertWith(encoded));
    const { result } = renderHook(() => useGuardedWriteContract());

    await expect(
      act(async () => {
        await result.current.writeContractAsync(WRITE_ARGS);
      }),
    ).rejects.toThrow(/AlreadyPending/);
    expect(writeContractAsyncSpy).not.toHaveBeenCalled();
  });

  it('the decoded error reaches the DOM (fixture consumer of the real hook)', async () => {
    // Minimal real consumer — proves the hook→render contract end-to-end
    // without mounting CapsTab's 781-LOC dependency graph (see FIX_LOG).
    simulateContractMock.mockRejectedValue(
      revertWith(encodeErrorResult({ abi: metaMorphoV1Abi, errorName: 'MarketNotCreated' })),
    );
    function Fixture() {
      const { writeContract, simulateError } = useGuardedWriteContract();
      return (
        <div>
          <button onClick={() => writeContract(WRITE_ARGS)}>go</button>
          {simulateError && <p role="alert">Reverts: {simulateError.errorName}</p>}
        </div>
      );
    }
    render(<Fixture />);
    await act(async () => {
      screen.getByText('go').click();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Reverts: MarketNotCreated');
  });
});
