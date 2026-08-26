/**
 * "Set this market to ~90% utilization" — the quick-fill shared by the V1
 * Reallocate tab and the V2 Allocation tab's reallocate dialog.
 *
 * The curator's question is "how much do I need in this market for it to sit
 * at a healthy utilization?", and the answer is a supply-side move: the vault
 * is treated as the marginal supplier, so the market's total supply has to
 * become `borrow / targetUtilization`, and the vault absorbs the whole delta.
 *
 *     targetTotalSupply = totalBorrowAssets / targetUtilization
 *     target            = allocation + (targetTotalSupply - totalSupplyAssets)
 *
 * Two bounds apply, and only one of them can actually bind:
 *
 *   - The supply cap. A target above it would revert, so it clamps.
 *   - The vault's own position. It can only withdraw what it holds, so the
 *     target floors at zero. When the vault holds less than the withdrawal the
 *     target calls for, 90% is simply unreachable and the button proposes
 *     "withdraw everything" — the closest it can get.
 *
 * Market liquidity deliberately does NOT clamp, because it provably cannot
 * bind. Morpho guarantees `borrow <= supply`, and for any target utilization
 * `u <= 1` the implied total supply is `borrow / u >= borrow`. So the
 * withdrawal this asks for, `supply - borrow / u`, is always at most
 * `supply - borrow` — exactly the idle liquidity. The V2 original carried a
 * liquidity clamp for this; it was dead code. `targetBps` is validated to
 * `(0, 10_000]` instead, which is what keeps the guarantee true.
 *
 * This lives outside both components because "the same button" has to mean the
 * same arithmetic. It was previously inline in V2AllocationTab only; V1 asked
 * for parity, and a second hand-rolled copy is how the two silently drift.
 */

/** Basis points of the utilization we aim for. 9_000 = 90%. */
export const DEFAULT_TARGET_UTILIZATION_BPS = 9_000n;

export interface UtilizationTargetInput {
  /** The vault's current supply in this market. */
  allocation: bigint;
  /** Market-wide total supply. */
  totalSupplyAssets: bigint;
  /** Market-wide total borrow. */
  totalBorrowAssets: bigint;
  /**
   * Upper bound for the resulting target — the vault's supply cap for this
   * market. `null`/`undefined` means unbounded.
   *
   * Note this bounds the target, not the delta: passing the current allocation
   * expresses "may withdraw, may not add", which is what a zero MetaMorpho
   * supply cap means in practice (a cap of 0 rejects new supply).
   */
  maxTarget?: bigint | null;
}

/**
 * Whether a utilization target is meaningful for this market.
 *
 * With no borrow there is no utilization to steer — every supply level yields
 * 0% — and with no supply the market is empty and the ratio is undefined. In
 * both cases the button is hidden rather than shown computing a misleading
 * number.
 */
export function canTargetUtilization(input: UtilizationTargetInput): boolean {
  return input.totalBorrowAssets > 0n && input.totalSupplyAssets > 0n;
}

/**
 * The vault allocation that puts this market at `targetBps` utilization.
 *
 * Returns `null` when the target is not meaningful (see `canTargetUtilization`)
 * so callers surface nothing rather than a fabricated zero.
 */
export function targetAssetsForUtilization(
  input: UtilizationTargetInput,
  targetBps: bigint = DEFAULT_TARGET_UTILIZATION_BPS,
): bigint | null {
  const { allocation, totalSupplyAssets: supply, totalBorrowAssets: borrow, maxTarget } = input;
  if (!canTargetUtilization(input)) return null;
  // A target of 0% has no finite answer and anything above 100% is not a
  // reachable utilization. Rejecting both is also what makes the
  // liquidity-never-binds guarantee in the module docs hold.
  if (targetBps <= 0n || targetBps > 10_000n) return null;

  // Integer division truncates, so the implied total supply lands a hair low
  // and the resulting utilization a hair high — never below target, which is
  // the safe direction for a "get this market working" action.
  const targetTotalSupply = (borrow * 10_000n) / targetBps;

  let target = allocation + (targetTotalSupply - supply);

  // The vault cannot withdraw more than it holds. When the move calls for
  // more, the target bottoms out here and the market lands short of the
  // requested utilization — correctly, since the vault alone cannot get it
  // there.
  if (target < 0n) target = 0n;

  if (maxTarget != null && target > maxTarget) target = maxTarget;

  return target;
}
