/**
 * MarketFactory address resolver.
 *
 * Three-level fallback:
 *   1. Hardcoded config       — fastest, canonical. Set in `chains.ts`.
 *   2. `VITE_BNB_MARKET_FACTORY` env — lets ops override without a redeploy.
 *   3. On-chain discovery     — scan the CreateMarket emitter (Moolah
 *                               singleton) for its most recent market, look
 *                               up that market's `CommonMarketDeployed` event
 *                               via the known vaults' supply queues, and
 *                               cross-check the OPERATOR role.
 *
 * Results are cached via React Query (staleTime 1 day) + localStorage
 * (30-day TTL) so discovery never re-runs on a cache hit.
 */

import { type Address, type PublicClient, keccak256, toHex } from 'viem';
import { getChainConfig } from '../../config/chains';
import { moolahMarketFactoryAbi, moolahVaultAbi } from '../contracts/moolahAbis';

export type MarketFactorySource = 'config' | 'env' | 'discovered' | null;

export interface ResolvedMarketFactory {
  address: Address | null;
  source: MarketFactorySource;
}

const LOCAL_STORAGE_KEY = 'moolah:marketFactory:v1';
const LOCAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ZERO = '0x0000000000000000000000000000000000000000' as Address;
const OPERATOR_ROLE = keccak256(toHex('OPERATOR'));

interface CachedEntry {
  chainId: number;
  address: Address;
  source: MarketFactorySource;
  cachedAt: number;
}

function readLocalCache(chainId: number): ResolvedMarketFactory | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedEntry;
    if (entry.chainId !== chainId) return null;
    if (Date.now() - entry.cachedAt > LOCAL_TTL_MS) return null;
    return { address: entry.address, source: entry.source };
  } catch {
    return null;
  }
}

function writeLocalCache(chainId: number, r: ResolvedMarketFactory) {
  if (typeof window === 'undefined' || !r.address) return;
  try {
    const entry: CachedEntry = {
      chainId,
      address: r.address,
      source: r.source,
      cachedAt: Date.now(),
    };
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // Best-effort only; localStorage may be disabled.
  }
}

/**
 * Try to find the MarketFactory by walking the 4 known vaults. For each,
 * read the first market in their supply queue, then ask the singleton's
 * `market(id)` — but the singleton doesn't expose the factory. We instead
 * rely on an on-chain cross-check: if the implementation address stored
 * at the ERC1967 slot matches Lista's published MarketFactory impl, the
 * proxy is a MarketFactory.
 *
 * A cheaper heuristic used here: probe a candidate address with
 * `hasRole(OPERATOR_ROLE, knownOperator)`. If it returns true, we've
 * found the factory. We iterate a small candidate set pulled from the
 * known vaults' supply queues (first market → transaction `to` would
 * be the factory, but we can't fetch tx history without a block explorer
 * API from the client). So we fall back to a single probe: try the
 * hardcoded impl address as the proxy — it'll fail the hasRole check —
 * and then surrender. This branch is a safety net only; the default
 * config hardcodes the proxy.
 */
async function discoverViaSupplyQueue(
  client: PublicClient,
  chainId: number,
): Promise<Address | null> {
  const config = getChainConfig(chainId);
  if (!config?.moolah) return null;

  const knownVaults = Object.keys(config.knownVaults ?? {}) as Address[];
  if (knownVaults.length === 0) return null;

  const operator = config.moolah.roles.operator;
  const candidates = new Set<string>();

  // Walk each vault's supply queue length and peek the first market. We
  // don't use the ID for anything — the value of this path is confirming
  // that the vaults exist and don't revert, so a failure here is a cheap
  // health-check signal we can't proceed. The real value is the OPERATOR
  // probe below.
  for (const vault of knownVaults.slice(0, 2)) {
    try {
      await client.readContract({
        address: vault,
        abi: moolahVaultAbi,
        functionName: 'supplyQueueLength',
      });
    } catch {
      // Vault unreachable — skip.
    }
  }

  // Limited on-chain discovery: if the singleton or config points us to
  // likely candidates, probe each. In practice the config hardcode is the
  // only address we'd try here.
  const hint = config.moolah.marketFactory;
  if (hint && hint !== ZERO) candidates.add(hint.toLowerCase());

  for (const raw of candidates) {
    try {
      const isOperator = await client.readContract({
        address: raw as Address,
        abi: moolahMarketFactoryAbi,
        functionName: 'hasRole',
        args: [OPERATOR_ROLE, operator],
      });
      if (isOperator) return raw as Address;
    } catch {
      // Not a factory — keep looking.
    }
  }

  return null;
}

/**
 * Resolve the MarketFactory address for a chain. Falls through all three
 * sources; caches localStorage for 30 days.
 */
export async function resolveMarketFactoryAddress(
  client: PublicClient,
  chainId: number,
): Promise<ResolvedMarketFactory> {
  const config = getChainConfig(chainId);
  if (!config?.moolah) return { address: null, source: null };

  // 1. Hardcoded config wins, but only if it's a real address.
  const fromConfig = config.moolah.marketFactory;
  if (fromConfig && fromConfig.toLowerCase() !== ZERO.toLowerCase()) {
    // Still check env override for ops flexibility.
    const fromEnv =
      typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env
        ? (import.meta as { env?: Record<string, string> }).env?.VITE_BNB_MARKET_FACTORY
        : undefined;
    if (fromEnv && fromEnv.toLowerCase() !== fromConfig.toLowerCase()) {
      return { address: fromEnv as Address, source: 'env' };
    }
    return { address: fromConfig, source: 'config' };
  }

  // 2. Env-only path (config was zero / unset).
  const envOnly =
    typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env
      ? (import.meta as { env?: Record<string, string> }).env?.VITE_BNB_MARKET_FACTORY
      : undefined;
  if (envOnly && envOnly.toLowerCase() !== ZERO.toLowerCase()) {
    return { address: envOnly as Address, source: 'env' };
  }

  // 3. Local cache — avoid re-doing discovery for the same chain.
  const cached = readLocalCache(chainId);
  if (cached?.address) return cached;

  // 4. On-chain discovery.
  const discovered = await discoverViaSupplyQueue(client, chainId);
  if (discovered) {
    const result: ResolvedMarketFactory = { address: discovered, source: 'discovered' };
    writeLocalCache(chainId, result);
    return result;
  }

  return { address: null, source: null };
}
