/**
 * PR 30 — BigInt-safe serializer round-trip pin.
 *
 * `JSON.stringify(0n)` throws. Every persisted query touches bigints
 * somewhere (caps, allocations, balances, timelock durations). The
 * persister tags bigints with a `__BI__<decimal>` sentinel on write and
 * decodes back to native bigint on read. Drift here would mean either a
 * runtime throw on persistence OR — worse — bigints silently becoming
 * strings on rehydration, breaking equality checks downstream.
 */
import { describe, it, expect } from 'vitest';
import { serialize, deserialize } from '../queryPersister';

describe('queryPersister BigInt-safe serialize/deserialize (PR 30)', () => {
  it('round-trips a top-level bigint', () => {
    const v = 100_000_000_000_000n;
    expect(deserialize(serialize(v))).toBe(v);
  });

  it('round-trips zero and negative bigints', () => {
    expect(deserialize(serialize(0n))).toBe(0n);
    expect(deserialize(serialize(-42n))).toBe(-42n);
  });

  it('round-trips MAX_UINT256-shaped values without precision loss', () => {
    const v = (1n << 256n) - 1n;
    expect(deserialize(serialize(v))).toBe(v);
  });

  it('preserves bigints nested in objects + arrays', () => {
    const v = {
      vault: '0x3F4ed284A5Be70C34a28743AEE62d28A6a581a2f',
      caps: { abs: 100_000_000_000_000n, rel: 10n ** 18n },
      allocations: [0n, 1n, 5_870_000n * 10n ** 6n],
      meta: { ts: 1700000000n, name: 'Yield Network USDC' },
    };
    const out = deserialize<typeof v>(serialize(v));
    expect(out.caps.abs).toBe(v.caps.abs);
    expect(out.caps.rel).toBe(v.caps.rel);
    expect(out.allocations).toEqual(v.allocations);
    expect(out.meta.ts).toBe(v.meta.ts);
    expect(out.meta.name).toBe(v.meta.name);
    expect(out.vault).toBe(v.vault);
  });

  it('does NOT mistake a real string starting with the BI tag as a bigint', () => {
    // Defence against payload poisoning if some upstream value happens to
    // begin with the sentinel prefix. The reviver `try`s the BigInt parse;
    // if it doesn't decode cleanly it should fall back to the string.
    const out = deserialize<{ x: string | bigint }>(serialize({ x: '__BI__not-a-number' }));
    // The reviver tries BigInt('not-a-number') which throws, so the
    // string survives unchanged.
    expect(out.x).toBe('__BI__not-a-number');
  });

  it('serializes to plain JSON (parsable by any consumer)', () => {
    const v = { cap: 100n, name: 'ok' };
    const s = serialize(v);
    expect(() => JSON.parse(s)).not.toThrow();
  });
});
