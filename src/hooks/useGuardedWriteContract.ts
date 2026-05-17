import { useCallback, useState } from 'react';
import { useAccount, useWriteContract } from 'wagmi';
import { BaseError, ContractFunctionRevertedError, type Abi, type Hex } from 'viem';
import { getPublicClient } from '../lib/data/rpcClient';

/**
 * Wraps wagmi's useWriteContract with (audit D4 / PR 2):
 * 1. Wallet-connection guard before every write.
 * 2. **Mandatory `simulateContract` preflight on the EXACT args** of each
 *    write. If the call would revert, the wallet popup is NOT opened
 *    (fail-closed) and the revert is decoded against the PR-1 error ABIs.
 * 3. Full error message (no truncation).
 *
 * Because every contract write in the app already routes through this hook,
 * the guard is implemented once here and every call site becomes fail-closed
 * with no call-site changes. The "blocked until simulate-succeeded-for-these-
 * args" invariant holds by construction: the simulation uses the very args
 * passed to writeContract, so there is no stale-simulation window.
 *
 * Decode idiom mirrors src/hooks/morpho-sdk/useReallocate.ts.
 */

/** Decoded preflight failure. `errorName`/`args` set when the revert matched
 *  an ABI error; `raw` keeps the 4-byte+ data for unknown selectors. Either
 *  way the write is blocked. */
export interface DecodedSimError {
  errorName: string | null;
  args: readonly unknown[] | null;
  shortMessage: string;
  message: string;
  raw: Hex | null;
}

/** Minimal structural view of wagmi's writeContract variables — the fields
 *  viem's simulateContract needs. One contained cast (see callers). */
interface SimContractInput {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  chainId?: number;
  value?: bigint;
}

function decodeSimError(err: unknown): DecodedSimError {
  let errorName: string | null = null;
  let args: readonly unknown[] | null = null;
  let raw: Hex | null = null;
  let shortMessage = 'Transaction would revert';

  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      errorName = revert.data?.errorName ?? null;
      args = revert.data?.args ?? null;
      raw = (revert.raw as Hex | undefined) ?? null;
      shortMessage = revert.shortMessage ?? err.shortMessage ?? shortMessage;
    } else {
      shortMessage = err.shortMessage ?? err.message;
    }
  } else if (err instanceof Error) {
    shortMessage = err.message;
  }

  const message = errorName
    ? `${errorName}${args && args.length ? `(${args.map(String).join(', ')})` : ''}`
    : shortMessage || raw || 'Transaction would revert';

  return { errorName, args, shortMessage, message, raw };
}

export function useGuardedWriteContract() {
  const { isConnected, address: account } = useAccount();
  const result = useWriteContract();
  const [walletError, setWalletError] = useState<string | null>(null);
  const [simulateError, setSimulateError] = useState<DecodedSimError | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  /** Run the preflight for one write. Resolves ok / decoded failure; never throws. */
  const simulate = useCallback(
    async (
      variables: unknown,
    ): Promise<{ ok: true } | { ok: false; error: DecodedSimError }> => {
      const v = variables as SimContractInput;
      setIsSimulating(true);
      setSimulateError(null);
      try {
        if (!account) {
          throw new Error('Wallet not connected — cannot preflight the transaction');
        }
        if (typeof v.chainId !== 'number') {
          throw new Error('Missing chainId — refusing to dispatch an un-simulated write');
        }
        const client = getPublicClient(v.chainId);
        await client.simulateContract({
          address: v.address,
          abi: v.abi,
          functionName: v.functionName,
          args: v.args ? [...v.args] : undefined,
          account,
          value: v.value,
        });
        return { ok: true };
      } catch (e) {
        const decoded = decodeSimError(e);
        setSimulateError(decoded);
        return { ok: false, error: decoded };
      } finally {
        setIsSimulating(false);
      }
    },
    [account],
  );

  const guardedWriteContract: typeof result.writeContract = useCallback(
    (...callArgs) => {
      setWalletError(null);
      setSimulateError(null);
      if (!isConnected) {
        setWalletError('Please connect your wallet first');
        return;
      }
      // Fire-and-forget (matches wagmi's void writeContract): preflight, then
      // dispatch only if the simulation succeeded for these exact args.
      void (async () => {
        const sim = await simulate(callArgs[0]);
        if (sim.ok) result.writeContract(...callArgs);
      })();
    },
    [isConnected, result, simulate],
  );

  const guardedWriteContractAsync: typeof result.writeContractAsync = useCallback(
    async (...callArgs) => {
      setWalletError(null);
      setSimulateError(null);
      if (!isConnected) {
        setWalletError('Please connect your wallet first');
        throw new Error('Wallet not connected');
      }
      const sim = await simulate(callArgs[0]);
      if (!sim.ok) {
        throw new BaseError(sim.error.message, { metaMessages: [sim.error.shortMessage] });
      }
      return result.writeContractAsync(...callArgs);
    },
    [isConnected, result, simulate],
  );

  const reset = useCallback(() => {
    setWalletError(null);
    setSimulateError(null);
    setIsSimulating(false);
    result.reset();
  }, [result]);

  return {
    ...result,
    writeContract: guardedWriteContract,
    writeContractAsync: guardedWriteContractAsync,
    simulate,
    simulateError,
    isSimulating,
    reset,
    walletError,
    isConnected,
  };
}
