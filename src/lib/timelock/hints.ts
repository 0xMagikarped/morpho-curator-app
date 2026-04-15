/**
 * Rendering hints for decoded calldata args.
 *
 * The default rendering path shows a BigInt as-is. That's unreadable for
 * token amounts: "10000000000000000000000000" vs "10,000,000 USD1". Hints
 * attach a `decimals` + `symbol` where we're confident, so the UI can
 * format the value humanely.
 *
 * Safety rule (per spec): if decimals hint is uncertain, render raw
 * value + "(decimals unknown)" rather than a potentially wrong number.
 * Helpers here return `null` to signal "uncertain".
 */

import type { Address } from 'viem';
import type { DecodedArg } from './decodeCall';
import { getChainConfig } from '../../config/chains';
import { MOOLAH_BROKERS, MOOLAH_RATE_CALCULATORS } from '../../config/moolah';

export interface AmountHint {
  decimals: number;
  symbol?: string;
}

export interface AddressHint {
  label?: string;
  explorerUrl?: string;
}

export interface ArgHint {
  amount?: AmountHint;
  address?: AddressHint;
  /** Tag the arg with a category — "market id", "market params", "delay seconds". */
  kind?: 'marketId' | 'marketParams' | 'delaySeconds' | 'percentWad' | 'bytes';
}

/**
 * Rendering hints per-function-per-arg. Functions and arg names must match
 * the ABI exactly. If an arg is missing from the map it's rendered raw.
 *
 * Amount hints resolve against the outer context (vault asset decimals).
 * When a hint would need a token lookup we don't have yet, the hint
 * returns null — UI will fall back to raw + "(decimals unknown)".
 */
export type HintFn = (args: readonly DecodedArg[], ctx: HintContext) => ArgHint | null;

export interface HintContext {
  chainId: number;
  /** Target contract the call is aimed at. */
  target: Address;
  /**
   * The vault whose snapshot drove `vaultAssetDecimals` / `vaultAssetSymbol`.
   * Set when the surrounding UI knows its page-context vault. We only
   * apply the decimals hint when `target === snapshotAddress` — a cross-
   * vault call means we can't trust the page's decimals.
   */
  snapshotAddress?: Address;
  /** Vault asset decimals when the target is a MoolahVault we know. */
  vaultAssetDecimals?: number;
  vaultAssetSymbol?: string;
}

/**
 * Returns `true` when the snapshot vault's decimals are safe to apply
 * to the target — i.e. the call is aimed at the same vault whose
 * snapshot we're rendering. Cross-vault calls (e.g. a proposal on the
 * curatorTimeLock that targets a *different* vault) have unknown
 * decimals; we fall back to raw + `(decimals unknown)` rather than
 * risk a wrong-decode that could mislead a curator into approving a
 * catastrophic amount.
 */
function vaultDecimalsMatchSnapshot(ctx: HintContext): boolean {
  if (ctx.vaultAssetDecimals == null) return false;
  if (!ctx.snapshotAddress) return false;
  return ctx.target.toLowerCase() === ctx.snapshotAddress.toLowerCase();
}

export const HINTS: Record<string, Record<string, HintFn>> = {
  submitCap: {
    newSupplyCap: (_args, ctx) =>
      vaultDecimalsMatchSnapshot(ctx)
        ? { amount: { decimals: ctx.vaultAssetDecimals!, symbol: ctx.vaultAssetSymbol } }
        : null,
  },
  setFee: {
    newFee: () => ({ kind: 'percentWad' }),
  },
  setTimelock: {
    newTimelock: () => ({ kind: 'delaySeconds' }),
  },
  updateDelay: {
    newDelay: () => ({ kind: 'delaySeconds' }),
  },
  acceptCap: {
    // marketParams is a tuple — UI expands it via `kind: 'marketParams'`.
    marketParams: () => ({ kind: 'marketParams' }),
  },
  revokePendingCap: {
    id: () => ({ kind: 'marketId' }),
  },
  setIsAllocator: {
    newIsAllocator: () => ({ kind: 'bytes' }), // display raw bool; fine
  },
};

/**
 * Resolve an address to a human label using (1) known token list, (2)
 * known vault list, (3) known Moolah system contracts from chain config.
 */
export function resolveAddressLabel(
  address: Address,
  chainId: number,
): AddressHint {
  const config = getChainConfig(chainId);
  if (!config) return {};
  const lower = address.toLowerCase();
  const explorerUrl = `${config.blockExplorer}/address/${address}`;

  // Stablecoins + native wrapped
  for (const t of config.stablecoins ?? []) {
    if (t.address.toLowerCase() === lower) {
      return { label: t.symbol, explorerUrl };
    }
  }
  if (config.nativeToken.wrapped.toLowerCase() === lower) {
    return { label: `W${config.nativeToken.symbol}`, explorerUrl };
  }

  // Known vaults
  const vault = config.knownVaults?.[lower];
  if (vault?.label) return { label: vault.label, explorerUrl };

  // Moolah system contracts
  const moolah = config.moolah;
  if (moolah) {
    if (moolah.marketFactory?.toLowerCase() === lower) return { label: 'MarketFactory', explorerUrl };
    if (moolah.vaultAllocator?.toLowerCase() === lower) return { label: 'VaultAllocator', explorerUrl };
    if (moolah.vaultAdmin.toLowerCase() === lower) return { label: 'Lista vaultAdmin', explorerUrl };
    if (moolah.vaultImpl.toLowerCase() === lower) return { label: 'MoolahVault impl', explorerUrl };
    if (moolah.brokerRateCalculator?.toLowerCase() === lower) return { label: 'BrokerRateCalculator', explorerUrl };
    if (moolah.fixedRateIrm?.toLowerCase() === lower) return { label: 'FixedRateIRM', explorerUrl };
    if (moolah.liquidators.liquidator.toLowerCase() === lower) return { label: 'Liquidator', explorerUrl };
    if (moolah.liquidators.publicLiquidator.toLowerCase() === lower) return { label: 'PublicLiquidator', explorerUrl };
    if (moolah.liquidators.brokerLiquidator.toLowerCase() === lower) return { label: 'BrokerLiquidator', explorerUrl };
    if (moolah.revenue.revenueDistributor.toLowerCase() === lower) return { label: 'RevenueDistributor', explorerUrl };
    if (moolah.revenue.buyback.toLowerCase() === lower) return { label: 'BuyBack', explorerUrl };
    if (moolah.revenue.autoBuyback.toLowerCase() === lower) return { label: 'AutoBuyBack', explorerUrl };
    if (moolah.roles.operator.toLowerCase() === lower) return { label: 'Operator Safe', explorerUrl };
    if (moolah.roles.pauser.toLowerCase() === lower) return { label: 'Pauser', explorerUrl };
    for (const [name, addr] of Object.entries(moolah.providers ?? {})) {
      if (addr.toLowerCase() === lower) return { label: `${name} provider`, explorerUrl };
    }
  }

  // Periphery
  const p = config.periphery;
  if (p.adaptiveCurveIrm?.toLowerCase() === lower) return { label: 'AdaptiveCurveIRM', explorerUrl };
  if (p.publicAllocator?.toLowerCase() === lower) return { label: 'PublicAllocator', explorerUrl };
  if (p.bundler3?.toLowerCase() === lower) return { label: 'Bundler3', explorerUrl };

  // Chain singleton
  if (config.morphoBlue.toLowerCase() === lower) {
    return { label: config.protocol === 'moolah' ? 'Moolah singleton' : 'Morpho Blue', explorerUrl };
  }

  // Moolah LendingBrokers + RateCalculators published in the static
  // registry. Each broker is keyed by market pair (e.g. "BTCB/USD1"); we
  // reuse that label as-is.
  for (const broker of MOOLAH_BROKERS[chainId] ?? []) {
    if (broker.address.toLowerCase() === lower) {
      return { label: `Broker: ${broker.label}`, explorerUrl };
    }
  }
  for (const rc of MOOLAH_RATE_CALCULATORS[chainId] ?? []) {
    if (rc.address.toLowerCase() === lower) {
      return { label: rc.label, explorerUrl };
    }
  }

  return { explorerUrl };
}

export function getArgHint(
  functionName: string,
  argName: string,
  allArgs: readonly DecodedArg[],
  ctx: HintContext,
): ArgHint | null {
  const fnHints = HINTS[functionName];
  if (!fnHints) return null;
  const hint = fnHints[argName];
  return hint ? hint(allArgs, ctx) : null;
}
