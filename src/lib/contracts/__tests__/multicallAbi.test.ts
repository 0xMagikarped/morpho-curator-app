/**
 * PR 13 — pin `metaMorphoV2Abi.multicall` against the authoritative
 * `@morpho-org/blue-sdk-viem` shape.
 *
 * The V2 vault's `multicall(bytes[])` returns VOID. A hand-written ABI that
 * declares `outputs: [{ type: 'bytes[]' }]` (the common OpenZeppelin pattern)
 * causes every multicall write to error with "The contract function
 * 'multicall' returned no data ('0x')" because viem tries to decode `bytes[]`
 * from an empty response.
 *
 * On `main` (pre-fix) the outputs array has one element → assertions fail.
 * On branch outputs is empty → pass. If `blue-sdk-viem` ever changes the
 * shape, the SDK-comparison assertion catches it before we ship.
 */
import { describe, it, expect } from 'vitest';
import { metaMorphoV2Abi } from '../metaMorphoV2Abi';
import { vaultV2Abi } from '@morpho-org/blue-sdk-viem';

type AbiFn = { type: string; name?: string };

function findFn(abi: readonly AbiFn[], name: string) {
  return abi.find((x) => x.type === 'function' && x.name === name);
}

describe('metaMorphoV2Abi.multicall — V2 vault returns void (PR 13)', () => {
  it('our multicall declaration matches the SDK shape (outputs are empty)', () => {
    const ours = findFn(metaMorphoV2Abi as readonly AbiFn[], 'multicall') as
      | { outputs: unknown[]; inputs: unknown[] }
      | undefined;
    expect(ours).toBeDefined();
    expect(ours!.outputs).toEqual([]);
    expect(ours!.inputs).toHaveLength(1);
  });

  it('matches `@morpho-org/blue-sdk-viem` `vaultV2Abi.multicall` exactly', () => {
    const ours = findFn(metaMorphoV2Abi as readonly AbiFn[], 'multicall') as unknown as {
      inputs: { type: string }[];
      outputs: unknown[];
    };
    const sdk = findFn(vaultV2Abi as readonly AbiFn[], 'multicall') as unknown as {
      inputs: { type: string }[];
      outputs: unknown[];
    };
    expect(ours.outputs.length).toBe(sdk.outputs.length);
    expect(ours.inputs.map((i) => i.type)).toEqual(sdk.inputs.map((i) => i.type));
  });
});
