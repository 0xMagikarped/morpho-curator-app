/**
 * PR 10 — derive the Submit / Wait / Execute step from `executableAt`.
 *
 * Pure-function unit test. On `main` `deriveTimelockStep` doesn't exist —
 * the import fails → suite fails. On branch all pass.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveTimelockStep,
  combineTimelockSteps,
  type TimelockOpState,
} from '../useV2TimelockedOp';

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

/**
 * PR 12 — multi-calldata batch state. Drives the unified Submit/Wait/Execute
 * button in `UpdateCapsDrawer` (and any future drawer that multicalls many
 * timelocked ops together).
 */
const opState = (executableAt: bigint, step: TimelockOpState['step']): TimelockOpState => ({
  step,
  executableAt,
});

describe('combineTimelockSteps — multi-calldata batch state (PR 12)', () => {
  it('empty batch → none', () => {
    expect(combineTimelockSteps([])).toEqual({ step: 'none' });
  });

  it('any loading → loading', () => {
    expect(
      combineTimelockSteps([
        opState(0n, 'loading'),
        opState(NOW - 1n, 'executable'),
      ]),
    ).toEqual({ step: 'loading' });
  });

  it('any executableAt == 0 → not_submitted (multicall execute would revert)', () => {
    expect(
      combineTimelockSteps([
        opState(NOW - 1n, 'executable'),
        opState(0n, 'not_submitted'),
      ]),
    ).toEqual({ step: 'not_submitted' });
  });

  it('all submitted but some still pending → pending with the MAX executableAt', () => {
    const early = NOW + 100n;
    const late = NOW + 1000n;
    expect(
      combineTimelockSteps([
        opState(early, 'pending'),
        opState(late, 'pending'),
      ]),
    ).toEqual({ step: 'pending', executableAt: late });
  });

  it('mix of pending + executable → pending with the future executableAt (slowest gates the batch)', () => {
    const future = NOW + 1000n;
    expect(
      combineTimelockSteps([
        opState(NOW - 1n, 'executable'),
        opState(future, 'pending'),
      ]),
    ).toEqual({ step: 'pending', executableAt: future });
  });

  it('all executable → executable', () => {
    expect(
      combineTimelockSteps([
        opState(NOW - 1n, 'executable'),
        opState(NOW - 100n, 'executable'),
      ]),
    ).toEqual({ step: 'executable' });
  });

  it('single executable op → executable (batch-of-one collapses correctly)', () => {
    expect(combineTimelockSteps([opState(NOW, 'executable')])).toEqual({ step: 'executable' });
  });
});
