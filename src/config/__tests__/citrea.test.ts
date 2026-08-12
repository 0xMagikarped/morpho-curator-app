/**
 * Citrea (chainId 4114) — Bitcoin ZK rollup, Morpho Blue + Vault V2 only.
 *
 * Every address here was verified against the live chain via the Alchemy
 * `citrea-mainnet` endpoint (2026-08) rather than copied from docs:
 *   - Morpho Blue: 15.5KB of code, `owner()` = 0x411e9b09…4298
 *   - AdaptiveCurveIrm: `MORPHO()` returns the Morpho Blue address
 *   - OracleV2Factory: answers `isMorphoChainlinkOracleV2`
 *   - VaultV2Factory: answers `isVaultV2`
 *   - MorphoMarketV1AdapterV2Factory: `morpho()` returns the Blue address
 *   - MorphoRegistry: answers `isInRegistry`
 *
 * The non-obvious invariants (proxy-only, 10k log window, non-zero deployment
 * block, no multicall3) are each load-bearing and each has a test below —
 * getting any of them wrong degrades silently rather than failing loudly.
 */
import { describe, it, expect } from 'vitest';
import { CHAIN_CONFIGS, getChainConfig, getChainProtocol, isChainDeployed } from '../chains';
import { isProxiedChain, isProxyOnlyChain } from '../rpcProxy';
import { getLogWindowConfig, isLogRangeLimited } from '../../lib/vault/proposals';
import { ALCHEMY_SLUGS } from '../../../api/_upstream.js';

const CITREA = 4114;

const EXPECTED = {
  morphoBlue: '0x99D31FEcc885204b4136ea5D2ef2a37F36E3AeB8',
  v2Factory: '0x3137e22F379A1Df004DDb10EBbecF1CfD8CbC0e2',
  v2AdapterRegistry: '0x83dd673Fa2C4DE16cAAF0e6109845EeEbb6d1E00',
  marketV1AdapterV2Factory: '0x01Ff31888b1FB51f951273C409f653Dba5Ce8200',
  adaptiveCurveIrm: '0x723E35C4CBb5B91669b62F130f2aC12931DF8049',
  oracleV2Factory: '0xFd32e705E2bc6e716e2522Df0391BF26DfbADBAB',
  wcbtc: '0x3100000000000000000000000000000000000006',
  ctUSD: '0x8d82c4e3c936c7b5724a382a9c5a4e6eb7ab6d5d',
  /** Morpho Blue's first block with code, binary-searched on an archive node. */
  deploymentBlock: 2_528_230,
} as const;

describe('Citrea chain config (chainId 4114)', () => {
  const citrea = getChainConfig(CITREA);

  it('is registered, deployed, and morpho-flavoured', () => {
    expect(citrea).toBeDefined();
    expect(CHAIN_CONFIGS[CITREA]).toBe(citrea);
    expect(citrea?.chainId).toBe(4114);
    expect(citrea?.protocol).toBe('morpho');
    expect(citrea?.deployed).toBe(true);
    expect(isChainDeployed(CITREA)).toBe(true);
    expect(getChainProtocol(CITREA)).toBe('morpho');
  });

  it('is NOT marked API-supported — blue-api indexes 14 chains and Citrea is not one', () => {
    expect(citrea?.apiSupported).toBe(false);
  });

  it('V2-ONLY invariant: a v2 factory exists and there is NO v1 factory', () => {
    // All six CreateVaultV2 events on Citrea are V2; Morpho publishes no
    // MetaMorpho factory for this chain. Claiming a v1 factory would put
    // Citrea in the V1 create-vault flow, which would revert on submit.
    expect(citrea?.vaultFactories.v2).toBe(EXPECTED.v2Factory);
    expect(citrea?.vaultFactories.v1).toBeUndefined();
  });

  it('carries the exact on-chain-verified Morpho V2 stack addresses', () => {
    expect(citrea?.morphoBlue).toBe(EXPECTED.morphoBlue);
    expect(citrea?.periphery.v2AdapterRegistry).toBe(EXPECTED.v2AdapterRegistry);
    expect(citrea?.periphery.morphoMarketV1AdapterV2Factory).toBe(
      EXPECTED.marketV1AdapterV2Factory,
    );
    expect(citrea?.periphery.adaptiveCurveIrm).toBe(EXPECTED.adaptiveCurveIrm);
    expect(citrea?.periphery.oracleV2Factory).toBe(EXPECTED.oracleV2Factory);
  });

  it('create-vault wizard gating: qualifies for V2, excluded from V1', () => {
    // Mirrors the predicate in src/components/vault/steps/ChainAssetStep.tsx
    const qualifies = (isV2: boolean) =>
      isV2 ? !!citrea?.vaultFactories.v2 : !!citrea?.vaultFactories.v1;
    expect(qualifies(true)).toBe(true);
    expect(qualifies(false)).toBe(false);
  });

  it('native token is cBTC with WCBTC as the wrapped address', () => {
    expect(citrea?.nativeToken.symbol).toBe('cBTC');
    expect(citrea?.nativeToken.decimals).toBe(18);
    expect(citrea?.nativeToken.wrapped).toBe(EXPECTED.wcbtc);
    expect(citrea?.nativeToken.wrapped).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('ctUSD is registered with SIX decimals, not the assumed 18', () => {
    // Read on-chain. Defaulting to 18 would misprice every amount by 1e12.
    const ctUSD = citrea?.stablecoins.find((s) => s.symbol === 'ctUSD');
    expect(ctUSD).toBeDefined();
    expect(ctUSD?.address).toBe(EXPECTED.ctUSD);
    expect(ctUSD?.decimals).toBe(6);
  });

  it('routes through the Alchemy proxy, EXCLUSIVELY', () => {
    // The public RPC rejects any getLogs range over 1000 blocks
    // ("query exceeds max block range 1000") while the Alchemy proxy serves
    // 10k. Scans are sized for 10k, so a public-endpoint failover would fail
    // every page — hence proxy-only, same as Pharos.
    expect(isProxiedChain(CITREA)).toBe(true);
    expect(isProxyOnlyChain(CITREA)).toBe(true);
    expect(ALCHEMY_SLUGS[CITREA]).toBe('citrea-mainnet');
  });

  it('declares a 10k log window so scans page instead of optimistically failing', () => {
    expect(isLogRangeLimited(CITREA)).toBe(true);
    const { pageWindow, defaultScan, maxScan } = getLogWindowConfig(CITREA);
    expect(pageWindow).toBe(10_000n); // exactly Alchemy's cap — no wasted splits
    expect(defaultScan).toBeGreaterThan(0n);
    // Head is ~8.7M blocks above deployment; maxScan must be able to span it.
    expect(maxScan).toBeGreaterThanOrEqual(9_000_000n);
  });

  it('bounds history scans at the real deployment block, never 0', () => {
    // deploymentBlock 0 is what made the Pharos market scanner walk millions
    // of pre-deployment blocks and saturate the connection pool.
    expect(citrea?.deploymentBlock).toBe(EXPECTED.deploymentBlock);
    expect(citrea?.deploymentBlock).toBeGreaterThan(0);
  });

  it("keeps the scanner's adaptive-split floor under the public RPC's 1000-block cap", () => {
    // getLogs ranges are inclusive, so 1000 → 1001 blocks → rejected.
    expect(citrea?.scanner.batchSize).toBeLessThan(1_000);
  });

  it('block time is 2s, matching the measured chain', () => {
    // Every seconds→blocks lookback is derived from this; a wrong value puts
    // timelocked actions outside the scan window and makes them invisible.
    expect(citrea?.blockTime).toBe(2_000);
  });
});

describe('Citrea viem chain definition', () => {
  it('does NOT declare multicall3', async () => {
    // The canonical 0xcA11bde0… address is empty on Citrea. Eight deployed
    // contracts named "Multicall3" answer aggregate3 correctly, but none is
    // byte-identical to the canonical runtime (Multicall3 has no immutables,
    // so a genuine canonical deployment would match exactly). Declaring one
    // would route every cap/allocation read in a curator tool through an
    // unverifiable aggregator that could fabricate results. viem falls back to
    // individual eth_calls when the entry is absent — verified working.
    const { getPublicClient } = await import('../../lib/data/rpcClient');
    const client = getPublicClient(CITREA);
    expect(client.chain?.id).toBe(CITREA);
    expect(client.chain?.contracts?.multicall3).toBeUndefined();
  });
});
