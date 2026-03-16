import { describe, it, expect } from 'vitest';
import { validateAmount, isMorphoApiSupported } from '../utils/validation';

describe('validateAmount', () => {
  it('accepts valid USDC amount', () => {
    const result = validateAmount('100.50', 6, 1000000000n); // 1000 USDC balance
    expect(result.valid).toBe(true);
    expect(result.amount).toBeDefined();
  });

  it('rejects empty string', () => {
    const result = validateAmount('', 6, 1000000000n);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects whitespace-only string', () => {
    const result = validateAmount('   ', 6, 1000000000n);
    expect(result.valid).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = validateAmount('-10', 6, 1000000000n);
    expect(result.valid).toBe(false);
  });

  it('rejects amount exceeding balance', () => {
    const result = validateAmount('2000', 6, 1000000000n); // Balance is 1000 USDC
    expect(result.valid).toBe(false);
    expect(result.error).toContain('balance');
  });

  it('rejects too many decimals for USDC (6)', () => {
    const result = validateAmount('100.1234567', 6, 1000000000n);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('decimal');
  });

  it('handles WETH 18 decimals', () => {
    const result = validateAmount('0.000000000000000001', 18, 1000000000000000000n);
    expect(result.valid).toBe(true);
  });

  it('rejects zero amount', () => {
    const result = validateAmount('0', 6, 1000000000n);
    expect(result.valid).toBe(false);
  });

  it('rejects non-numeric input', () => {
    const result = validateAmount('abc', 6, 1000000000n);
    expect(result.valid).toBe(false);
  });

  it('accepts amount when no maxBalance provided', () => {
    const result = validateAmount('100', 6);
    expect(result.valid).toBe(true);
  });

  it('accepts amount exactly equal to balance', () => {
    const result = validateAmount('1000', 6, 1000000000n); // Exactly 1000 USDC
    expect(result.valid).toBe(true);
  });

  it('accepts integer amount', () => {
    const result = validateAmount('42', 18, 100000000000000000000n);
    expect(result.valid).toBe(true);
  });

  it('returns parsed bigint amount on success', () => {
    const result = validateAmount('1.5', 6);
    expect(result.valid).toBe(true);
    expect(result.amount).toBe(1500000n);
  });
});

describe('isMorphoApiSupported', () => {
  it('returns true for Ethereum mainnet (1)', () => {
    expect(isMorphoApiSupported(1)).toBe(true);
  });

  it('returns true for Base (8453)', () => {
    expect(isMorphoApiSupported(8453)).toBe(true);
  });

  it('returns false for SEI (1329)', () => {
    expect(isMorphoApiSupported(1329)).toBe(false);
  });

  it('returns false for unknown chain ID', () => {
    expect(isMorphoApiSupported(99999)).toBe(false);
  });

  it('returns false for 0', () => {
    expect(isMorphoApiSupported(0)).toBe(false);
  });
});
