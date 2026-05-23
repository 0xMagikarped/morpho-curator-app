/**
 * PR 10 — derive the Submit / Wait / Execute step from `executableAt`.
 *
 * Pure-function unit test. On `main` `deriveTimelockStep` doesn't exist —
 * the import fails → suite fails. On branch all pass.
 */
import { describe, it, expect } from 'vitest';
import { deriveTimelockStep } from '../useV2TimelockedOp';

const NOW = 1_700_000_000n;

describe('deriveTimelockStep — V2 timelock state derivation (PR 10)', () => {
  it('executableAt == 0 → not_submitted', () => {
    expect(deriveTimelockStep(0n, NOW)).toBe('not_submitted');
  });

  it('executableAt in the future → pending', () => {
    expect(deriveTimelockStep(NOW + 100n, NOW)).toBe('pending');
  });

  it('executableAt in the past → executable', () => {
    expect(deriveTimelockStep(NOW - 1n, NOW)).toBe('executable');
  });

  it('executableAt equal to now → executable (boundary)', () => {
    // The contract gates on `executableAt <= now`, so equal qualifies. The
    // derivation must mirror that (`executableAt > now` is the pending
    // condition, equal is not pending).
    expect(deriveTimelockStep(NOW, NOW)).toBe('executable');
  });
});
