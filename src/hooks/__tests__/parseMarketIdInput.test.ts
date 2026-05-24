/**
 * PR 19 — `parseMarketIdInput`: forgiving parser for the MarketBrowser
 * lookup-by-ID search box. Pure — no React.
 *
 * Accepts:
 *   - `0x` + 64 hex (canonical)
 *   - 64 hex with no prefix (user pasted from an explorer)
 * Rejects:
 *   - Empty / whitespace
 *   - Wrong length (≠ 64 hex chars after stripping `0x`)
 *   - Non-hex characters
 */
import { describe, it, expect } from 'vitest';
import { parseMarketIdInput } from '../useMarketLookup';

const ID = 'a83547357ef4418d2d50efe20bb50d608ecb61a3f0e57048be49a7f56ebb2c01';

describe('parseMarketIdInput (PR 19)', () => {
  it('accepts a canonical 0x-prefixed market ID', () => {
    expect(parseMarketIdInput(`0x${ID}`)).toBe(`0x${ID}`);
  });

  it('accepts a 64-hex string with no 0x prefix and adds it', () => {
    expect(parseMarketIdInput(ID)).toBe(`0x${ID}`);
  });

  it('accepts mixed case + leading/trailing whitespace and normalizes lowercase', () => {
    expect(parseMarketIdInput(`  0x${ID.toUpperCase()}  `)).toBe(`0x${ID}`);
  });

  it('rejects the empty string', () => {
    expect(parseMarketIdInput('')).toBe(null);
    expect(parseMarketIdInput('   ')).toBe(null);
  });

  it('rejects too-short hex (truncated paste)', () => {
    expect(parseMarketIdInput(ID.slice(0, 63))).toBe(null);
    expect(parseMarketIdInput(`0x${ID.slice(0, 63)}`)).toBe(null);
  });

  it('rejects too-long hex', () => {
    expect(parseMarketIdInput(ID + 'ab')).toBe(null);
  });

  it('rejects non-hex characters', () => {
    expect(parseMarketIdInput(ID.slice(0, 63) + 'z')).toBe(null);
  });

  it('rejects bare addresses (40 hex)', () => {
    expect(parseMarketIdInput('0x73b52f0807d407a3295f9d3f6c1864aecae3cdd6')).toBe(null);
  });
});
