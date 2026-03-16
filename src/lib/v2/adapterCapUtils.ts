/**
 * V2 adapter cap ID encoding, WAD math, and multicall builders.
 *
 * V2 caps use a three-level hierarchy:
 *   1. Adapter-level: idData = abi.encode("this", adapterAddress)
 *   2. Collateral-level: idData = abi.encode("collateralToken", tokenAddress)
 *   3. Market-level: idData = abi.encode("this/marketParams", adapterAddress, MarketParams)
 *
 * The on-chain ID is keccak256(idData).
 */
import type { Address } from 'viem';
import { keccak256, encodeAbiParameters, encodeFunctionData } from 'viem';
import type { MarketParams } from '../../types';
import { metaMorphoV2Abi } from '../contracts/metaMorphoV2Abi';

// ============================================================
// Constants
// ============================================================

/** 1e18 — 100% for relative caps */
export const WAD = 10n ** 18n;

/** Max uint128 — "unlimited" absolute cap */
export const MAX_UINT128 = (1n << 128n) - 1n;

// ============================================================
// ID Data Encoding
// ============================================================

/**
 * Encode adapter-level idData: abi.encode("this", adapter)
 */
export function adapterIdData(adapterAddress: Address): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'string' }, { type: 'address' }],
    ['this', adapterAddress],
  );
}

/**
 * Encode collateral-level idData: abi.encode("collateralToken", tokenAddress)
 */
export function collateralIdData(collateralToken: Address): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'string' }, { type: 'address' }],
    ['collateralToken', collateralToken],
  );
}

/**
 * Encode market-level idData: abi.encode("this/marketParams", adapter, MarketParams)
 */
export function marketIdData(adapterAddress: Address, params: MarketParams): `0x${string}` {
  return encodeAbiParameters(
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
    [
      'this/marketParams',
      adapterAddress,
      {
        loanToken: params.loanToken,
        collateralToken: params.collateralToken,
        oracle: params.oracle,
        irm: params.irm,
        lltv: params.lltv,
      },
    ],
  );
}

/**
 * Compute the on-chain cap ID from idData.
 */
export function capId(idData: `0x${string}`): `0x${string}` {
  return keccak256(idData);
}

// ============================================================
// WAD Math Helpers
// ============================================================

/** Convert a percentage (0–100) to WAD (0–1e18) */
export function percentToWad(pct: number): bigint {
  return BigInt(Math.round(pct * 1e16));
}

/** Convert WAD (0–1e18) to percentage (0–100) */
export function wadToPercent(wad: bigint): number {
  return Number(wad) / 1e16;
}

/** Format WAD as percentage string */
export function formatWadPercent(wad: bigint): string {
  const pct = wadToPercent(wad);
  return `${pct.toFixed(2)}%`;
}

/** Check if an absolute cap is effectively unlimited */
export function isUnlimitedCap(cap: bigint): boolean {
  return cap >= MAX_UINT128;
}

// ============================================================
// Multicall Builders
// ============================================================

/**
 * Build calldata for increaseAbsoluteCap.
 */
export function buildIncreaseAbsoluteCapCalldata(
  idData: `0x${string}`,
  cap: bigint,
): `0x${string}` {
  return encodeFunctionData({
    abi: metaMorphoV2Abi,
    functionName: 'increaseAbsoluteCap',
    args: [idData, cap],
  });
}

/**
 * Build calldata for increaseRelativeCap.
 */
export function buildIncreaseRelativeCapCalldata(
  idData: `0x${string}`,
  cap: bigint,
): `0x${string}` {
  return encodeFunctionData({
    abi: metaMorphoV2Abi,
    functionName: 'increaseRelativeCap',
    args: [idData, cap],
  });
}

/**
 * Build calldata for decreaseRelativeCap.
 */
export function buildDecreaseRelativeCapCalldata(
  idData: `0x${string}`,
  cap: bigint,
): `0x${string}` {
  return encodeFunctionData({
    abi: metaMorphoV2Abi,
    functionName: 'decreaseRelativeCap',
    args: [idData, cap],
  });
}

/**
 * Build calldata for decreaseAbsoluteCap.
 */
export function buildDecreaseAbsoluteCapCalldata(
  idData: `0x${string}`,
  cap: bigint,
): `0x${string}` {
  return encodeFunctionData({
    abi: metaMorphoV2Abi,
    functionName: 'decreaseAbsoluteCap',
    args: [idData, cap],
  });
}

/**
 * Build calldata for addAdapter.
 */
export function buildAddAdapterCalldata(adapterAddress: Address): `0x${string}` {
  return encodeFunctionData({
    abi: metaMorphoV2Abi,
    functionName: 'addAdapter',
    args: [adapterAddress],
  });
}

/**
 * Encode allocate data for a market adapter.
 * data arg = abi.encode(MarketParams)
 */
export function encodeAllocateData(params: MarketParams): `0x${string}` {
  return encodeAbiParameters(
    [
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
    [
      {
        loanToken: params.loanToken,
        collateralToken: params.collateralToken,
        oracle: params.oracle,
        irm: params.irm,
        lltv: params.lltv,
      },
    ],
  );
}
