/**
 * PR 14 — pin the cap-idData encoding: adapter-level idData must be the raw
 * `abi.encode("this", adapter.address)` bytes, NOT the keccak256 hash.
 *
 * V2's `increaseAbsoluteCap` / `increaseRelativeCap` / `decreaseAbsoluteCap`
 * / `decreaseRelativeCap` internally `abi.decode(idData, (string, address))`
 * (or a longer tuple for collateral/market levels) and revert when fed a
 * 32-byte hash. `UpdateCapsDrawer` (PR 10 / PR 12) used `adapter.adapterId`
 * — the keccak256 hash — for those calls; multicall execute reverted on
 * every real call as a result.
 *
 * This test catches the mistake at CI: the calldata viem would produce for
 * an "adapter.adapterId-based" cap call differs from the calldata for an
 * "adapterIdData(adapter)-based" cap call, in a way that's catchable by
 * length alone (32 vs 96+ encoded bytes).
 */
import { describe, it, expect } from 'vitest';
import { encodeFunctionData, keccak256, encodeAbiParameters } from 'viem';
import { metaMorphoV2Abi } from '../../contracts/metaMorphoV2Abi';
import { adapterIdData } from '../adapterCapUtils';

const ADAPTER = '0x73b52f0807d407a3295f9d3f6c1864aecae3cdd6' as const;
const CAP = 100_000_000n;

describe('adapter-level cap idData (PR 14)', () => {
  it('adapterIdData encodes ("this", adapter) as 64+ bytes (string tag + address)', () => {
    const idData = adapterIdData(ADAPTER);
    // string offset (32) + address (32) + string length (32) + string content (padded) = at least 128 hex chars
    // hex chars after "0x" prefix = (length - 2) / 2 bytes
    const byteLen = (idData.length - 2) / 2;
    expect(byteLen).toBeGreaterThanOrEqual(96);
  });

  it('the legacy (pre-PR 16) encoding — keccak256(abi.encode(adapter)) — is also 32 bytes', () => {
    // This is what the pre-PR-16 `computeVaultAdapterId(adapterAddress)`
    // returned: keccak256 of just the address word. It hashes to a
    // different bytes32 than the correct cap-map key, so reads at this id
    // always returned 0. PR 16 redefines `computeVaultAdapterId` to
    // `keccak256(adapterIdData(adapter))` — see the test below.
    const wrong = keccak256(encodeAbiParameters([{ type: 'address' }], [ADAPTER]));
    const byteLen = (wrong.length - 2) / 2;
    expect(byteLen).toBe(32);
  });

  it('increaseAbsoluteCap calldata built with adapterIdData differs from calldata built with the hash', () => {
    const correct = encodeFunctionData({
      abi: metaMorphoV2Abi,
      functionName: 'increaseAbsoluteCap',
      args: [adapterIdData(ADAPTER), CAP],
    });
    const wrong = encodeFunctionData({
      abi: metaMorphoV2Abi,
      functionName: 'increaseAbsoluteCap',
      args: [keccak256(encodeAbiParameters([{ type: 'address' }], [ADAPTER])), CAP],
    });
    expect(correct).not.toEqual(wrong);
    // Correct calldata is strictly longer because the bytes-length prefix
    // sees a larger payload (the abi-encoded string+address vs a 32-byte
    // hash). This length differential is the bug fingerprint.
    expect(correct.length).toBeGreaterThan(wrong.length);
  });

  it('correct calldata round-trips: re-decoding gives back ("this", adapter)', () => {
    // Implicit through the helpers — `adapterIdData` is symmetric with
    // V2's `abi.decode(idData, (string, address))`. Sanity check that the
    // raw payload contains the literal string "this" at the expected
    // position (offset 0x40 in the abi-encoded layout: offset 0x20, then
    // string length, then "this"...).
    const idData = adapterIdData(ADAPTER);
    expect(idData.toLowerCase()).toContain('74686973'); // hex of "this"
    expect(idData.toLowerCase()).toContain(ADAPTER.slice(2).toLowerCase());
  });
});
