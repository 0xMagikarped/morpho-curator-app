/**
 * PR 16 — pin `computeVaultAdapterId(adapter)` to the cap-map storage key.
 *
 * The V2 vault keys `absoluteCap`/`relativeCap`/`allocation` on
 * `keccak256(idData)`, where adapter-level `idData = abi.encode("this",
 * adapter)`. PR 14 fixed the WRITE side by switching cap mutator calldata
 * to use `adapterIdData(adapter)`; the READ side
 * (`fetchAdapterCaps(vault, computeVaultAdapterId(adapter))`) was still
 * computing `keccak256(abi.encode(adapter))` — a different hash that no
 * cap slot is keyed by, so the UI always showed "Not set" even after a
 * successful execute.
 *
 * This test asserts the read-side hash matches the write-side payload
 * hashed, so a future refactor of either side can't silently desync.
 *
 * Verified on-chain (tx 0x00a14a7…ac11): for adapter 0x7764…7a67 on vault
 * 0x1ac19bec…fa5a, the storage key that returns the user's set caps is
 * `0x17ea3483…96c5` — exactly what `keccak256(adapterIdData(adapter))`
 * produces.
 */
import { describe, it, expect } from 'vitest';
import { keccak256 } from 'viem';
import { computeVaultAdapterId } from '../adapterUtils';
import { adapterIdData } from '../adapterCapUtils';

const ADAPTER = '0x7764a05b0481f1366f8bfee1da29e7339fe47a67' as const;
// The actual on-chain cap-map key, taken from a live read (rpc.ankr.com/xdc
// vault 0x1ac19bec... → absoluteCap(0x17ea3483…96c5) = 100_000_000_000_000).
const ON_CHAIN_KEY = '0x17ea3483f81bd89bceead586ea31c8d09315c69a9498b20abe661426d48a96c5';

describe('computeVaultAdapterId — adapter-level cap-map storage key (PR 16)', () => {
  it('returns keccak256(adapterIdData(adapter)) — the V2 cap-map storage key', () => {
    expect(computeVaultAdapterId(ADAPTER)).toBe(keccak256(adapterIdData(ADAPTER)));
  });

  it('matches the on-chain key observed for a real successful cap write', () => {
    // The grounding fixture: this adapter's caps were set via a Safe tx
    // and read back at exactly this storage key. If this assertion ever
    // fails, the read-write pairing has drifted again.
    expect(computeVaultAdapterId(ADAPTER).toLowerCase()).toBe(ON_CHAIN_KEY.toLowerCase());
  });
});
