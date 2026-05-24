/**
 * PR 31 — duration parser pin for the V2 Timelocks bulk-edit inputs.
 */
import { describe, it, expect } from 'vitest';
import { parseDurationSeconds, formatDurationSeconds } from '../duration';

describe('parseDurationSeconds (PR 31)', () => {
  it('parses bare integers as seconds', () => {
    expect(parseDurationSeconds('0')).toBe(0n);
    expect(parseDurationSeconds('1')).toBe(1n);
    expect(parseDurationSeconds('86400')).toBe(86400n);
  });

  it('parses the "instant" alias', () => {
    expect(parseDurationSeconds('instant')).toBe(0n);
    expect(parseDurationSeconds('Instant')).toBe(0n);
    expect(parseDurationSeconds('-')).toBe(0n);
    expect(parseDurationSeconds('')).toBe(0n);
  });

  it('parses unit suffixes', () => {
    expect(parseDurationSeconds('30s')).toBe(30n);
    expect(parseDurationSeconds('5m')).toBe(300n);
    expect(parseDurationSeconds('2h')).toBe(7200n);
    expect(parseDurationSeconds('1d')).toBe(86400n);
  });

  it('parses decimal hours / days', () => {
    expect(parseDurationSeconds('1.5h')).toBe(5400n);
    expect(parseDurationSeconds('0.5d')).toBe(43200n);
  });

  it('rejects malformed input', () => {
    expect(parseDurationSeconds('abc')).toBe(null);
    expect(parseDurationSeconds('30 seconds')).toBe(null);
    expect(parseDurationSeconds('1y')).toBe(null);
    expect(parseDurationSeconds('-5')).toBe(null);
  });
});

describe('formatDurationSeconds (PR 31)', () => {
  it('renders 0 as "0"', () => {
    expect(formatDurationSeconds(0n)).toBe('0');
  });

  it('renders seconds for sub-minute', () => {
    expect(formatDurationSeconds(30n)).toBe('30s');
  });

  it('renders minutes for sub-hour', () => {
    expect(formatDurationSeconds(300n)).toBe('5m');
  });

  it('renders hours for sub-day', () => {
    expect(formatDurationSeconds(7200n)).toBe('2h');
  });

  it('renders days otherwise', () => {
    expect(formatDurationSeconds(86400n)).toBe('1d');
    expect(formatDurationSeconds(7n * 86400n)).toBe('7d');
  });

  it('round-trips via parseDurationSeconds for canonical formats', () => {
    for (const v of [0n, 30n, 300n, 7200n, 86400n, 7n * 86400n]) {
      const txt = formatDurationSeconds(v);
      expect(parseDurationSeconds(txt)).toBe(v);
    }
  });
});
