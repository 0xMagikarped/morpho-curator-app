/**
 * What a proposed V2 reallocation does to each market's rate.
 *
 * The Reallocate dialog let a curator move millions between markets with no
 * indication of the consequence — which is the whole point of the action.
 * Moving assets *into* a market dilutes utilization and pushes the rate down;
 * pulling out concentrates it and pushes the rate up. Both are large, both are
 * immediate, and neither was visible until after the transaction landed.
 *
 * Mechanically a reallocation only moves the vault's supply. Borrows are
 * untouched, so for a delta `d`:
 *
 *   totalSupplyAssets' = totalSupplyAssets + d
 *   totalBorrowAssets' = totalBorrowAssets
 *   utilization'       = totalBorrowAssets / totalSupplyAssets'
 *
 * The new borrow rate comes from the market's own IRM via `borrowRateView`
 * against that simulated state. Reading the rate from the IRM rather than
 * reimplementing the AdaptiveCurve locally means this works for any IRM a
 * market is deployed with, and can't drift from the contract.
 *
 * Verified against RockawayX USDC on Pharos, market wsrUSD/USDC @ 91.5%
 * (0xbea21c37…9e73, supply 6,059,652 / borrow 5,453,687, fee 0):
 *
 *   delta            utilization   borrow APY   supply APY
 *   0 (current)         90.00%        1.523%       1.371%
 *   +30,000             89.55%        1.518%       1.359%
 *   +2,000,000          67.66%        1.238%       0.838%
 */
import type { Address, PublicClient } from 'viem';
import type { MarketParams } from '../../types';

/** 365.25d, matching `rateToAPY` in lib/utils/format. */
const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
const WAD = 10n ** 18n;

const morphoMarketAbi = [
  {
    name: 'market',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'totalSupplyAssets', type: 'uint128' },
      { name: 'totalSupplyShares', type: 'uint128' },
      { name: 'totalBorrowAssets', type: 'uint128' },
      { name: 'totalBorrowShares', type: 'uint128' },
      { name: 'lastUpdate', type: 'uint128' },
      { name: 'fee', type: 'uint128' },
    ],
  },
] as const;

const marketParamsTuple = {
  type: 'tuple',
  components: [
    { name: 'loanToken', type: 'address' },
    { name: 'collateralToken', type: 'address' },
    { name: 'oracle', type: 'address' },
    { name: 'irm', type: 'address' },
    { name: 'lltv', type: 'uint256' },
  ],
} as const;

const marketStateTuple = {
  type: 'tuple',
  components: [
    { name: 'totalSupplyAssets', type: 'uint128' },
    { name: 'totalSupplyShares', type: 'uint128' },
    { name: 'totalBorrowAssets', type: 'uint128' },
    { name: 'totalBorrowShares', type: 'uint128' },
    { name: 'lastUpdate', type: 'uint128' },
    { name: 'fee', type: 'uint128' },
  ],
} as const;

const irmViewAbi = [
  {
    name: 'borrowRateView',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { ...marketParamsTuple, name: 'marketParams' },
      { ...marketStateTuple, name: 'market' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

interface MarketState {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
}

// ---------------------------------------------------------------------------
// Pure math
// ---------------------------------------------------------------------------

/** Utilization as a percentage (0–100). An empty market is 0, not NaN. */
export function utilizationPercent(borrow: bigint, supply: bigint): number {
  if (supply <= 0n) return 0;
  return (Number(borrow) / Number(supply)) * 100;
}

/**
 * Per-second WAD rate → compounded annual percentage. Mirrors `rateToAPY` in
 * lib/utils/format so a rate shown here matches one shown anywhere else.
 */
export function apyPercentFromRatePerSecond(ratePerSecond: bigint): number {
  const rate = Number(ratePerSecond) / Number(WAD);
  return (Math.pow(1 + rate, SECONDS_PER_YEAR) - 1) * 100;
}

/**
 * Supply APY is the borrow APY scaled by how much of the pool is lent out,
 * less the market fee: `borrowApy * utilization * (1 - fee)`.
 */
export function supplyApyPercent(
  borrowApyPercent: number,
  utilizationPct: number,
  feeWad: bigint,
): number {
  const fee = Number(feeWad) / Number(WAD);
  return borrowApyPercent * (utilizationPct / 100) * (1 - fee);
}

/**
 * Vault-level APY across positions. Idle assets earn nothing, so the divisor
 * is total assets rather than the allocated sum — otherwise idle capital is
 * silently excluded and the number flatters the allocation.
 */
export function blendedApyPercent(
  positions: readonly { assets: bigint; apyPercent: number }[],
  totalAssets: bigint,
): number {
  if (totalAssets <= 0n) return 0;
  const total = Number(totalAssets);
  let acc = 0;
  for (const p of positions) {
    if (p.assets <= 0n) continue;
    acc += (Number(p.assets) / total) * p.apyPercent;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface MarketRateInput {
  marketId: `0x${string}`;
  params: MarketParams;
  /** Signed change in the vault's supply to this market, in asset units. */
  delta: bigint;
  /** The vault's resulting allocation, for the blended figure. */
  targetAssets: bigint;
}

export interface MarketRateProjection {
  marketId: `0x${string}`;
  targetAssets: bigint;
  currentUtilizationPct: number;
  currentBorrowApyPct: number;
  currentSupplyApyPct: number;
  /**
   * Null when the delta can't happen — a withdrawal larger than the market's
   * idle liquidity would drive utilization past 100%, which the chain would
   * reject. Reporting a number there would be inventing one.
   */
  nextUtilizationPct: number | null;
  nextBorrowApyPct: number | null;
  nextSupplyApyPct: number | null;
  /** True when the withdrawal exceeds available liquidity. */
  exceedsLiquidity: boolean;
}

async function readMarketState(
  client: PublicClient,
  morpho: Address,
  marketId: `0x${string}`,
): Promise<MarketState> {
  const r = await client.readContract({
    address: morpho,
    abi: morphoMarketAbi,
    functionName: 'market',
    args: [marketId],
  });
  return {
    totalSupplyAssets: r[0],
    totalSupplyShares: r[1],
    totalBorrowAssets: r[2],
    totalBorrowShares: r[3],
    lastUpdate: r[4],
    fee: r[5],
  };
}

function borrowRate(
  client: PublicClient,
  params: MarketParams,
  state: MarketState,
): Promise<bigint> {
  return client.readContract({
    address: params.irm,
    abi: irmViewAbi,
    functionName: 'borrowRateView',
    args: [params, state],
  }) as Promise<bigint>;
}

/**
 * Project current and post-reallocation rates for each market.
 *
 * All reads fan out through the client's multicall batching, so a whole
 * dialog's worth of markets costs a couple of round-trips regardless of count.
 * A market whose IRM read fails is omitted rather than reported as 0% — a
 * wrong rate is worse here than a missing one.
 */
export async function projectReallocationRates(
  client: PublicClient,
  morpho: Address,
  inputs: readonly MarketRateInput[],
): Promise<MarketRateProjection[]> {
  const results = await Promise.all(
    inputs.map(async (input): Promise<MarketRateProjection | null> => {
      try {
        const state = await readMarketState(client, morpho, input.marketId);

        const currentUtilizationPct = utilizationPercent(
          state.totalBorrowAssets,
          state.totalSupplyAssets,
        );
        const currentBorrowApyPct = apyPercentFromRatePerSecond(
          await borrowRate(client, input.params, state),
        );
        const currentSupplyApyPct = supplyApyPercent(
          currentBorrowApyPct,
          currentUtilizationPct,
          state.fee,
        );

        const base: MarketRateProjection = {
          marketId: input.marketId,
          targetAssets: input.targetAssets,
          currentUtilizationPct,
          currentBorrowApyPct,
          currentSupplyApyPct,
          nextUtilizationPct: null,
          nextBorrowApyPct: null,
          nextSupplyApyPct: null,
          exceedsLiquidity: false,
        };

        if (input.delta === 0n) {
          return {
            ...base,
            nextUtilizationPct: currentUtilizationPct,
            nextBorrowApyPct: currentBorrowApyPct,
            nextSupplyApyPct: currentSupplyApyPct,
          };
        }

        const nextSupply = state.totalSupplyAssets + input.delta;
        // Withdrawing past the borrowed amount is not a rate change, it is an
        // impossible transaction. Flag it instead of extrapolating the curve
        // past 100% utilization, which yields a plausible-looking huge APY.
        if (nextSupply < state.totalBorrowAssets) {
          return { ...base, exceedsLiquidity: true };
        }

        const nextState: MarketState = { ...state, totalSupplyAssets: nextSupply };
        const nextUtilizationPct = utilizationPercent(state.totalBorrowAssets, nextSupply);
        const nextBorrowApyPct = apyPercentFromRatePerSecond(
          await borrowRate(client, input.params, nextState),
        );

        return {
          ...base,
          nextUtilizationPct,
          nextBorrowApyPct,
          nextSupplyApyPct: supplyApyPercent(nextBorrowApyPct, nextUtilizationPct, state.fee),
        };
      } catch {
        return null;
      }
    }),
  );

  return results.filter((r): r is MarketRateProjection => r !== null);
}
