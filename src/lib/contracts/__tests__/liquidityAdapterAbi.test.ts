/**
 * PR 17 — pin V2 liquidity-adapter ABI fragments against the SDK.
 *
 * Three mismatches surfaced when the user hit Select in `SetLiquidityDrawer`:
 *
 *   1. `setLiquidityAdapter(address)` — DOESN'T EXIST ON V2. The atomic
 *      setter is `setLiquidityAdapterAndData(address, bytes)`. Calling the
 *      legacy selector hit the fallback → "execution reverted".
 *   2. `liquidityAdapterData()` — getter is actually `liquidityData()`.
 *      Same hand-rolled-vs-SDK shape mismatch.
 *   3. (No mismatch but pinned by completeness) `liquidityAdapter()` reader.
 *
 * On `main` (pre-PR-17) assertion 1 fails (extra function present),
 * assertion 2 fails (wrong name). On branch all pass.
 */
import { describe, it, expect } from 'vitest';
import { metaMorphoV2Abi } from '../metaMorphoV2Abi';
import { vaultV2Abi } from '@morpho-org/blue-sdk-viem';

type AbiFn = { type: string; name?: string };

function hasFn(abi: readonly AbiFn[], name: string) {
  return abi.some((x) => x.type === 'function' && x.name === name);
}

describe('V2 liquidity-adapter ABI alignment with SDK vaultV2Abi (PR 17)', () => {
  it('does NOT declare a standalone setLiquidityAdapter(address)', () => {
    // The legacy fragment was the only one that mismatched on selector —
    // V2 has no function with this name. Calling it hit the fallback.
    expect(hasFn(metaMorphoV2Abi as readonly AbiFn[], 'setLiquidityAdapter')).toBe(false);
    expect(hasFn(vaultV2Abi as readonly AbiFn[], 'setLiquidityAdapter')).toBe(false);
  });

  it('declares setLiquidityAdapterAndData (the actual on-chain setter)', () => {
    expect(hasFn(metaMorphoV2Abi as readonly AbiFn[], 'setLiquidityAdapterAndData')).toBe(true);
    expect(hasFn(vaultV2Abi as readonly AbiFn[], 'setLiquidityAdapterAndData')).toBe(true);
  });

  it('getter is liquidityData(), not liquidityAdapterData()', () => {
    expect(hasFn(metaMorphoV2Abi as readonly AbiFn[], 'liquidityData')).toBe(true);
    expect(hasFn(metaMorphoV2Abi as readonly AbiFn[], 'liquidityAdapterData')).toBe(false);
    expect(hasFn(vaultV2Abi as readonly AbiFn[], 'liquidityData')).toBe(true);
  });

  it('liquidityAdapter() reader is present in both', () => {
    expect(hasFn(metaMorphoV2Abi as readonly AbiFn[], 'liquidityAdapter')).toBe(true);
    expect(hasFn(vaultV2Abi as readonly AbiFn[], 'liquidityAdapter')).toBe(true);
  });
});
