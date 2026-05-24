/**
 * Hooks for setting V2 adapter caps (absolute + relative) at all three levels.
 *
 * Two strategies:
 * - Sequential: one tx per cap change, with auto-advance. Required because
 *   multicall3 changes msg.sender, breaking vault auth checks.
 * - Batch via vault.multicall: only works if the vault itself has a multicall
 *   that preserves msg.sender (MetaMorpho V2 does have this).
 *
 * PR 20 — the batched path now follows V2's submit→wait→execute timelock
 * model. Cap increases (`increaseAbsoluteCap`/`increaseRelativeCap`) are
 * timelocked: each direct call self-checks `executableAt` and reverts
 * `DataNotTimelocked` if nothing was submitted. So a single multicall of
 * the target functions never worked. The new flow is:
 *
 *   tx 1: `vault.multicall([submit(cd1), submit(cd2), …])`   (one Safe sig)
 *   …wait until max(executableAt) ≤ now (instant on 0-timelock vaults)…
 *   tx 2: `vault.multicall([cd1, cd2, …])`                   (one Safe sig)
 *
 * Decrease actions (`decrease*Cap`) are immediate — they're included only
 * in tx 2. Submit is skipped if the action set has zero increases.
 *
 * On a non-zero-timelock vault, the hook returns at `waiting-timelock` so
 * the wizard can render an unlock time + a resume button. Re-calling
 * `execute(actions)` after the unlock re-reads on-chain state (existing
 * executableAt entries are reused) and continues to tx 2.
 */
import { useState, useCallback } from 'react';
import { usePublicClient } from 'wagmi';
import { useGuardedWriteContract } from './useGuardedWriteContract';
import type { Address } from 'viem';
import { encodeFunctionData } from 'viem';
import { metaMorphoV2Abi } from '../lib/contracts/metaMorphoV2Abi';
import { vaultV2RegistryAbi } from '../lib/contracts/vaultV2RegistryAbi';

export interface CapAction {
  label: string;
  functionName: 'increaseAbsoluteCap' | 'decreaseAbsoluteCap' | 'increaseRelativeCap' | 'decreaseRelativeCap';
  idData: `0x${string}`;
  cap: bigint;
}

export type SetCapsStep =
  | 'idle'
  | 'submitting'
  | 'confirming-submit'
  | 'waiting-timelock'
  | 'executing'
  | 'confirming-execute'
  | 'done'
  | 'error'
  // Legacy aliases for the sequential hook (kept stable).
  | 'pending'
  | 'confirming';

/**
 * Set caps sequentially — one wallet confirmation per cap change.
 *
 * NOTE: PR 20 — this path still calls cap targets DIRECTLY without
 * `submit()` first. It is correct only for 0-timelock vaults where the
 * direct call inherits a `DataNotTimelocked` revert. The wizard now uses
 * `useBatchSetCaps` which does the right thing on any timelock. This is
 * kept as a fallback for low-action sequential UX; deprecate it once the
 * batched path proves out in production.
 */
export function useSequentialSetCaps(
  vaultAddress: Address,
  chainId: number,
) {
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useGuardedWriteContract();

  const [step, setStep] = useState<SetCapsStep>('idle');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalActions, setTotalActions] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async (actions: CapAction[]) => {
    if (!publicClient || actions.length === 0) return;

    setStep('pending');
    setError(null);
    setCurrentIndex(0);
    setTotalActions(actions.length);

    try {
      for (let i = 0; i < actions.length; i++) {
        setCurrentIndex(i);
        setStep('pending');

        const action = actions[i];
        const hash = await writeContractAsync({
          address: vaultAddress,
          abi: metaMorphoV2Abi,
          functionName: action.functionName,
          args: [action.idData, action.cap],
          chainId,
        });

        setStep('confirming');
        await publicClient.waitForTransactionReceipt({ hash });
      }

      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Cap transaction failed'));
      setStep('error');
    }
  }, [publicClient, vaultAddress, chainId, writeContractAsync]);

  const reset = useCallback(() => {
    setStep('idle');
    setCurrentIndex(0);
    setTotalActions(0);
    setError(null);
  }, []);

  return { step, currentIndex, totalActions, error, execute, reset };
}

/**
 * Set caps via vault's built-in multicall, following the V2 timelock model:
 * submit all increases (one Safe sig) → wait → execute all (one Safe sig).
 */
export function useBatchSetCaps(
  vaultAddress: Address,
  chainId: number,
) {
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useGuardedWriteContract();

  const [step, setStep] = useState<SetCapsStep>('idle');
  const [executableAt, setExecutableAt] = useState<bigint | null>(null);
  const [error, setError] = useState<Error | null>(null);

  /**
   * Encode every action's target calldata once. Used for the execute
   * multicall and for keying executableAt reads on the submit path.
   */
  const encodeTarget = (a: CapAction): `0x${string}` =>
    encodeFunctionData({
      abi: metaMorphoV2Abi,
      functionName: a.functionName,
      args: [a.idData, a.cap],
    });

  const execute = useCallback(async (actions: CapAction[]) => {
    if (!publicClient || actions.length === 0) return;

    setError(null);
    setExecutableAt(null);

    try {
      const targetCalldatas = actions.map(encodeTarget);
      const increases = actions
        .map((a, i) => (a.functionName.startsWith('increase') ? targetCalldatas[i] : null))
        .filter((cd): cd is `0x${string}` => cd !== null);

      // === Phase 1: submit every increase (skip if none) ===========
      if (increases.length > 0) {
        // Read each calldata's existing executableAt first — if all are
        // already populated (e.g. user came back after a previous submit),
        // skip Phase 1 entirely. This makes the resume-after-wait case
        // work without firing redundant submits.
        const existingExecAt = await Promise.all(
          increases.map((cd) =>
            publicClient.readContract({
              address: vaultAddress,
              abi: vaultV2RegistryAbi,
              functionName: 'executableAt',
              args: [cd],
            }) as Promise<bigint>,
          ),
        );
        const needsSubmit = existingExecAt.some((x) => x === 0n);

        if (needsSubmit) {
          const submitCalldatas = increases.map((cd) =>
            encodeFunctionData({
              abi: metaMorphoV2Abi,
              functionName: 'submit',
              args: [cd],
            }),
          );
          setStep('submitting');
          const submitHash =
            submitCalldatas.length === 1
              ? await writeContractAsync({
                  address: vaultAddress,
                  abi: metaMorphoV2Abi,
                  functionName: 'submit',
                  args: [increases[0]],
                  chainId,
                })
              : await writeContractAsync({
                  address: vaultAddress,
                  abi: metaMorphoV2Abi,
                  functionName: 'multicall',
                  args: [submitCalldatas],
                  chainId,
                });
          setStep('confirming-submit');
          await publicClient.waitForTransactionReceipt({ hash: submitHash });
        }

        // Re-read post-submit (or first-read if needsSubmit was false).
        const postExecAt = needsSubmit
          ? await Promise.all(
              increases.map((cd) =>
                publicClient.readContract({
                  address: vaultAddress,
                  abi: vaultV2RegistryAbi,
                  functionName: 'executableAt',
                  args: [cd],
                }) as Promise<bigint>,
              ),
            )
          : existingExecAt;

        const maxExecutableAt = postExecAt.reduce((m, x) => (x > m ? x : m), 0n);
        const nowSec = BigInt(Math.floor(Date.now() / 1000));
        if (maxExecutableAt > nowSec) {
          setExecutableAt(maxExecutableAt);
          setStep('waiting-timelock');
          return;
        }
      }

      // === Phase 2: execute ALL targets (timelocked + immediate) ====
      setStep('executing');
      const execHash =
        targetCalldatas.length === 1
          ? await writeContractAsync({
              address: vaultAddress,
              abi: metaMorphoV2Abi,
              functionName: actions[0].functionName,
              args: [actions[0].idData, actions[0].cap],
              chainId,
            })
          : await writeContractAsync({
              address: vaultAddress,
              abi: metaMorphoV2Abi,
              functionName: 'multicall',
              args: [targetCalldatas],
              chainId,
            });
      setStep('confirming-execute');
      await publicClient.waitForTransactionReceipt({ hash: execHash });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Batch cap transaction failed'));
      setStep('error');
    }
  }, [publicClient, vaultAddress, chainId, writeContractAsync]);

  const reset = useCallback(() => {
    setStep('idle');
    setExecutableAt(null);
    setError(null);
  }, []);

  return { step, executableAt, error, execute, reset };
}
