/**
 * PR 22 — pin the `idData` shapes for the three cap levels.
 *
 * `useV2AdapterAllCaps` is the read-side counterpart to PR 14 (write-side
 * idData fix). The cap-map storage key for each level is
 * `keccak256(idData)`, and the idData payload must match the V2 vault's
 * internal `abi.decode(idData, …)` shape exactly:
 *
 *   adapter    : abi.encode("this", adapter)
 *   collateral : abi.encode("collateralToken", token)
 *   market     : abi.encode("this/marketParams", adapter, MarketParams)
 *
 * Any drift here resurfaces the "reads return 0 even though caps are set"
 * bug PR 16 closed. The test compares the three helpers' output against
 * literal `encodeAbiParameters` calls.
 */
import { describe, it, expect } from 'vitest';
import { encodeAbiParameters } from 'viem';
import { adapterIdData, collateralIdData, marketIdData } from '../useV2AdapterAllCaps';

const ADAPTER = '0x7764a05b0481f1366f8bfee1da29e7339fe47a67' as const;
// Lowercase to avoid viem's checksum check — we're only exercising the
// abi-encoding shape, not the address validation pathway.
const COLLATERAL = '0xec1eb7f1d62ff5a8c2b3e69f7c10e1c9f8e3a4b5' as const;
const PARAMS = {
  loanToken: '0xfa2958cb79b0491cc627c1557f441ef849ca8eb1' as `0x${string}`,
  collateralToken: COLLATERAL,
  oracle: '0x0000000000000000000000000000000000000001' as `0x${string}`,
  irm: '0x0000000000000000000000000000000000000002' as `0x${string}`,
  lltv: 625_000_000_000_000_000n, // 62.5%
};

describe('cap idData shapes (PR 22)', () => {
  it('adapter-level idData = abi.encode("this", adapter)', () => {
    const expected = encodeAbiParameters(
      [{ type: 'string' }, { type: 'address' }],
      ['this', ADAPTER],
    );
    expect(adapterIdData(ADAPTER)).toBe(expected);
  });

  it('collateral-level idData = abi.encode("collateralToken", token)', () => {
    const expected = encodeAbiParameters(
      [{ type: 'string' }, { type: 'address' }],
      ['collateralToken', COLLATERAL],
    );
    expect(collateralIdData(COLLATERAL)).toBe(expected);
  });

  it('market-level idData = abi.encode("this/marketParams", adapter, MarketParams)', () => {
    const expected = encodeAbiParameters(
      [
        { type: 'string' },
        { type: 'address' },
        {
          type: 'tuple',
          components: [
            { type: 'address', name: 'loanToken' },
            { type: 'address', name: 'collateralToken' },
            { type: 'address', name: 'oracle' },
            { type: 'address', name: 'irm' },
            { type: 'uint256', name: 'lltv' },
          ],
        },
      ],
      ['this/marketParams', ADAPTER, PARAMS],
    );
    expect(marketIdData(ADAPTER, PARAMS)).toBe(expected);
  });

  it('the three levels produce DIFFERENT idData for the same token (sanity)', () => {
    // Adapter and collateral both encode a (string, address) tuple — the
    // string tag is what differentiates them. If a future refactor accidentally
    // shared the tag, they'd collide and edits to one would silently overwrite
    // the other.
    expect(adapterIdData(COLLATERAL)).not.toBe(collateralIdData(COLLATERAL));
  });
});
