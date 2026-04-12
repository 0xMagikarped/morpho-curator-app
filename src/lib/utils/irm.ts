import { getChainConfig } from '../../config/chains';

export type MarketRateType = 'variable' | 'fixed';

/**
 * Determine if a market uses a fixed-rate IRM based on its IRM address.
 * Chain-agnostic — works for Lista (BNB) and Morpho (ETH/Base/etc).
 */
export function getMarketRateType(
  irmAddress: `0x${string}`,
  chainId: number,
): MarketRateType {
  const config = getChainConfig(chainId);
  const fixedRateAddresses = config?.periphery.fixedRateIrm ?? [];
  const isFixed = fixedRateAddresses.some(
    (addr) => addr.toLowerCase() === irmAddress.toLowerCase(),
  );
  return isFixed ? 'fixed' : 'variable';
}

/**
 * Check if a chain has any known FixedRateIRM deployments.
 */
export function chainHasFixedRateIrm(chainId: number): boolean {
  const config = getChainConfig(chainId);
  return (config?.periphery.fixedRateIrm?.length ?? 0) > 0;
}

/**
 * Convert a per-second WAD rate to annualized APR.
 * FixedRateIRM returns a constant per-second rate in WAD (1e18).
 */
export function ratePerSecondToApr(ratePerSecond: bigint): number {
  return (Number(ratePerSecond) / 1e18) * 365.25 * 24 * 3600;
}
