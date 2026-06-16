/**
 * Scan a vault's `SubmitCap` event logs to discover every market that
 * could plausibly still hold a live `pendingCap`. This is the
 * cap-discovery path of last resort: the global MarketScanner may not
 * have indexed a brand-new market yet (it scans Morpho Blue's
 * CreateMarket events incrementally), and the curator may have added
 * the market manually by ID, so neither source would surface a
 * pendingCap on it. SubmitCap is emitted by the vault itself on every
 * `submitCap` call, so scanning the vault's logs over
 * `timelock + 24h` catches every still-open submission.
 *
 * Used by:
 *   - PendingCapsBanner (Overview)
 *   - CapsTab (deep view + status hydration of manual market adds)
 */
import { useQuery } from '@tanstack/react-query';
import { parseAbiItem, type Address } from 'viem';
import { getChainConfig } from '../../config/chains';
import { getPublicClient } from '../data/rpcClient';
import { scanContractEvent } from '../data/eventScan';

const SUBMIT_CAP_EVENT = parseAbiItem(
  'event SubmitCap(address indexed caller, bytes32 indexed id, uint256 cap)',
);

export function useVaultSubmitCapMarkets(
  chainId: number | undefined,
  vaultAddress: Address | undefined,
  timelockSeconds: bigint | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['vault-submit-cap-markets', chainId, vaultAddress?.toLowerCase()],
    queryFn: async (): Promise<`0x${string}`[]> => {
      if (!chainId || !vaultAddress) return [];
      const chainConfig = getChainConfig(chainId);
      if (!chainConfig) return [];
      const client = getPublicClient(chainId);
      const latest = await client.getBlockNumber();
      // Cover the full timelock + 24h buffer so an in-flight submit is caught
      // even if the timelock was recently lowered. blockTime is in MS and can
      // be sub-second (SEI = 400ms) — compute the lookback with the real
      // fractional block time. The previous `floor(blockTime/1000)` clamped
      // sub-second chains to 1s/block, undercounting the window ~2.5x on SEI
      // so a 3-day-old SubmitCap fell outside the scan and the pending cap
      // never surfaced.
      const blockMs = chainConfig.blockTime > 0 ? chainConfig.blockTime : 2_000;
      const lookbackSeconds = Number(timelockSeconds ?? 0n) + 86_400;
      const lookbackBlocks = BigInt(Math.ceil((lookbackSeconds * 1000) / blockMs));
      const fromBlock = latest > lookbackBlocks ? latest - lookbackBlocks : 0n;

      // Shared adaptive scanner: paginates and halves on any range/result
      // error, so it works through Alchemy's getLogs caps (and any fallback)
      // without the brittle fixed-chunk loop this used to use.
      const logs = await scanContractEvent(
        client, chainId, vaultAddress, SUBMIT_CAP_EVENT, fromBlock, latest,
      );
      const ids = new Set<`0x${string}`>();
      for (const log of logs) {
        const id = (log as { args?: { id?: `0x${string}` } }).args?.id;
        if (id) ids.add(id);
      }
      return [...ids];
    },
    enabled: enabled && !!chainId && !!vaultAddress,
    // Once we've seen a submission, the per-marketId pendingCap read
    // (useDiscoveredMarketStatuses, 30s) drives the countdown; the
    // submitter set itself is near-immutable, so the heavy getLogs scan
    // doesn't need a tight refetch. Keep it at 5 min to stay safe under
    // SEI publicnode rate limits.
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}
