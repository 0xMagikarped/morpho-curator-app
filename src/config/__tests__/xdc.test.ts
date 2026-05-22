/**
 * Feature — XDC Network (chainId 50), Morpho Vault V2 only.
 *
 * On `main` `CHAIN_CONFIGS[50]` is undefined → every test here fails.
 * On `feat/xdc-network` all pass. The V2-only invariant (test 2 + 4) is the
 * load-bearing assertion: XDC must be creatable as V2 and never as V1.
 */
import { describe, it, expect } from 'vitest';
import {
  CHAIN_CONFIGS,
  getChainConfig,
  getChainProtocol,
  isChainDeployed,
} from '../chains';

const XDC = 50;

// Addresses supplied by the user and verified on-chain via eth_getCode
// (XDC RPC, chainId 0x32, 2026-05-22).
const EXPECTED = {
  morphoBlue: '0xEa49B0fE898aF913A3826F9f462eE2cDcb854fD9',
  v2Factory: '0x227544d6989cD15c05AAB6dde4F29523dcfdbe2B',
  v2AdapterRegistry: '0x79A8C4e9E502C1867cAf2E7202f0C6b89aaCd5c1',
  marketV1AdapterV2Factory: '0x5C00c99F2235439725417E9f037B7D38FfF35d31',
  adaptiveCurveIrm: '0x15c7312B0f26aa0AA70B24a0D2AF87B9e7D614A0',
  oracleV2Factory: '0x6Ad93a3aA829514473D3DF67382894A76c7283B4',
  wxdc: '0x951857744785E80e2De051c32EE7b25f9c458C42',
} as const;

describe('XDC Network chain config (chainId 50)', () => {
  const xdc = getChainConfig(XDC);

  it('is registered and morpho-flavoured', () => {
    expect(xdc).toBeDefined();
    expect(CHAIN_CONFIGS[XDC]).toBe(xdc);
    expect(xdc?.chainId).toBe(50);
    expect(xdc?.protocol).toBe('morpho');
    expect(xdc?.apiSupported).toBe(false); // XDC is RPC-only — not on Morpho GraphQL
    expect(xdc?.deployed).toBe(true);
    expect(isChainDeployed(XDC)).toBe(true);
    expect(getChainProtocol(XDC)).toBe('morpho');
  });

  it('V2-ONLY invariant: a v2 factory exists and there is NO v1 factory', () => {
    expect(xdc?.vaultFactories.v2).toBe(EXPECTED.v2Factory);
    expect(xdc?.vaultFactories.v1).toBeUndefined();
  });

  it('carries the exact verified Morpho V2 stack addresses', () => {
    expect(xdc?.morphoBlue).toBe(EXPECTED.morphoBlue);
    expect(xdc?.periphery.v2AdapterRegistry).toBe(EXPECTED.v2AdapterRegistry);
    expect(xdc?.periphery.morphoMarketV1AdapterV2Factory).toBe(
      EXPECTED.marketV1AdapterV2Factory,
    );
    expect(xdc?.periphery.adaptiveCurveIrm).toBe(EXPECTED.adaptiveCurveIrm);
    expect(xdc?.periphery.oracleV2Factory).toBe(EXPECTED.oracleV2Factory);
  });

  it('create-vault wizard gating: XDC qualifies for V2, is excluded from V1', () => {
    // Mirrors the predicate in src/components/vault/steps/ChainAssetStep.tsx:20
    const qualifies = (isV2: boolean) =>
      isV2 ? !!xdc?.vaultFactories.v2 : !!xdc?.vaultFactories.v1;
    expect(qualifies(true)).toBe(true); // V2 flow includes XDC
    expect(qualifies(false)).toBe(false); // V1 flow excludes XDC
  });

  it('native token is XDC with a valid 20-byte wrapped (WXDC) address', () => {
    expect(xdc?.nativeToken.symbol).toBe('XDC');
    expect(xdc?.nativeToken.decimals).toBe(18);
    expect(xdc?.nativeToken.wrapped).toBe(EXPECTED.wxdc);
    expect(xdc?.nativeToken.wrapped).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
