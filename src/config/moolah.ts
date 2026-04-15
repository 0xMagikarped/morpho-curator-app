/**
 * Static Moolah registries — brokers, rate calculators, and anything else
 * Lista publishes off-chain that the app wants at hand.
 *
 * Source of truth: `docs.bsc.lista.org/llms-full.txt` + Lista's Moolah
 * GitHub (`lista-dao/moolah`). Addresses cross-checked on BscScan.
 *
 * Design note on terms:
 *   `createFixedTermMarket` does NOT take a `term` parameter — on Lista,
 *   terms (7 / 14 / 30 days) are chosen at *borrow time*, not at market
 *   creation. A curator deploying a fixed-term market locks in a single
 *   broker + loan × collateral pair + LLTV + APR ceiling; the borrower
 *   later picks a duration within the broker's supported set. We
 *   therefore present brokers as market-pair selectors, not term
 *   selectors.
 */

import type { Address } from 'viem';

export interface BrokerInfo {
  address: Address;
  label: string;
  /** Loan token symbol as it appears in the chain's token registry. */
  loanSymbol: string;
  /** Collateral token symbol. */
  collateralSymbol: string;
  /** LLTV as a human percent (e.g., 0.86 for 86%). Canonical WAD form is lltv * 1e18. */
  lltvPercent: number;
  /**
   * Global cap across markets using this broker, in loan-token units.
   * Lista sizes these in round numbers; `null` when undocumented.
   */
  capHumanReadable?: string;
  /** Lista's LendingBroker contract per market pair. */
  bscScan?: string;
}

/** Broker rate calculators. Lista currently has a single deployment. */
export interface RateCalculatorInfo {
  address: Address;
  label: string;
}

// ============================================================
// BNB (chainId 56)
// ============================================================

const LISTA_BROKERS_56: BrokerInfo[] = [
  { address: '0x6BAF9648cffB7C9c4cB7275000a27b9a7dBD59Bc', label: 'WBNB/lisUSD',    loanSymbol: 'lisUSD', collateralSymbol: 'WBNB',    lltvPercent: 0.86,  capHumanReadable: '100k' },
  { address: '0x0cffd57f93190892ac2dB8A01596304268Bc2014', label: 'slisBNB/lisUSD', loanSymbol: 'lisUSD', collateralSymbol: 'slisBNB', lltvPercent: 0.86,  capHumanReadable: '100k' },
  { address: '0x30DDB3A48863E4897AaCDD5D202E23270d75BaE1', label: 'BTCB/lisUSD',    loanSymbol: 'lisUSD', collateralSymbol: 'BTCB',    lltvPercent: 0.86,  capHumanReadable: '100k' },
  { address: '0xf7c4701e90867f33745F73d5edF2143f0DE03f9d', label: 'PT-sUSDe/USD1',  loanSymbol: 'USD1',   collateralSymbol: 'PT-sUSDe', lltvPercent: 0.945, capHumanReadable: '10M' },
  { address: '0xFA25B61ac2c31E82DDE626EE2704700646a2C6E3', label: 'PT-sUSDe/U',     loanSymbol: 'U',      collateralSymbol: 'PT-sUSDe', lltvPercent: 0.945, capHumanReadable: '5M' },
  { address: '0xa26488154D61f8977153915510564ce47a5072dD', label: 'PT-sUSDe/USDT',  loanSymbol: 'USDT',   collateralSymbol: 'PT-sUSDe', lltvPercent: 0.945, capHumanReadable: '1M' },
  { address: '0x41E2a8C0f0e60ec228735a9ACDe704ff73df7981', label: 'BTCB/USD1',      loanSymbol: 'USD1',   collateralSymbol: 'BTCB',    lltvPercent: 0.86,  capHumanReadable: '10M' },
  { address: '0xF07b74724cC734079D9D1aa22fF7591B5A32D9d2', label: 'slisBNB/USD1',   loanSymbol: 'USD1',   collateralSymbol: 'slisBNB', lltvPercent: 0.86,  capHumanReadable: '10M' },
  { address: '0xFEb7D3Deb6a4CEE8f5da4F618098Ac943440Ff69', label: 'BTCB/U',         loanSymbol: 'U',      collateralSymbol: 'BTCB',    lltvPercent: 0.86,  capHumanReadable: '100M' },
  { address: '0xDf05774Cd68cE1FBaE01be3181524c904f91d628', label: 'slisBNB/U',      loanSymbol: 'U',      collateralSymbol: 'slisBNB', lltvPercent: 0.86,  capHumanReadable: '100M' },
  { address: '0xa94d926937f29553913A50feDC365De69162613d', label: 'BTCB/USDT',      loanSymbol: 'USDT',   collateralSymbol: 'BTCB',    lltvPercent: 0.86,  capHumanReadable: '1M' },
  { address: '0xf9502555CC9A4D3ea557BB79b825CA10B3A8344F', label: 'slisBNB/USDT',   loanSymbol: 'USDT',   collateralSymbol: 'slisBNB', lltvPercent: 0.86,  capHumanReadable: '1M' },
  { address: '0x52ee1F685ef41E8D1158E2508dC46561Ca839864', label: 'USDe/U',         loanSymbol: 'U',      collateralSymbol: 'USDe',    lltvPercent: 0.915, capHumanReadable: '75M' },
  { address: '0xFDFc9A306084BCa33885b76d23C885dB9E3a6e72', label: 'USDe/USD1',      loanSymbol: 'USD1',   collateralSymbol: 'USDe',    lltvPercent: 0.915, capHumanReadable: '75M' },
  { address: '0x07b72Adbe196E2E83242C3414eee5Fd7E4c0cD74', label: 'USDe/USDT',      loanSymbol: 'USDT',   collateralSymbol: 'USDe',    lltvPercent: 0.915, capHumanReadable: '75M' },
  { address: '0x3350fC3c54CE501083a60707823833e67168bb94', label: 'sUSDe/U',        loanSymbol: 'U',      collateralSymbol: 'sUSDe',   lltvPercent: 0.915, capHumanReadable: '75M' },
  { address: '0xCA5929B8fF8B1a4B9B8d77DFc5340977BFa425B3', label: 'sUSDe/USD1',     loanSymbol: 'USD1',   collateralSymbol: 'sUSDe',   lltvPercent: 0.915, capHumanReadable: '75M' },
  { address: '0x306b7122adb734bD3976f6Fb7dC5E8fEf57528D7', label: 'sUSDe/USDT',    loanSymbol: 'USDT',   collateralSymbol: 'sUSDe',   lltvPercent: 0.915, capHumanReadable: '75M' },
  { address: '0x1Fa26015286D1270343d7526C60bd57aB6bE8b54', label: 'slisBNB/WBNB',   loanSymbol: 'WBNB',   collateralSymbol: 'slisBNB', lltvPercent: 0.965, capHumanReadable: '1M' },
];

const LISTA_RATE_CALCULATORS_56: RateCalculatorInfo[] = [
  {
    address: '0xF81A3067ACF683B7f2f40a22bCF17c8310be2330',
    label: 'Lista RateCalculator (default)',
  },
];

// ============================================================
// Exports
// ============================================================

export const MOOLAH_BROKERS: Record<number, BrokerInfo[]> = {
  56: LISTA_BROKERS_56,
};

export const MOOLAH_RATE_CALCULATORS: Record<number, RateCalculatorInfo[]> = {
  56: LISTA_RATE_CALCULATORS_56,
};

/** Lookup helper — returns brokers filtered by loan symbol. */
export function getBrokersForLoanSymbol(chainId: number, loanSymbol: string): BrokerInfo[] {
  return (MOOLAH_BROKERS[chainId] ?? []).filter(
    (b) => b.loanSymbol.toLowerCase() === loanSymbol.toLowerCase(),
  );
}

/** All brokers for a chain. */
export function getBrokers(chainId: number): BrokerInfo[] {
  return MOOLAH_BROKERS[chainId] ?? [];
}

/** Default rate calculator for a chain, or null. */
export function getDefaultRateCalculator(chainId: number): RateCalculatorInfo | null {
  return MOOLAH_RATE_CALCULATORS[chainId]?.[0] ?? null;
}

/**
 * Convert an annual percentage rate (e.g., 5 for 5%) into Moolah's
 * `ratePerSecond` integer. The contract expects the rate as a WAD-scaled
 * per-second value: `apr_wad / SECONDS_PER_YEAR`. We round to the nearest
 * integer to avoid compounding drift.
 */
const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;
export function aprPercentToRatePerSecond(aprPercent: number): bigint {
  if (!Number.isFinite(aprPercent) || aprPercent < 0) return 0n;
  // 1e18 scaling, then /year seconds.
  const wad = BigInt(Math.round(aprPercent * 1e16)); // aprPercent/100 * 1e18
  return wad / SECONDS_PER_YEAR;
}
