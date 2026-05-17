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

import { useCallback, useMemo, useState, useEffect } from 'react';
import { useWaitForTransactionReceipt } from 'wagmi';
import type { Address } from 'viem';
import { useGuardedWriteContract, type DecodedSimError } from './useGuardedWriteContract';
import { useVaultSnapshot } from '../lib/vault/adapter';
import { prepareWrite, type PreparedWrite, type WriteIntent } from '../lib/vault/writes';
import { getPublicClient } from '../lib/data/rpcClient';
import { timelockControllerAbi } from '../lib/contracts/moolahAbis';
import {
  useIsVaultBlacklisted,
  useMoolahSingletonState,
} from '../lib/hooks/useMoolahSingleton';
import { useAppStore } from '../store/appStore';

/**
 * Reason a write is blocked at the hook layer. Consumers render the
 * matching tooltip / inline warning and disable their buttons.
 */
export type WriteDisabledReason = 'blacklisted' | 'paused' | null;

const DISABLED_TOOLTIP: Record<Exclude<WriteDisabledReason, null>, string> = {
  blacklisted: 'Vault blocked by Lista. Writes will revert on-chain.',
  paused: 'Moolah protocol is paused. Writes will revert.',
};

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
  /** Decoded preflight-revert detail (audit D4/D5). Set when simulateContract
   *  blocked the write; `errorName`/`args` resolved against the PR-1 ABIs. */
  simulateError: DecodedSimError | null;
  walletError: string | null;
  reset: () => void;
  /** True when the vault is blacklisted or the protocol is paused. */
  disabled: boolean;
  /** Why `disabled` is true — used by the caller to pick the right tooltip. */
  disabledReason: WriteDisabledReason;
  /** Canonical tooltip text to render on disabled buttons. */
  disabledTooltip: string | null;
  /** Component-level breakdown (exposed so UIs can render multiple warnings). */
  isBlacklisted: boolean;
  isPaused: boolean;
  /**
   * Set after the most recent `submit()` call returned an `invalid`
   * preflight (simulation reverted, intent inapplicable for the flavor,
   * etc). UI renders this as an inline warning.
   */
  invalidReason: string | null;
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
    simulateError,
    walletError,
    reset: resetWrite,
  } = useGuardedWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const addScheduledOp = useAppStore((s) => s.addScheduledOp);

  // Safety gates — never silently allow a write that the protocol will reject.
  const { data: isBlacklistedRaw } = useIsVaultBlacklisted(chainId, vaultAddress);
  const { data: moolahState } = useMoolahSingletonState(chainId);
  const isBlacklisted = Boolean(isBlacklistedRaw);
  const isPaused = Boolean(moolahState?.isPaused);
  const disabledReason: WriteDisabledReason = isBlacklisted
    ? 'blacklisted'
    : isPaused
      ? 'paused'
      : null;
  const disabled = disabledReason !== null;
  const disabledTooltip = disabledReason ? DISABLED_TOOLTIP[disabledReason] : null;

  const [pendingOp, setPendingOp] = useState<PreparedWrite | null>(null);
  // Track which tx hash we've already handled so the success effect fires
  // exactly once — prevents the infinite loop where `onSuccess` triggers a
  // parent re-render that gives us a new `onSuccess` reference (React error
  // #185: max update depth exceeded).
  const [handledHash, setHandledHash] = useState<`0x${string}` | undefined>(undefined);

  useEffect(() => {
    if (isSuccess && hash && hash !== handledHash) {
      setHandledHash(hash);
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
  }, [isSuccess, hash, handledHash, pendingOp, chainId, vaultAddress, addScheduledOp, onSuccess]);

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

  const [invalidReason, setInvalidReason] = useState<string | null>(null);
  const submit = useCallback(
    async (intent: WriteIntent) => {
      if (!chainId || !vaultAddress) return;
      // Final safety gate — the UI SHOULD have disabled the button already,
      // but if something slips through (programmatic invocation, stale
      // state), refuse to broadcast a tx that would revert on-chain.
      if (disabled) return;
      setInvalidReason(null);
      const client = getPublicClient(chainId);
      const prepared = await prepareWrite(vaultAddress, intent, snapshot ?? null, client);

      if (prepared.type === 'invalid') {
        setInvalidReason(prepared.reason);
        return;
      }

      if (prepared.type === 'direct') {
        writeDirect(writeContract, prepared, chainId);
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
    [chainId, vaultAddress, snapshot, writeContract, disabled],
  );

  const mode: UseVaultWriteResult['mode'] = useMemo(
    () =>
      snapshot == null
        ? 'unknown'
        : snapshot.flavor === 'moolahVault'
          ? 'timelocked'
          : 'direct',
    [snapshot],
  );

  const reset = useCallback(() => {
    setPendingOp(null);
    setInvalidReason(null);
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
    // Decoded preflight revert takes priority over the wagmi write error
    // (mirrors useReallocate's `simulationError ?? writeError`).
    error: simulateError ? new Error(simulateError.message) : (error as Error) ?? null,
    simulateError,
    walletError,
    reset,
    disabled,
    disabledReason,
    disabledTooltip,
    isBlacklisted,
    isPaused,
    invalidReason,
  };
}

/**
 * Bridges wagmi's strictly-typed `writeContract` union to our type-erased
 * `PreparedWrite.direct` shape. All casts live here so the consumer call
 * sites (CapsTab, QueuesTab, etc.) stay cast-free and the surface-level
 * types remain honest.
 */
function writeDirect(
  writeContract: ReturnType<typeof useGuardedWriteContract>['writeContract'],
  prepared: Extract<PreparedWrite, { type: 'direct' }>,
  chainId: number,
): void {
  writeContract({
    address: prepared.to,
    abi: prepared.abi as never,
    functionName: prepared.functionName as never,
    args: prepared.args as never,
    chainId,
    value: prepared.value,
  });
}
