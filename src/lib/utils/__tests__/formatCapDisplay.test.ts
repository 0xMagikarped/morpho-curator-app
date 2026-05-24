/**
 * PR 24 — `formatCapDisplay` renders the wizard's "unlimited" sentinel
 * (2^128 - 1) as `∞` instead of a 39-digit numeric.
 */
import { describe, it, expect } from 'vitest';
import { formatCapDisplay, MAX_UINT128_CAP } from '../format';

describe('formatCapDisplay (PR 24)', () => {
  it('renders MAX_UINT128 as ∞', () => {
    expect(formatCapDisplay(MAX_UINT128_CAP, 6, 'USDC')).toBe('∞');
  });

  it('renders any value above MAX_UINT128 as ∞ (forward-compat)', () => {
    expect(formatCapDisplay(MAX_UINT128_CAP * 2n, 6, 'USDC')).toBe('∞');
  });

  it('renders a finite value with token amount + symbol', () => {
    // 100M USDC at 6 decimals
    const cap = 100_000_000n * 10n ** 6n;
    expect(formatCapDisplay(cap, 6, 'USDC')).toMatch(/USDC$/);
    expect(formatCapDisplay(cap, 6, 'USDC')).not.toBe('∞');
  });

  it('renders 1 unit cleanly', () => {
    expect(formatCapDisplay(10n ** 6n, 6, 'USDC')).toBe('1 USDC');
  });
});
