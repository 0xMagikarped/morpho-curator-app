/**
 * The "90% UR" quick-fill is now shared by the V1 Reallocate tab and the V2
 * Allocation tab's reallocate dialog. It pre-fills an amount the curator then
 * signs, so the two clamps are the load-bearing part: without them the button
 * happily proposes a withdrawal larger than the market's liquidity, or a
 * supply over the cap — both of which revert in preflight and read as "the
 * button is broken".
 */
import { describe, it, expect } from 'vitest';
import {
  canTargetUtilization,
  targetAssetsForUtilization,
  DEFAULT_TARGET_UTILIZATION_BPS,
} from '../utilizationTarget';

/** 1e6-scale amounts, as for a 6-decimal stablecoin. */
const m = (n: number) => BigInt(Math.round(n * 1e6));

/** Utilization the market lands at once the vault moves to `target`. */
const resultingUtilization = (
  target: bigint,
  allocation: bigint,
  supply: bigint,
  borrow: bigint,
) => {
  const nextSupply = supply + (target - allocation);
  return nextSupply <= 0n ? 1 : Number(borrow) / Number(nextSupply);
};

describe('canTargetUtilization', () => {
  it('is false with no borrow — every supply level yields 0% utilization', () => {
    expect(
      canTargetUtilization({ allocation: m(100), totalSupplyAssets: m(1000), totalBorrowAssets: 0n }),
    ).toBe(false);
  });

  it('is false on an empty market — the ratio is undefined', () => {
    expect(
      canTargetUtilization({ allocation: 0n, totalSupplyAssets: 0n, totalBorrowAssets: 0n }),
    ).toBe(false);
  });

  it('is true when the market has both supply and borrow', () => {
    expect(
      canTargetUtilization({ allocation: m(100), totalSupplyAssets: m(1000), totalBorrowAssets: m(500) }),
    ).toBe(true);
  });
});

describe('targetAssetsForUtilization — the core move', () => {
  it('withdraws to lift an under-utilized market to 90%', () => {
    // Market: 1000 supply / 450 borrow = 45% UR. Vault holds 600.
    // For 90% the market needs 500 total supply → withdraw 500 → 600-500 = 100.
    const input = { allocation: m(600), totalSupplyAssets: m(1000), totalBorrowAssets: m(450) };
    const target = targetAssetsForUtilization(input)!;
    expect(target).toBe(m(100));
    expect(
      resultingUtilization(target, input.allocation, input.totalSupplyAssets, input.totalBorrowAssets),
    ).toBeCloseTo(0.9, 6);
  });

  it('bottoms out at zero when the vault alone cannot reach the target', () => {
    // Same market, but the vault holds only 400 of the 500 that must leave.
    // Withdrawing everything gets the market to 75%, not 90% — and that is the
    // honest outcome, not a bug. The button proposes the closest it can do.
    const input = { allocation: m(400), totalSupplyAssets: m(1000), totalBorrowAssets: m(450) };
    const target = targetAssetsForUtilization(input)!;
    expect(target).toBe(0n);
    expect(
      resultingUtilization(target, input.allocation, input.totalSupplyAssets, input.totalBorrowAssets),
    ).toBeCloseTo(0.75, 6);
  });

  it('supplies to bring an over-utilized market down to 90%', () => {
    // Market: 500 supply / 495 borrow = 99% UR. Vault holds 100.
    // For 90% the market needs 550 total supply → vault adds 50 → 150.
    const input = { allocation: m(100), totalSupplyAssets: m(500), totalBorrowAssets: m(495) };
    const target = targetAssetsForUtilization(input)!;
    expect(target).toBe(m(150));
    expect(
      resultingUtilization(target, input.allocation, input.totalSupplyAssets, input.totalBorrowAssets),
    ).toBeCloseTo(0.9, 6);
  });

  it('is a no-op when the market already sits at exactly 90%', () => {
    const input = { allocation: m(200), totalSupplyAssets: m(1000), totalBorrowAssets: m(900) };
    expect(targetAssetsForUtilization(input)).toBe(m(200));
  });

  it('never undershoots the target — truncation rounds utilization up, not down', () => {
    // 1000/777 with amounts that do not divide evenly.
    const input = { allocation: m(900), totalSupplyAssets: m(1000), totalBorrowAssets: m(777) };
    const target = targetAssetsForUtilization(input)!;
    expect(
      resultingUtilization(target, input.allocation, input.totalSupplyAssets, input.totalBorrowAssets),
    ).toBeGreaterThanOrEqual(0.9);
  });

  it('returns null rather than a fabricated zero when not applicable', () => {
    expect(
      targetAssetsForUtilization({ allocation: m(100), totalSupplyAssets: m(1000), totalBorrowAssets: 0n }),
    ).toBeNull();
  });
});

describe('targetAssetsForUtilization — liquidity is an invariant, not a clamp', () => {
  // The module claims a withdrawal can never exceed the market's idle
  // liquidity, so no clamp is needed. That claim is load-bearing (it is why
  // the clamp was removed), so it gets swept rather than spot-checked.
  it('never proposes withdrawing more than the market has idle, across the space', () => {
    const supplies = [100, 500, 1000, 7777];
    const borrowRatios = [0.01, 0.1, 0.5, 0.899, 0.9, 0.95, 1];
    const allocationRatios = [0, 0.05, 0.5, 0.95, 1];
    const targets = [1_000n, 5_000n, 9_000n, 9_900n, 10_000n];

    for (const s of supplies) {
      for (const br of borrowRatios) {
        for (const ar of allocationRatios) {
          for (const bps of targets) {
            const supply = m(s);
            const borrow = m(s * br);
            const allocation = m(s * ar); // vault's share of that supply
            if (borrow === 0n) continue;
            const liquidity = supply - borrow;
            const target = targetAssetsForUtilization(
              { allocation, totalSupplyAssets: supply, totalBorrowAssets: borrow },
              bps,
            );
            if (target === null) continue;
            const withdrawal = allocation - target;
            if (withdrawal > 0n) {
              expect(withdrawal).toBeLessThanOrEqual(liquidity);
            }
            expect(target).toBeGreaterThanOrEqual(0n);
          }
        }
      }
    }
  });

  it('floors at zero rather than going negative', () => {
    const input = { allocation: m(50), totalSupplyAssets: m(1000), totalBorrowAssets: m(100) };
    expect(targetAssetsForUtilization(input)).toBe(0n);
  });
});

describe('targetAssetsForUtilization — cap clamp', () => {
  it('clamps a top-up to the supply cap', () => {
    // Wants 150, cap says 120.
    const input = {
      allocation: m(100),
      totalSupplyAssets: m(500),
      totalBorrowAssets: m(495),
      maxTarget: m(120),
    };
    expect(targetAssetsForUtilization(input)).toBe(m(120));
  });

  it('treats a null cap as unbounded', () => {
    const input = {
      allocation: m(100),
      totalSupplyAssets: m(500),
      totalBorrowAssets: m(495),
      maxTarget: null,
    };
    expect(targetAssetsForUtilization(input)).toBe(m(150));
  });

  it('a cap equal to the current allocation blocks top-ups but still allows withdrawals', () => {
    // This is how the V1 tab encodes a MetaMorpho supply cap of 0 — the market
    // rejects new supply, so the bound is the current allocation.
    const topUp = targetAssetsForUtilization({
      allocation: m(100),
      totalSupplyAssets: m(500),
      totalBorrowAssets: m(495),
      maxTarget: m(100),
    });
    expect(topUp).toBe(m(100)); // wanted 150, pinned to current

    // 1000 supply / 500 borrow → 90% needs 555.55 supply → withdraw 444.44.
    const withdraw = targetAssetsForUtilization({
      allocation: m(800),
      totalSupplyAssets: m(1000),
      totalBorrowAssets: m(500),
      maxTarget: m(800),
    });
    expect(withdraw).toBe(355_555_555n); // below the bound, so unaffected by it
    expect(withdraw!).toBeLessThan(m(800));
  });
});

describe('targetAssetsForUtilization — configurable target', () => {
  it('defaults to 90%', () => {
    expect(DEFAULT_TARGET_UTILIZATION_BPS).toBe(9_000n);
  });

  it('honours a different target', () => {
    // 500 supply / 495 borrow, aiming for 99% → market needs 500, vault unchanged.
    const input = { allocation: m(100), totalSupplyAssets: m(500), totalBorrowAssets: m(495) };
    expect(targetAssetsForUtilization(input, 9_900n)).toBe(m(100));
  });

  it('returns null for a nonsensical target rather than dividing by zero', () => {
    expect(
      targetAssetsForUtilization(
        { allocation: m(100), totalSupplyAssets: m(500), totalBorrowAssets: m(495) },
        0n,
      ),
    ).toBeNull();
  });

  it('rejects targets above 100% — not a reachable utilization', () => {
    // Also what keeps the "liquidity never binds" guarantee true.
    expect(
      targetAssetsForUtilization(
        { allocation: m(100), totalSupplyAssets: m(500), totalBorrowAssets: m(495) },
        12_000n,
      ),
    ).toBeNull();
  });
});

describe('V1 and V2 call sites agree', () => {
  it('same market state yields the same target through either tab\'s input shape', () => {
    // V2 passes effectiveAbsCap directly; V1 passes cap-or-current. With a real
    // cap present both shapes are identical, which is the point of sharing.
    const shared = { allocation: m(100), totalSupplyAssets: m(500), totalBorrowAssets: m(495) };
    const v2 = targetAssetsForUtilization({ ...shared, maxTarget: m(1000) });
    const v1 = targetAssetsForUtilization({ ...shared, maxTarget: m(1000) });
    expect(v1).toBe(v2);
    expect(v1).toBe(m(150));
  });
});
