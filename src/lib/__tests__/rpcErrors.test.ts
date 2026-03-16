import { describe, it, expect } from 'vitest';
import { classifyRpcError, getFinality, getRequiredConfirmations } from '../utils/rpcErrors';

describe('classifyRpcError', () => {
  it('classifies rate limit errors (code 429) as retryable', () => {
    const result = classifyRpcError({ code: 429, message: 'rate limit exceeded' });
    expect(result.type).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('classifies "rate" in message as rate_limit', () => {
    const result = classifyRpcError({ message: 'rate limited' });
    expect(result.type).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('classifies "too many" in message as rate_limit', () => {
    const result = classifyRpcError({ message: 'too many requests' });
    expect(result.type).toBe('rate_limit');
    expect(result.retryable).toBe(true);
  });

  it('classifies ECONNREFUSED as retryable network error', () => {
    const result = classifyRpcError({ message: 'ECONNREFUSED' });
    expect(result.type).toBe('network');
    expect(result.retryable).toBe(true);
  });

  it('classifies ETIMEDOUT as retryable network error', () => {
    const result = classifyRpcError({ message: 'ETIMEDOUT' });
    expect(result.type).toBe('network');
    expect(result.retryable).toBe(true);
  });

  it('classifies fetch failed as retryable network error', () => {
    const result = classifyRpcError({ message: 'fetch failed' });
    expect(result.type).toBe('network');
    expect(result.retryable).toBe(true);
  });

  it('classifies code -32603 as non-retryable contract error', () => {
    const result = classifyRpcError({ code: -32603, message: 'execution reverted' });
    expect(result.type).toBe('contract');
    expect(result.retryable).toBe(false);
  });

  it('classifies "revert" message as contract error', () => {
    const result = classifyRpcError({ message: 'execution reverted: Ownable: caller is not the owner' });
    expect(result.type).toBe('contract');
    expect(result.retryable).toBe(false);
  });

  it('classifies unknown errors as non-retryable', () => {
    const result = classifyRpcError({ message: 'something weird' });
    expect(result.type).toBe('unknown');
    expect(result.retryable).toBe(false);
  });

  it('handles null error gracefully', () => {
    const result = classifyRpcError(null);
    expect(result).toBeDefined();
    expect(result.type).toBe('unknown');
    expect(result.retryable).toBe(false);
  });

  it('handles undefined error gracefully', () => {
    const result = classifyRpcError(undefined);
    expect(result).toBeDefined();
    expect(result.retryable).toBe(false);
  });

  it('uses shortMessage fallback', () => {
    const result = classifyRpcError({ shortMessage: 'ECONNREFUSED' });
    expect(result.type).toBe('network');
  });
});

describe('getFinality', () => {
  it('returns finalized for Ethereum when confirmations >= 12', () => {
    expect(getFinality(12, 1)).toBe('finalized');
    expect(getFinality(100, 1)).toBe('finalized');
  });

  it('returns confirming for Ethereum with 1-11 confirmations', () => {
    expect(getFinality(1, 1)).toBe('confirming');
    expect(getFinality(11, 1)).toBe('confirming');
  });

  it('returns pending for 0 confirmations', () => {
    expect(getFinality(0, 1)).toBe('pending');
  });

  it('returns finalized for SEI with 1 confirmation (instant finality)', () => {
    expect(getFinality(1, 1329)).toBe('finalized');
  });

  it('returns finalized for Base with 120 confirmations', () => {
    expect(getFinality(120, 8453)).toBe('finalized');
  });

  it('uses default depth (12) for unknown chains', () => {
    expect(getFinality(12, 99999)).toBe('finalized');
    expect(getFinality(11, 99999)).toBe('confirming');
  });
});

describe('getRequiredConfirmations', () => {
  it('returns 12 for Ethereum mainnet', () => {
    expect(getRequiredConfirmations(1)).toBe(12);
  });

  it('returns 120 for Base', () => {
    expect(getRequiredConfirmations(8453)).toBe(120);
  });

  it('returns 1 for SEI', () => {
    expect(getRequiredConfirmations(1329)).toBe(1);
  });

  it('returns 120 for Arbitrum', () => {
    expect(getRequiredConfirmations(42161)).toBe(120);
  });

  it('returns 12 as default for unknown chains', () => {
    expect(getRequiredConfirmations(99999)).toBe(12);
  });
});
