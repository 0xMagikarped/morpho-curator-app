/**
 * PR 1 — audit finding D5: custom-error ABI coverage.
 *
 * Pre-fix this suite FAILS (the local ABIs had 0 `type:'error'` entries, so
 * encode/decodeErrorResult cannot resolve a single named Morpho revert).
 * Post-fix it passes: every spread-in fragment round-trips and the named
 * errors the audit called out are present.
 */
import { describe, it, expect } from 'vitest';
import { encodeErrorResult, decodeErrorResult, type Abi } from 'viem';

/** The `type: 'error'` members of an ABI (viem doesn't export this directly). */
type AbiErrorItem = Extract<Abi[number], { type: 'error' }>;

import { metaMorphoV1Abi, publicAllocatorAbi } from '../abis';
import {
  metaMorphoV2Abi,
  v1VaultAdapterAbi,
  v1MarketAdapterAbi,
} from '../metaMorphoV2Abi';
import { moolahVaultAbi } from '../moolahAbis';
import { vaultV2RegistryAbi } from '../vaultV2RegistryAbi';

/** Build zeroed args matching an error fragment's input types. */
function zeroArg(type: string): unknown {
  if (type.endsWith('[]')) return [];
  if (type === 'address') return '0x0000000000000000000000000000000000000000';
  if (type === 'bool') return false;
  if (type === 'string') return '';
  if (type === 'bytes') return '0x';
  if (/^bytes\d+$/.test(type)) {
    const n = Number(type.slice(5));
    return `0x${'0'.repeat(n * 2)}`;
  }
  if (/^u?int\d*$/.test(type)) return 0n;
  throw new Error(`unhandled error-arg type: ${type}`);
}

function errorsOf(abi: Abi): AbiErrorItem[] {
  return abi.filter((e): e is AbiErrorItem => e.type === 'error');
}

/** [label, abi, expected exact error count] */
const ABIS: ReadonlyArray<readonly [string, Abi, number]> = [
  ['metaMorphoV1Abi', metaMorphoV1Abi as unknown as Abi, 55],
  ['metaMorphoV2Abi', metaMorphoV2Abi as unknown as Abi, 36],
  ['publicAllocatorAbi', publicAllocatorAbi as unknown as Abi, 12],
  ['v1VaultAdapterAbi', v1VaultAdapterAbi as unknown as Abi, 9],
  ['v1MarketAdapterAbi', v1MarketAdapterAbi as unknown as Abi, 16],
  ['moolahVaultAbi', moolahVaultAbi as unknown as Abi, 54],
];

describe('custom-error ABI coverage (audit D5)', () => {
  it.each(ABIS)('%s exposes exactly %d→ the expected custom errors', (_label, abi, count) => {
    expect(errorsOf(abi).length).toBe(count);
  });

  it('metaMorphoV1Abi contains the audit-named errors', () => {
    const names = new Set(errorsOf(metaMorphoV1Abi as unknown as Abi).map((e) => e.name));
    // Verbatim names present in @morpho-org/blue-sdk-viem `metaMorphoAbi`.
    for (const n of ['NoPendingValue', 'AboveMaxTimelock', 'AlreadyPending', 'MarketNotCreated']) {
      expect(names.has(n)).toBe(true);
    }
    // "AboveAbsoluteCap" was an illustrative label in the audit, NOT a real
    // Morpho error — it must NOT have been invented.
    expect(names.has('AboveAbsoluteCap')).toBe(false);
  });

  it('moolahVaultAbi carries the fork-specific governance errors', () => {
    const names = new Set(errorsOf(moolahVaultAbi as unknown as Abi).map((e) => e.name));
    for (const n of ['MarketNotCreated', 'SupplyCapExceeded', 'AllCapsReached', 'AlreadyPending']) {
      expect(names.has(n)).toBe(true);
    }
  });

  it.each(ABIS)('%s: every error encodes→decodes (name + args round-trip)', (_label, abi) => {
    for (const err of errorsOf(abi)) {
      const args = (err.inputs ?? []).map((i) => zeroArg(i.type));
      const data = encodeErrorResult({
        abi,
        errorName: err.name,
        args: args.length ? args : undefined,
      });
      const decoded = decodeErrorResult({ abi, data });
      // Name must resolve to the exact fragment.
      expect(decoded.errorName).toBe(err.name);
      expect((decoded.args ?? []).length).toBe(args.length);
      // Representation-agnostic value check: re-encoding the decoded args must
      // reproduce the original calldata bit-for-bit (viem may surface narrow
      // ints as `number` vs the `bigint` we fed in — re-encode normalizes that).
      const reencoded = encodeErrorResult({
        abi,
        errorName: decoded.errorName,
        args: decoded.args && decoded.args.length ? decoded.args : undefined,
      });
      expect(reencoded).toBe(data);
    }
  });

  it('decodeErrorResult does NOT silently swallow an unknown selector', () => {
    // 0xdeadbeef matches no error in any ABI → viem must throw, not return undefined.
    expect(() =>
      decodeErrorResult({ abi: metaMorphoV1Abi as unknown as Abi, data: '0xdeadbeef' }),
    ).toThrow();
  });

  it('vaultV2RegistryAbi carries the V2 error set so registry reverts decode (PR 7)', () => {
    // PR 1 left this ABI error-free with a doc-note; PR 7 spread in
    // MORPHO_METAMORPHO_V2_ERRORS so `DataNotTimelocked` & co. decode to names.
    const names = new Set(errorsOf(vaultV2RegistryAbi as unknown as Abi).map((e) => e.name));
    expect(names.has('DataNotTimelocked')).toBe(true);
    expect(names.size).toBeGreaterThanOrEqual(36);
  });
});
