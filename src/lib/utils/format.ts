import { formatUnits, parseUnits } from 'viem';

const WAD = 10n ** 18n;

/**
 * Parse a human-readable token amount to raw bigint using actual decimals.
 */
export function parseTokenAmount(value: string, decimals: number): bigint {
  try {
    return parseUnits(value, decimals);
  } catch {
    return 0n;
  }
}
const SECONDS_PER_YEAR = 365.25 * 24 * 3600;

/**
 * Format a bigint value as a human-readable token amount.
 */
export function formatTokenAmount(
  value: bigint,
  decimals: number,
  maxFractionDigits = 2,
): string {
  if (value === 0n) return '0';
  const formatted = formatUnits(value, decimals);
  const num = parseFloat(formatted);
  if (num === 0 || num < 0.01) return '<0.01';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

/**
 * Format a bigint token amount compactly for tight layouts (e.g., "258.3K", "3.5M").
 * Falls back to standard formatting for small values.
 */
export function formatTokenAmountCompact(
  value: bigint,
  decimals: number,
): string {
  const formatted = formatUnits(value, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return '0';
  if (num < 0.01) return '<0.01';
  if (num < 1_000) return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (num < 1_000_000) return `${(num / 1_000).toFixed(1)}K`;
  if (num < 1_000_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  return `${(num / 1_000_000_000).toFixed(2)}B`;
}

/**
 * Format a USD value with $ prefix and appropriate suffix (K, M, B).
 */
export function formatUsd(value: number): string {
  if (value === 0) return '$0';
  if (value < 1000) return `$${value.toFixed(2)}`;
  if (value < 1_000_000) return `$${(value / 1000).toFixed(1)}K`;
  if (value < 1_000_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  return `$${(value / 1_000_000_000).toFixed(2)}B`;
}

/**
 * Format a WAD value (1e18) as a percentage string.
 */
export function formatWadPercent(wad: bigint, fractionDigits = 2): string {
  const pct = (Number(wad) / Number(WAD)) * 100;
  return `${pct.toFixed(fractionDigits)}%`;
}

/**
 * Format a percentage (0-1 range) to display string.
 */
export function formatPercent(value: number, fractionDigits = 2): string {
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

/**
 * Format seconds to human-readable duration.
 */
export function formatDuration(seconds: number | bigint): string {
  const s = Number(seconds);
  if (s === 0) return 'None';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

/**
 * Format a countdown from a future timestamp.
 */
export function formatCountdown(validAtSeconds: bigint): string {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (validAtSeconds <= now) return 'Ready';
  const remaining = Number(validAtSeconds - now);
  return formatDuration(remaining);
}

/**
 * Truncate an address for display: 0x1234ab...5678
 * Default shows first 6 chars (0x + 4) and last 4 chars.
 */
export function truncateAddress(address: string, chars = 4): string {
  const startLen = chars + 2; // "0x" prefix + chars
  if (address.length <= startLen + chars + 3) return address;
  return `${address.slice(0, startLen)}...${address.slice(-chars)}`;
}

/**
 * Calculate supply APY from per-second rate.
 * rate is in WAD (1e18) per second.
 */
export function rateToAPY(ratePerSecond: bigint): number {
  const rate = Number(ratePerSecond) / Number(WAD);
  return Math.pow(1 + rate, SECONDS_PER_YEAR) - 1;
}

/**
 * Calculate utilization as a number 0-1.
 */
export function calcUtilization(
  totalBorrow: bigint,
  totalSupply: bigint,
): number {
  if (totalSupply === 0n) return 0;
  return Number(totalBorrow) / Number(totalSupply);
}

/**
 * Calculate share price from total assets and total supply.
 */
export function calcSharePrice(
  totalAssets: bigint,
  totalSupply: bigint,
  decimals: number,
): number {
  if (totalSupply === 0n) return 1;
  return Number(formatUnits(totalAssets, decimals)) /
    Number(formatUnits(totalSupply, 18));
}

/**
 * Format a token amount for display with token-type-aware decimal places.
 */
export function formatTokenDisplay(amount: number, tokenSymbol: string): string {
  const symbol = tokenSymbol.toUpperCase();
  let decimals: number;
  if (symbol.includes('USD') || symbol.includes('USDT') || symbol.includes('USDC') || symbol.includes('DAI')) {
    decimals = 0;
  } else if (symbol.includes('ETH')) {
    decimals = 2;
  } else if (symbol.includes('BTC')) {
    decimals = 6;
  } else {
    decimals = 2;
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/**
 * Truncate a market ID for display: 0x12345678...abcd
 */
export function formatMarketId(marketId: string): string {
  if (marketId.length <= 14) return marketId;
  return `${marketId.slice(0, 8)}...${marketId.slice(-4)}`;
}

/**
 * Validate that a string is a valid Morpho market ID (64-char hex, with or without 0x prefix).
 */
export function isValidMarketId(marketId: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(marketId) || /^[a-fA-F0-9]{64}$/.test(marketId);
}
