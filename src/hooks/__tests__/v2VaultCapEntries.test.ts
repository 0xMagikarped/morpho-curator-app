/**
 * PR 23 — `decodeIdDataTag` discriminator pin.
 *
 * The hook classifies cap entries by reading the leading `string` field
 * out of the idData bytes ("this" → adapter, "collateralToken" →
 * collateral, "this/marketParams" → market). The discriminator string is
 * exactly what the V2 contract decodes internally; any drift here means
 * an event-bucket goes silent and entries vanish from the UI.
 */
import { describe, it, expect } from 'vitest';
import { decodeIdDataTag } from '../useV2VaultCapEntries';
import { adapterIdData, collateralIdData, marketIdData } from '../../lib/v2/adapterCapUtils';

const ADAPTER = '0x7764a05b0481f1366f8bfee1da29e7339fe47a67' as const;
const COLLATERAL = '0xec1eb7f1d62ff5a8c2b3e69f7c10e1c9f8e3a4b5' as const;
const PARAMS = {
  loanToken: '0xfa2958cb79b0491cc627c1557f441ef849ca8eb1' as `0x${string}`,
  collateralToken: COLLATERAL,
  oracle: '0x0000000000000000000000000000000000000001' as `0x${string}`,
  irm: '0x0000000000000000000000000000000000000002' as `0x${string}`,
  lltv: 625_000_000_000_000_000n,
};

describe('decodeIdDataTag — cap-level discriminator (PR 23)', () => {
  it('adapter idData → "this"', () => {
    expect(decodeIdDataTag(adapterIdData(ADAPTER))).toBe('this');
  });

  it('collateral idData → "collateralToken"', () => {
    expect(decodeIdDataTag(collateralIdData(COLLATERAL))).toBe('collateralToken');
  });

  it('market idData → "this/marketParams"', () => {
    expect(decodeIdDataTag(marketIdData(ADAPTER, PARAMS))).toBe('this/marketParams');
  });

  it('returns null for garbage bytes (no panic)', () => {
    // Empty bytes — no string offset to read.
    expect(decodeIdDataTag('0x')).toBe(null);
  });

  it('the three discriminators are pairwise distinct (no bucket collision)', () => {
    const t1 = decodeIdDataTag(adapterIdData(ADAPTER));
    const t2 = decodeIdDataTag(collateralIdData(COLLATERAL));
    const t3 = decodeIdDataTag(marketIdData(ADAPTER, PARAMS));
    expect(new Set([t1, t2, t3]).size).toBe(3);
  });
});
