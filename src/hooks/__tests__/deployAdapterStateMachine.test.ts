/**
 * PR 11 — submit→wait→execute decision for the deploy-market-adapter flow.
 *
 * On `main` the helper module does not exist → import fails → suite fails.
 * On branch each of the five terminal states has a passing case.
 *
 * Sibling: `useV2TimelockedOp.test.ts` (PR 10) which tests the same shape
 * for the standalone drawers. Together they pin the V2 governance contract.
 */
import { describe, it, expect } from 'vitest';
import { nextDeployStep } from '../deployAdapterStateMachine';

const ADAPTER = '0x0000000000000000000000000000000000000001' as const;
const NOW = 1_700_000_000n;

describe('nextDeployStep — V2 deploy-and-add-adapter decision (PR 11)', () => {
  it('factory has no adapter for vault → needs-deploy', () => {
    expect(
      nextDeployStep({
        factoryAdapter: null,
        vaultIsAdapter: false,
        executableAt: 0n,
        nowSec: NOW,
      }),
    ).toEqual({ kind: 'needs-deploy' });
  });

  it('adapter exists at factory AND already on vault → already-added', () => {
    expect(
      nextDeployStep({
        factoryAdapter: ADAPTER,
        vaultIsAdapter: true,
        executableAt: 0n,
        nowSec: NOW,
      }),
    ).toEqual({ kind: 'already-added' });
  });

  it('adapter exists but not on vault, executableAt=0 → needs-submit', () => {
    expect(
      nextDeployStep({
        factoryAdapter: ADAPTER,
        vaultIsAdapter: false,
        executableAt: 0n,
        nowSec: NOW,
      }),
    ).toEqual({ kind: 'needs-submit' });
  });

  it('submitted, executableAt in the future → awaiting-timelock', () => {
    const executableAt = NOW + 86_400n;
    expect(
      nextDeployStep({
        factoryAdapter: ADAPTER,
        vaultIsAdapter: false,
        executableAt,
        nowSec: NOW,
      }),
    ).toEqual({ kind: 'awaiting-timelock', executableAt });
  });

  it('submitted, executableAt elapsed → ready-to-execute', () => {
    expect(
      nextDeployStep({
        factoryAdapter: ADAPTER,
        vaultIsAdapter: false,
        executableAt: NOW - 1n,
        nowSec: NOW,
      }),
    ).toEqual({ kind: 'ready-to-execute' });
  });

  it('executableAt equal to now → ready-to-execute (boundary, mirrors V2 self-check ≤)', () => {
    expect(
      nextDeployStep({
        factoryAdapter: ADAPTER,
        vaultIsAdapter: false,
        executableAt: NOW,
        nowSec: NOW,
      }),
    ).toEqual({ kind: 'ready-to-execute' });
  });

  it('vault state takes precedence over executableAt (idempotent on already-added vaults)', () => {
    // Edge case: somebody submitted then executed `addAdapter`, and the
    // executableAt mapping was never cleared (V2 stores the unlock time, not
    // a consumed flag). The hook must still short-circuit to already-added
    // rather than try to re-execute. Pinning this so a future refactor that
    // checks executableAt first doesn't regress.
    expect(
      nextDeployStep({
        factoryAdapter: ADAPTER,
        vaultIsAdapter: true,
        executableAt: NOW - 100n,
        nowSec: NOW,
      }),
    ).toEqual({ kind: 'already-added' });
  });
});
