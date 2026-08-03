/**
 * Rate projection for the V2 Reallocate dialog.
 *
 * Fixtures are real chain reads from RockawayX USDC on Pharos, market
 * wsrUSD/USDC @ 91.5% (0xbea21c37…9e73), captured 2026-08:
 *
 *   totalSupplyAssets 6_059_652_178_521 (6dp USDC)
 *   totalBorrowAssets 5_453_687_013_428
 *   fee               0
 *   borrowRateView(current state)          -> 479_449_337 wad/s  (1.5245% APY)
 *   borrowRateView(supply +2,000,000 USDC) -> 383_541_993 wad/s  (1.2177% APY)
 */
import { describe, it, expect, vi } from 'vitest';
import type { PublicClient } from 'viem';
import {
  utilizationPercent,
  apyPercentFromRatePerSecond,
  supplyApyPercent,
  blendedApyPercent,
  projectReallocationRates,
} from '../reallocationRates';
import type { MarketParams } from '../../../types';

const SUPPLY = 6_059_652_178_521n;
const BORROW = 5_453_687_013_428n;
const RATE_NOW = 479_449_337n;
const RATE_PLUS_2M = 383_541_993n;
const MARKET_ID = '0xbea21c372be9729760844cb2d60879f5ced6a8a5bba9a538dea8801e8ac49e73' as const;
const MORPHO = '0x18573fA18fd17dDfD790B4a5B5b2977aad3b4Efb' as const;

const PARAMS = {
  loanToken: '0xc879c018db60520f4355c26ed1a6d572cdac1815',
  collateralToken: '0x4809010926aec940b550d34a46a52739f996d75d',
  oracle: '0x9416f861970c2a39c02ab7696ef0496383d4e81b',
  irm: '0xd5e02889c13230458506cc842347c4e62f8cdf3a',
  lltv: 915_000_000_000_000_000n,
} as unknown as MarketParams;

/**
 * Stands in for the chain: returns the fixture market state, and a borrow rate
 * that reproduces the two measured points and interpolates monotonically
 * between them (rate falls as utilization falls, as the curve does).
 */
function fakeClient(state?: { supply?: bigint; borrow?: bigint; fee?: bigint }) {
  const supply = state?.supply ?? SUPPLY;
  const borrow = state?.borrow ?? BORROW;
  const fee = state?.fee ?? 0n;
  return {
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args: unknown[] }) => {
      if (functionName === 'market') return [supply, 0n, borrow, 0n, 0n, fee];
      if (functionName === 'borrowRateView') {
        const m = args[1] as { totalSupplyAssets: bigint };
        if (m.totalSupplyAssets === supply) return RATE_NOW;
        if (m.totalSupplyAssets === supply + 2_000_000_000_000n) return RATE_PLUS_2M;
        // Monotonic stand-in for any other point.
        return (RATE_NOW * supply) / m.totalSupplyAssets;
      }
      throw new Error(`unexpected call ${functionName}`);
    }),
  } as unknown as PublicClient;
}

describe('pure rate math', () => {
  it('utilization of an empty market is 0, not NaN', () => {
    expect(utilizationPercent(0n, 0n)).toBe(0);
  });

  it('reproduces the market’s live utilization', () => {
    expect(utilizationPercent(BORROW, SUPPLY)).toBeCloseTo(90.0, 1);
  });

  it('compounds the per-second rate to the measured APY', () => {
    expect(apyPercentFromRatePerSecond(RATE_NOW)).toBeCloseTo(1.5245, 3);
    expect(apyPercentFromRatePerSecond(RATE_PLUS_2M)).toBeCloseTo(1.2177, 3);
  });

  it('scales supply APY by utilization and the market fee', () => {
    expect(supplyApyPercent(10, 90, 0n)).toBeCloseTo(9, 6);
    // A 20% market fee takes a fifth of the supply side.
    expect(supplyApyPercent(10, 90, 200_000_000_000_000_000n)).toBeCloseTo(7.2, 6);
  });

  it('divides the blended APY by TOTAL assets so idle drags it down', () => {
    // Half the vault allocated at 4%, half sitting idle → 2%, not 4%.
    const blended = blendedApyPercent([{ assets: 50n, apyPercent: 4 }], 100n);
    expect(blended).toBeCloseTo(2, 6);
  });

  it('blends across markets in proportion to allocation', () => {
    const blended = blendedApyPercent(
      [
        { assets: 75n, apyPercent: 4 },
        { assets: 25n, apyPercent: 8 },
      ],
      100n,
    );
    expect(blended).toBeCloseTo(5, 6);
  });
});

describe('projectReallocationRates', () => {
  it('moves supply only — borrows are untouched, so utilization falls', async () => {
    const [p] = await projectReallocationRates(fakeClient(), MORPHO, [
      { marketId: MARKET_ID, params: PARAMS, delta: 2_000_000_000_000n, targetAssets: 0n },
    ]);

    expect(p.currentUtilizationPct).toBeCloseTo(90.0, 1);
    expect(p.nextUtilizationPct).toBeCloseTo(67.66, 1);
    expect(p.currentBorrowApyPct).toBeCloseTo(1.5245, 3);
    expect(p.nextBorrowApyPct).toBeCloseTo(1.2177, 3);
    // Supplying into a market dilutes the lenders' share of the interest.
    expect(p.nextSupplyApyPct!).toBeLessThan(p.currentSupplyApyPct);
  });

  it('flags a withdrawal past available liquidity instead of inventing a rate', async () => {
    // Liquidity is supply - borrow = 605,965 USDC; ask for 1,000,000 out.
    const [p] = await projectReallocationRates(fakeClient(), MORPHO, [
      { marketId: MARKET_ID, params: PARAMS, delta: -1_000_000_000_000n, targetAssets: 0n },
    ]);

    // Extrapolating the curve here yields ~108% utilization and a ~10% APY —
    // a plausible-looking number for a transaction the chain would reject.
    expect(p.exceedsLiquidity).toBe(true);
    expect(p.nextUtilizationPct).toBeNull();
    expect(p.nextSupplyApyPct).toBeNull();
    expect(p.nextBorrowApyPct).toBeNull();
  });

  it('an unchanged row projects to itself without claiming a move', async () => {
    const [p] = await projectReallocationRates(fakeClient(), MORPHO, [
      { marketId: MARKET_ID, params: PARAMS, delta: 0n, targetAssets: 100n },
    ]);
    expect(p.nextUtilizationPct).toBe(p.currentUtilizationPct);
    expect(p.nextBorrowApyPct).toBe(p.currentBorrowApyPct);
    expect(p.nextSupplyApyPct).toBe(p.currentSupplyApyPct);
  });

  it('applies the market fee to the supply side', async () => {
    const tenPercentFee = 100_000_000_000_000_000n;
    const [p] = await projectReallocationRates(fakeClient({ fee: tenPercentFee }), MORPHO, [
      { marketId: MARKET_ID, params: PARAMS, delta: 0n, targetAssets: 0n },
    ]);
    const noFee = p.currentBorrowApyPct * (p.currentUtilizationPct / 100);
    expect(p.currentSupplyApyPct).toBeCloseTo(noFee * 0.9, 6);
  });

  it('omits a market whose IRM read fails rather than reporting 0%', async () => {
    const broken = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === 'market') return [SUPPLY, 0n, BORROW, 0n, 0n, 0n];
        throw new Error('IRM reverted');
      }),
    } as unknown as PublicClient;

    const out = await projectReallocationRates(broken, MORPHO, [
      { marketId: MARKET_ID, params: PARAMS, delta: 1n, targetAssets: 0n },
    ]);
    expect(out).toEqual([]);
  });
});
