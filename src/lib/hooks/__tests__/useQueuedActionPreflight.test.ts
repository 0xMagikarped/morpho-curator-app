/**
 * Dry-running queued V2 actions before offering them.
 *
 * A matured timelock entry is not an executable one: the target function still
 * runs its own checks, and those were evaluated at submit time, often weeks
 * earlier. Verified against RockawayX USDC on Pharos (0x047cd0a9…02e5) with
 * three live entries, called from a role-less address:
 *
 *   setCurator(0x22D4dbFf…)             -> revert 0x82b42900 Unauthorized()
 *   increaseRelativeCap(adapter …)      -> OK
 *   increaseAbsoluteCap(collateral …)   -> revert 0xa844d937 AbsoluteCapNotIncreasing()
 *
 *   multicall([all three])              -> revert 0x82b42900
 *   multicall([the one that passes])    -> OK
 *
 * That last pair is why the preflight exists at all: `multicall` has no
 * per-call try/catch, so one dead entry takes the whole batch down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeErrorResult } from 'viem';
import { MORPHO_METAMORPHO_V2_ERRORS } from '../../contracts/morphoErrors';

const { callSpy } = vi.hoisted(() => ({ callSpy: vi.fn() }));

vi.mock('../../data/rpcClient', () => ({
  getPublicClient: () => ({ call: callSpy }),
  fetchTokenInfo: vi.fn().mockResolvedValue(null),
}));

import { preflightActions } from '../useQueuedActionPreflight';

const VAULT = '0x047cd0a91e9b92ed979189a6c8a120bf280f02e5' as const;
const ACCOUNT = '0x1111111111111111111111111111111111111111' as const;
const CHAIN = 1672;

const UNAUTHORIZED = '0x82b42900';
const CAP_NOT_INCREASING = '0xa844d937';

const action = (data: string, executableAt: bigint) =>
  ({
    data: data as `0x${string}`,
    selector: data.slice(0, 10) as `0x${string}`,
    executableAt,
    functionName: 'increaseAbsoluteCap',
    label: 'Increase absolute cap',
    target: null,
    value: null,
    blockNumber: null,
  }) as const;

const PAST = 1_780_000_000n;
const FUTURE = 4_000_000_000n;

/** Mimics viem, which nests the revert payload down a `cause` chain. */
function viemRevert(data: string) {
  return Object.assign(new Error('execution reverted'), {
    cause: Object.assign(new Error('reverted'), { data }),
  });
}

beforeEach(() => {
  callSpy.mockReset();
  callSpy.mockResolvedValue({ data: '0x' });
});

describe('revert selectors decode to the real V2 error names', () => {
  it('0x82b42900 is Unauthorized', () => {
    expect(
      decodeErrorResult({ abi: MORPHO_METAMORPHO_V2_ERRORS, data: UNAUTHORIZED }).errorName,
    ).toBe('Unauthorized');
  });

  it('0xa844d937 is AbsoluteCapNotIncreasing', () => {
    expect(
      decodeErrorResult({ abi: MORPHO_METAMORPHO_V2_ERRORS, data: CAP_NOT_INCREASING }).errorName,
    ).toBe('AbsoluteCapNotIncreasing');
  });
});

describe('preflightActions', () => {
  it('reproduces the three live Pharos entries', async () => {
    callSpy.mockImplementation(async (args: { data: string }) => {
      const { data } = args;
      if (data === '0xe90956cf') throw viemRevert(UNAUTHORIZED);
      if (data === '0xf6f98fd5') throw viemRevert(CAP_NOT_INCREASING);
      return { data: '0x' };
    });

    const out = await preflightActions(CHAIN, VAULT, ACCOUNT, [
      action('0xe90956cf', PAST),
      action('0x2438525b', PAST),
      action('0xf6f98fd5', PAST),
    ]);

    expect(out['0xe90956cf']).toEqual({ status: 'reverts', reason: 'Unauthorized' });
    expect(out['0x2438525b']).toEqual({ status: 'ok', reason: null });
    expect(out['0xf6f98fd5']).toEqual({
      status: 'reverts',
      reason: 'AbsoluteCapNotIncreasing',
    });
  });

  it('a transport failure is unknown, not "would revert"', async () => {
    // No revert payload — the node refused, the action may be perfectly fine.
    callSpy.mockImplementation(async () => {
      throw new Error('HTTP request failed: 429');
    });

    const out = await preflightActions(CHAIN, VAULT, ACCOUNT, [action('0xdeadbeef', PAST)]);
    expect(out['0xdeadbeef']).toEqual({ status: 'unknown', reason: null });
  });

  it('surfaces the raw selector when the error is not in the ABI', async () => {
    callSpy.mockImplementation(async () => {
      throw viemRevert('0x12345678');
    });

    const out = await preflightActions(CHAIN, VAULT, ACCOUNT, [action('0xdeadbeef', PAST)]);
    expect(out['0xdeadbeef']).toEqual({ status: 'reverts', reason: '0x12345678' });
  });
});

/**
 * The batch-eligibility rule the panel applies. Kept here beside the on-chain
 * evidence it encodes: a dead entry must never reach a multicall, because the
 * batch has no per-call try/catch.
 */
function isBatchable(
  a: { executableAt: bigint; functionName: string; data: string },
  preflight: Record<string, { status: string }>,
  nowSec: bigint,
) {
  return (
    a.executableAt <= nowSec &&
    a.functionName !== 'unknown' &&
    preflight[a.data]?.status !== 'reverts'
  );
}

describe('batch eligibility', () => {
  const now = 1_790_000_000n;

  it('excludes entries that would revert, so the batch cannot be poisoned', () => {
    const pre = {
      '0xe90956cf': { status: 'reverts' },
      '0x2438525b': { status: 'ok' },
      '0xf6f98fd5': { status: 'reverts' },
    };
    const live = [
      action('0xe90956cf', PAST),
      action('0x2438525b', PAST),
      action('0xf6f98fd5', PAST),
    ];
    const batch = live.filter((a) => isBatchable(a, pre, now));
    expect(batch.map((a) => a.data)).toEqual(['0x2438525b']);
  });

  it('excludes actions whose timelock has not elapsed', () => {
    const a = action('0xaaaa', FUTURE);
    expect(isBatchable(a, { '0xaaaa': { status: 'ok' } }, now)).toBe(false);
  });

  it('includes an unknown-status action — refusing on a transport blip would strand it', () => {
    const a = action('0xaaaa', PAST);
    expect(isBatchable(a, { '0xaaaa': { status: 'unknown' } }, now)).toBe(true);
  });

  it('excludes undecodable calldata', () => {
    const a = { ...action('0xaaaa', PAST), functionName: 'unknown' };
    expect(isBatchable(a, { '0xaaaa': { status: 'ok' } }, now)).toBe(false);
  });
});
