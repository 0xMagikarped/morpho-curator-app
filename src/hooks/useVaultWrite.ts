/**
 * useVaultWrite — dispatches a write intent through the vault write router.
 *
 * On MetaMorpho: single tx (direct setter).
 * On Moolah: proposes via `timelock.schedule(...)` and records the scheduled
 * op in `appStore` so the Pending Proposals panel picks it up immediately.
 * The execute/cancel flow is handled by that panel.
 *
 * Usage:
 *   const { submit, state } = useVaultWrite(chainId, vaultAddress);
 *   submit({ kind: 'setCap', marketParams, newSupplyCap });
 *
 * `state.mode` tells the UI whether the write will be direct or timelocked,
 * so buttons can render "Submit" vs "Propose".
 */

import { useCallback, useState, useEffect } from 'react';
import { useWaitForTransactionReceipt } from 'wagmi';
import type { Address } from 'viem';
import { useGuardedWriteContract } from './useGuardedWriteContract';
import { useVaultSnapshot } from '../lib/vault/adapter';
import { prepareWrite, type PreparedWrite, type WriteIntent } from '../lib/vault/writes';
import { getPublicClient } from '../lib/data/rpcClient';
import { timelockControllerAbi } from '../lib/contracts/moolahAbis';
import { useAppStore } from '../store/appStore';

export interface UseVaultWriteResult {
  submit: (intent: WriteIntent) => Promise<void>;
  /** Preview mode without triggering a tx — lets the UI render Submit vs Propose labels. */
  describe: (intent: WriteIntent) => Promise<PreparedWrite | null>;
  mode: 'direct' | 'timelocked' | 'unknown';
  hash?: `0x${string}`;
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  error: Error | null;
  walletError: string | null;
  reset: () => void;
}

export function useVaultWrite(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  onSuccess?: () => void,
): UseVaultWriteResult {
  const { data: snapshot } = useVaultSnapshot(chainId, vaultAddress);
  const {
    writeContract,
    data: hash,
    isPending,
    error,
    walletError,
    reset: resetWrite,
  } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const addScheduledOp = useAppStore((s) => s.addScheduledOp);

  const [pendingOp, setPendingOp] = useState<PreparedWrite | null>(null);

  useEffect(() => {
    if (isSuccess) {
      // Record the Moolah-scheduled op locally so the panel always sees it,
      // even if the RPC prunes the log window.
      if (pendingOp?.type === 'timelocked' && chainId && vaultAddress) {
        addScheduledOp({
          chainId,
          timelock: pendingOp.timelock,
          vault: vaultAddress,
          opId: pendingOp.opId,
          target: pendingOp.target,
          value: pendingOp.value.toString(),
          data: pendingOp.calldata,
          predecessor: pendingOp.predecessor,
          salt: pendingOp.salt,
          delay: pendingOp.delay.toString(),
          scheduledAt: Math.floor(Date.now() / 1000),
          label: pendingOp.label,
          txHash: hash,
        });
      }
      setPendingOp(null);
      onSuccess?.();
    }
  }, [isSuccess, pendingOp, chainId, vaultAddress, hash, addScheduledOp, onSuccess]);

  const describe = useCallback(
    async (intent: WriteIntent): Promise<PreparedWrite | null> => {
      if (!chainId || !vaultAddress) return null;
      const client = getPublicClient(chainId);
      try {
        return await prepareWrite(vaultAddress, intent, snapshot ?? null, client);
      } catch {
        return null;
      }
    },
    [chainId, vaultAddress, snapshot],
  );

  const submit = useCallback(
    async (intent: WriteIntent) => {
      if (!chainId || !vaultAddress) return;
      const client = getPublicClient(chainId);
      const prepared = await prepareWrite(vaultAddress, intent, snapshot ?? null, client);

      if (prepared.type === 'direct') {
        writeContract({
          address: prepared.to,
          abi: prepared.abi as never,
          functionName: prepared.functionName as never,
          args: prepared.args as never,
          chainId,
          value: prepared.value,
        });
        return;
      }

      // Moolah: schedule on the TimelockController.
      setPendingOp(prepared);
      writeContract({
        address: prepared.timelock,
        abi: timelockControllerAbi,
        functionName: 'schedule',
        args: [
          prepared.target,
          prepared.value,
          prepared.calldata,
          prepared.predecessor,
          prepared.salt,
          prepared.delay,
        ],
        chainId,
      });
    },
    [chainId, vaultAddress, snapshot, writeContract],
  );

  const mode: UseVaultWriteResult['mode'] =
    snapshot == null
      ? 'unknown'
      : snapshot.flavor === 'moolahVault'
        ? 'timelocked'
        : 'direct';

  const reset = useCallback(() => {
    setPendingOp(null);
    resetWrite();
  }, [resetWrite]);

  return {
    submit,
    describe,
    mode,
    hash,
    isPending,
    isConfirming,
    isSuccess,
    error: (error as Error) ?? null,
    walletError,
    reset,
  };
}
