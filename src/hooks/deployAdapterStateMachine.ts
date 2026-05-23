/**
 * PR 11 — pure decision function for the "deploy market adapter & add to
 * vault" flow on a Morpho Vault V2.
 *
 * The old `useDeployMarketAdapter` called `vault.addAdapter(adapter)` DIRECTLY
 * after the factory deploy. On any V2 vault that requires a timelock for
 * `addAdapter`, that direct call reverts `DataNotTimelocked` because
 * `executableAt[addAdapter calldata] == 0`. PR 10 fixed this in the standalone
 * drawer; this PR fixes it in the deploy hook + wizard.
 *
 * The correct V2 governance pattern (also used by PR 7's registry flow and
 * PR 10's drawer family) is:
 *
 *   submit(addAdapter calldata)  →  wait until executableAt ≤ now  →  addAdapter(adapter)
 *
 * Keeping the decision pure makes the wizard easy to unit-test on `main`
 * (where this module doesn't exist → import error → test fails) and on the
 * branch (where the five branches below each have a passing case).
 */
import type { Address } from 'viem';

export type AdapterDeployState =
  /** factory hasn't deployed an adapter for this parentVault yet. */
  | { kind: 'needs-deploy' }
  /** adapter exists at factory AND vault.isAdapter(adapter) === true. */
  | { kind: 'already-added' }
  /** adapter exists at factory but not on vault, and nothing has been submitted. */
  | { kind: 'needs-submit' }
  /** submit landed; timelock not yet elapsed. */
  | { kind: 'awaiting-timelock'; executableAt: bigint }
  /** submit landed and timelock elapsed; can call addAdapter directly. */
  | { kind: 'ready-to-execute' };

export interface NextDeployStepInput {
  /**
   * The address returned by `factory.morphoMarketV1AdapterV2(parentVault)`.
   * `null` (or zero address) means no adapter has been deployed yet.
   */
  factoryAdapter: Address | null;
  /**
   * The result of `vault.isAdapter(adapter)`. Only consulted when
   * `factoryAdapter` is non-null.
   */
  vaultIsAdapter: boolean;
  /**
   * The result of `vault.executableAt(encodeCall(addAdapter, [adapter]))`.
   * `0n` means "nothing submitted yet"; any positive value is the unix
   * timestamp at which the timelock unlocks. Only consulted when the
   * adapter exists and is not yet on the vault.
   */
  executableAt: bigint;
  /** Current chain-time in seconds (use `block.timestamp` or `Date.now()/1000`). */
  nowSec: bigint;
}

/**
 * Decide the next action in the deploy-and-add-adapter flow. Pure — no I/O,
 * no React, deterministic for testing.
 */
export function nextDeployStep(input: NextDeployStepInput): AdapterDeployState {
  if (!input.factoryAdapter) return { kind: 'needs-deploy' };
  if (input.vaultIsAdapter) return { kind: 'already-added' };
  if (input.executableAt === 0n) return { kind: 'needs-submit' };
  if (input.executableAt > input.nowSec) {
    return { kind: 'awaiting-timelock', executableAt: input.executableAt };
  }
  return { kind: 'ready-to-execute' };
}
