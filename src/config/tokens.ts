/**
 * Chain-level token classifications. Keyed by lowercased address so symbol
 * spoofing (a rogue ERC-20 named "USDT") can't trip is-stablecoin checks.
 *
 * Used primarily by the Moolah minLoanValue warning in ReallocateTab: if
 * the vault's loan token is a recognised USD stablecoin (price ≈ $1),
 * we compare the market's total borrow against `minLoanValue` in 8dp
 * oracle units. Non-stable tokens skip the comparison entirely — we'd
 * rather hide the warning than render a wrong number.
 */

import type { Address } from 'viem';

/**
 * Per-chain set of lowercased token addresses priced ~1 USD on mainnet
 * oracles. Conservative — drift-prone wrappers (stETH, wstETH) and
 * rebasing tokens are deliberately excluded.
 */
const STABLECOIN_ADDRESSES: Record<number, Set<string>> = {
  // Ethereum
  1: new Set([
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
    '0x4c9edd5852cd905f086c759e8383e09bff1e68b3', // USDe
    '0x8e870d67f660d95d5be530380d0ec0bd388289e1', // PYUSD
    '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f', // GHO
    '0xf939e0a03fb07f59a73314e73794be0e57ac1b4e', // crvUSD
    '0x0000000000085d4780b73119b644ae5ecd22b376', // TUSD
  ]),
  // Base
  8453: new Set([
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // USDT (bridged)
  ]),
  // BNB Chain
  56: new Set([
    '0x55d398326f99059ff775485246999027b3197955', // USDT (BSC-USD)
    '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d', // USD1
    '0x0782b6d8c4551b9760e74c0545a9bcd90bdc41e5', // lisUSD
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC (binance-peg)
    '0xcf27439fa231af9931ee40c4f27bb77b83826f3c', // FDUSD
    '0x14016e85a25aeb13065688cafb43044c2ef86784', // TUSD (binance-peg)
    '0xe9e7cea3dedca5984780bafc599bd69add087d56', // BUSD (legacy; keep for historical markets)
    '0xda182944e84092e11370ca521f10aef488888888', // U (dollar-pegged stable)
  ]),
  // SEI
  1329: new Set([
    '0xe15fc38f6d8c56af07bbcbe3baf5708a2bf42392', // USDC (bridged)
    '0x142cdc44890978b506e745bb3bd11607b7f7faef', // PYUSD
  ]),
};

/** Returns true when the token is a known USD-pegged stablecoin on the chain. */
export function isStablecoin(chainId: number, tokenAddress: Address): boolean {
  const set = STABLECOIN_ADDRESSES[chainId];
  if (!set) return false;
  return set.has(tokenAddress.toLowerCase());
}
