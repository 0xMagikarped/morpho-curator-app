import { encodeFunctionData, type Address } from 'viem';
import { morphoBlueExtendedAbi, erc20ApproveAbi } from '../contracts/abis';
import type { TransactionStep } from '../vault/createVault';

// ============================================================
// Constants
// ============================================================

const WAD = 10n ** 18n;
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as const;
const DEAD_DEPOSIT_SHARES = 1_000_000_000n;

// ============================================================
// Types
// ============================================================

export interface MarketParamsTuple {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

export interface SeedAmounts {
  /** Amount of loan token to borrow (90% of supply by default) */
  borrowAmount: bigint;
  /** Minimum collateral to stay above liquidation threshold */
  minCollateral: bigint;
  /** Collateral to supply including safety buffer */
  collateralToSupply: bigint;
  /** Effective LTV ratio (0-1 scaled as float for display) */
  effectiveLtv: number;
}

export interface BuildSeedStepsParams {
  morphoBlue: Address;
  marketParams: MarketParamsTuple;
  loanToken: Address;
  collateralToken: Address;
  loanAmount: bigint;
  collateralAmount: bigint;
  borrowAmount: bigint;
  sender: Address;
  /** Existing loan token allowance — skip approve if sufficient */
  loanAllowance?: bigint;
  /** Existing collateral token allowance — skip approve if sufficient */
  collateralAllowance?: bigint;
}

// ============================================================
// Computation
// ============================================================

/**
 * Compute the oracle price scale factor.
 * Morpho oracles return: price of 1 collateral unit in loan units,
 * scaled by 10^(36 + loanDecimals - collateralDecimals).
 */
export function computeOraclePriceScale(loanDecimals: number, collateralDecimals: number): bigint {
  return 10n ** BigInt(36 + loanDecimals - collateralDecimals);
}

/**
 * Compute seed amounts for a market at target utilization.
 *
 * @param loanSupplyAmount - Raw loan token amount to supply (in token units with decimals)
 * @param oraclePrice - Oracle price (scaled per Morpho convention)
 * @param loanDecimals - Loan token decimals
 * @param collateralDecimals - Collateral token decimals
 * @param lltv - Loan-to-value ratio (WAD, e.g. 860000000000000000n = 86%)
 * @param targetUtilBps - Target utilization in bps (default 9000 = 90%)
 * @param safetyBufferBps - Safety buffer in bps (default 500 = 5%)
 */
export function computeSeedAmounts(
  loanSupplyAmount: bigint,
  oraclePrice: bigint,
  loanDecimals: number,
  collateralDecimals: number,
  lltv: bigint,
  targetUtilBps = 9000,
  safetyBufferBps = 500,
): SeedAmounts {
  // borrowAmount = loanSupplyAmount * targetUtil / 10000
  const borrowAmount = (loanSupplyAmount * BigInt(targetUtilBps)) / 10000n;

  const ORACLE_PRICE_SCALE = computeOraclePriceScale(loanDecimals, collateralDecimals);

  // minCollateral = (borrowAmount * ORACLE_PRICE_SCALE * WAD) / (oraclePrice * lltv)
  const minCollateral = (borrowAmount * ORACLE_PRICE_SCALE * WAD) / (oraclePrice * lltv);

  // collateralToSupply = minCollateral * (10000 + safetyBuffer) / 10000
  const collateralToSupply = (minCollateral * BigInt(10000 + safetyBufferBps)) / 10000n;

  // Effective LTV for display
  const collateralValueInLoan = (collateralToSupply * oraclePrice) / ORACLE_PRICE_SCALE;
  const effectiveLtv = collateralValueInLoan > 0n
    ? Number(borrowAmount) / Number(collateralValueInLoan)
    : 0;

  return { borrowAmount, minCollateral, collateralToSupply, effectiveLtv };
}

// ============================================================
// Transaction Step Builder
// ============================================================

/**
 * Build the sequence of transactions to seed a market at target utilization.
 *
 * Steps:
 * 1. Approve loan token (skipped if allowance sufficient)
 * 2. Supply dead deposit (1e9 shares to 0x...dEaD)
 * 3. Supply loan tokens
 * 4. Approve collateral token (skipped if allowance sufficient)
 * 5. Supply collateral
 * 6. Borrow at target utilization
 */
export function buildSeedSteps(params: BuildSeedStepsParams): TransactionStep[] {
  const {
    morphoBlue, marketParams, loanToken, collateralToken,
    loanAmount, collateralAmount, borrowAmount, sender,
    loanAllowance = 0n, collateralAllowance = 0n,
  } = params;

  const mp = {
    loanToken: marketParams.loanToken,
    collateralToken: marketParams.collateralToken,
    oracle: marketParams.oracle,
    irm: marketParams.irm,
    lltv: marketParams.lltv,
  };

  const steps: TransactionStep[] = [];

  // Step 1: Approve loan token (dead deposit cost is negligible in assets, but approve extra)
  const loanNeeded = loanAmount + DEAD_DEPOSIT_SHARES * 2n; // generous buffer for dead deposit
  if (loanAllowance < loanNeeded) {
    steps.push({
      id: 'approve-loan',
      label: `Approve loan token`,
      to: loanToken,
      data: encodeFunctionData({
        abi: erc20ApproveAbi,
        functionName: 'approve',
        args: [morphoBlue, loanNeeded],
      }),
      status: 'pending',
    });
  }

  // Step 2: Dead deposit (supply 0 assets, 1e9 shares to dead address)
  steps.push({
    id: 'dead-deposit',
    label: 'Dead deposit (inflation protection)',
    to: morphoBlue,
    data: encodeFunctionData({
      abi: morphoBlueExtendedAbi,
      functionName: 'supply',
      args: [mp, 0n, DEAD_DEPOSIT_SHARES, DEAD_ADDRESS, '0x'],
    }),
    status: 'pending',
  });

  // Step 3: Supply loan tokens
  steps.push({
    id: 'supply-loan',
    label: 'Supply loan tokens',
    to: morphoBlue,
    data: encodeFunctionData({
      abi: morphoBlueExtendedAbi,
      functionName: 'supply',
      args: [mp, loanAmount, 0n, sender, '0x'],
    }),
    status: 'pending',
  });

  // Step 4: Approve collateral token
  if (collateralAllowance < collateralAmount) {
    steps.push({
      id: 'approve-collateral',
      label: `Approve collateral token`,
      to: collateralToken,
      data: encodeFunctionData({
        abi: erc20ApproveAbi,
        functionName: 'approve',
        args: [morphoBlue, collateralAmount],
      }),
      status: 'pending',
    });
  }

  // Step 5: Supply collateral
  steps.push({
    id: 'supply-collateral',
    label: 'Supply collateral',
    to: morphoBlue,
    data: encodeFunctionData({
      abi: morphoBlueExtendedAbi,
      functionName: 'supplyCollateral',
      args: [mp, collateralAmount, sender, '0x'],
    }),
    status: 'pending',
  });

  // Step 6: Borrow at target utilization
  steps.push({
    id: 'borrow',
    label: 'Borrow at target utilization',
    to: morphoBlue,
    data: encodeFunctionData({
      abi: morphoBlueExtendedAbi,
      functionName: 'borrow',
      args: [mp, borrowAmount, 0n, sender, sender],
    }),
    status: 'pending',
  });

  return steps;
}
