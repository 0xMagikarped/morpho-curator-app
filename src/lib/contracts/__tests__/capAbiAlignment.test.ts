/**
 * PR 15 — pin V2 cap functions (mutators + getters) against
 * `@morpho-org/blue-sdk-viem` `vaultV2Abi`.
 *
 * Our hand-written `metaMorphoV2Abi` had `cap: uint128` and `uint128`
 * return types where the on-chain contract uses `uint256`. Selectors are
 * computed from the full signature, so `increaseAbsoluteCap(bytes,uint128)`
 * and `increaseAbsoluteCap(bytes,uint256)` are *different* selectors. Our
 * (wrong) selector found no match on-chain → fallback revert with no data
 * → viem reported "Execution reverted for an unknown reason."
 *
 * On `main` these 6 assertions fail. On branch they pass.
 *
 * This test extends the pattern PR 13 started for `multicall`: any V2
 * function we hand-roll must equal the SDK shape, otherwise selectors
 * diverge or return-decoding silently truncates.
 */
import { describe, it, expect } from 'vitest';
import { toFunctionSelector } from 'viem';
import { metaMorphoV2Abi } from '../metaMorphoV2Abi';
import { vaultV2Abi } from '@morpho-org/blue-sdk-viem';

type AbiFn = { type: string; name?: string };

function getFn(abi: readonly AbiFn[], name: string) {
  const f = abi.find((x) => x.type === 'function' && x.name === name);
  if (!f) throw new Error(`function ${name} not in ABI`);
  return f;
}

const CAP_MUTATORS = [
  'increaseAbsoluteCap',
  'decreaseAbsoluteCap',
  'increaseRelativeCap',
  'decreaseRelativeCap',
] as const;

describe('V2 cap functions — ABI alignment with SDK vaultV2Abi (PR 15)', () => {
  for (const name of CAP_MUTATORS) {
    it(`${name} input types match SDK (`+
       `selector identity)`, () => {
      const ours = getFn(metaMorphoV2Abi as readonly AbiFn[], name) as unknown as
        { inputs: { type: string }[] };
      const sdk = getFn(vaultV2Abi as readonly AbiFn[], name) as unknown as
        { inputs: { type: string }[] };
      expect(ours.inputs.map((i) => i.type)).toEqual(sdk.inputs.map((i) => i.type));

      // Selectors must match — same name + same input types.
      const ourSel = toFunctionSelector(
        `${name}(${ours.inputs.map((i) => i.type).join(',')})`,
      );
      const sdkSel = toFunctionSelector(
        `${name}(${sdk.inputs.map((i) => i.type).join(',')})`,
      );
      expect(ourSel).toBe(sdkSel);
    });
  }

  for (const name of ['absoluteCap', 'relativeCap'] as const) {
    it(`${name} output type is uint256, matching SDK`, () => {
      const ours = getFn(metaMorphoV2Abi as readonly AbiFn[], name) as unknown as
        { outputs: { type: string }[] };
      const sdk = getFn(vaultV2Abi as readonly AbiFn[], name) as unknown as
        { outputs: { type: string }[] };
      expect(ours.outputs.map((o) => o.type)).toEqual(sdk.outputs.map((o) => o.type));
      expect(ours.outputs[0].type).toBe('uint256');
    });
  }
});
