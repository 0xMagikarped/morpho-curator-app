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

const SUBMIT_CAP_EVENT = parseAbiItem(
  'event SubmitCap(address indexed caller, bytes32 indexed id, uint256 cap)',
);

/**
 * Per-call block span for the vault-scoped SubmitCap event scan.
 *
 * The chain-level `scanner.batchSize` is tuned for Morpho-Blue-wide
 * CreateMarket scans where event density is high and 2k blocks already
 * pushes log payload limits. SubmitCap events on a single vault are
 * orders of magnitude sparser — a vault emits maybe one per week — so
 * we can request a much wider window per RPC call. Empirically all the
 * public SEI / ETH / Base RPCs accept 50k-block ranges; capped at
 * scanner.batchSize when the chain config explicitly opts into a
 * smaller window.
 *
 * On SEI specifically (400ms blocks → 648k blocks per 3-day timelock),
 * 2k chunks blew up into ~324 sequential getLogs calls that throttled
 * publicnode.com and cascaded into "generic read failures" elsewhere.
 */
const SUBMIT_CAP_CHUNK_BLOCKS = 50_000n;

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
      // blockTime is ms; treat as 2s if unset to stay safe.
      const blockSecs = Math.max(1, Math.floor(chainConfig.blockTime / 1000));
      // Cover the full timelock plus a 24h buffer so an in-flight submit
      // is still caught even if the timelock was recently lowered.
      const lookbackBlocks = (Number(timelockSeconds ?? 0n) + 86_400) / blockSecs;
      const span = BigInt(Math.ceil(lookbackBlocks));
      const fromBlock = latest > span ? latest - span : 0n;
      // Don't honour `scanner.batchSize` here — it's a CreateMarket-density
      // setting; SubmitCap on a single vault is sparse enough that a much
      // wider window is fine and keeps the call count manageable on
      // fast-block chains like SEI.
      const configChunk = BigInt(chainConfig.scanner.batchSize);
      const chunk = configChunk > SUBMIT_CAP_CHUNK_BLOCKS ? configChunk : SUBMIT_CAP_CHUNK_BLOCKS;

      const ids = new Set<`0x${string}`>();
      for (let from = fromBlock; from <= latest; from += chunk) {
        const to = from + chunk - 1n > latest ? latest : from + chunk - 1n;
        try {
          const logs = await client.getLogs({
            address: vaultAddress,
            event: SUBMIT_CAP_EVENT,
            fromBlock: from,
            toBlock: to,
          });
          for (const log of logs) {
            const id = log.args.id;
            if (id) ids.add(id as `0x${string}`);
          }
        } catch (err) {
          console.warn('[useVaultSubmitCapMarkets] getLogs chunk failed, skipping', { from, to, err });
        }
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
