import { Lock, Repeat, Calendar } from 'lucide-react';
import { getChainConfig } from '../../../config/chains';
import { useMoolahMarketSurfaces } from '../../../lib/hooks/useMoolahSingleton';

interface MoolahMarketBadgesProps {
  chainId: number;
  marketId: `0x${string}` | undefined;
}

/**
 * Inline badges surfaced per market on Moolah chains.
 * - [Permissioned]     → marketWhitelistEnabled(id)
 * - [Auto-yield · LST] → providers(id, 0x0) != 0 (usually BNB / slisBNB)
 * - [Fixed-term]       → brokers(id) != 0
 *
 * Silent (renders nothing) on non-Moolah chains and while loading.
 */
export function MoolahMarketBadges({ chainId, marketId }: MoolahMarketBadgesProps) {
  const config = getChainConfig(chainId);
  const { data } = useMoolahMarketSurfaces(chainId, marketId);

  if (config?.protocol !== 'moolah' || !data) return null;

  const providerLabel = (() => {
    if (!data.provider) return null;
    const providers = config.moolah?.providers ?? {};
    const match = Object.entries(providers).find(
      ([, addr]) => addr.toLowerCase() === data.provider!.toLowerCase(),
    );
    return match ? match[0] : 'LST';
  })();

  const anyBadge = data.marketWhitelistEnabled || data.provider || data.broker;
  if (!anyBadge) return null;

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {data.marketWhitelistEnabled && (
        <span
          className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-mono bg-info/10 border border-info/30 text-info"
          title="Market has supply/liquidation whitelist enabled. Only allow-listed accounts can interact."
        >
          <Lock size={8} />
          PERMISSIONED
        </span>
      )}
      {data.provider && (
        <span
          className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-mono bg-accent-primary/10 border border-accent-primary/30 text-accent-primary"
          title={`Smart provider attached — auto-yield on collateral via ${data.provider}`}
        >
          <Repeat size={8} />
          AUTO-YIELD · {providerLabel?.toUpperCase()}
        </span>
      )}
      {data.broker && (
        <span
          className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-mono bg-[#F0B90B]/10 border border-[#F0B90B]/30 text-[#F0B90B]"
          title={`Fixed-term market — broker ${data.broker}`}
        >
          <Calendar size={8} />
          FIXED · BROKER
        </span>
      )}
    </span>
  );
}
