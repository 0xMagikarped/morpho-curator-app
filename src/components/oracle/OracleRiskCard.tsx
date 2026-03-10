import type { Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { ProgressBar } from '../ui/ProgressBar';
import { OracleTypeBadge } from './OracleTypeBadge';
import { OracleRiskBadge } from './OracleRiskBadge';
import { useOracleInfo, useOracleHealth, useOracleRiskScore } from '../../lib/hooks/useOracle';
import { truncateAddress } from '../../lib/utils/format';

interface OracleRiskCardProps {
  chainId: number;
  oracleAddress: Address;
}

export function OracleRiskCard({ chainId, oracleAddress }: OracleRiskCardProps) {
  const { data: info, isLoading: infoLoading } = useOracleInfo(chainId, oracleAddress);
  const { data: health } = useOracleHealth(chainId, oracleAddress);
  const { data: risk } = useOracleRiskScore(chainId, oracleAddress);

  if (infoLoading) {
    return (
      <Card>
        <div className="animate-shimmer h-32 bg-bg-hover/50" />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Oracle</CardTitle>
          {info && <OracleTypeBadge type={info.type} model={info.model} showModel />}
        </div>
        {risk && <OracleRiskBadge grade={risk.grade} score={risk.overall} />}
      </CardHeader>

      <div className="space-y-3">
        {/* Address */}
        <div className="text-xs">
          <span className="text-text-tertiary">Address: </span>
          <span className="text-text-primary font-mono">{truncateAddress(oracleAddress, 6)}</span>
        </div>

        {/* Health */}
        {health && (
          <div className="flex items-center gap-3 text-xs">
            <span className={health.isResponding ? 'text-success' : 'text-danger'}>
              {health.isResponding ? 'Responding' : 'Not responding'}
            </span>
            {health.isResponding && (
              <span className="text-text-tertiary">{health.latencyMs}ms</span>
            )}
            {health.currentPrice != null && health.currentPrice > 0n && (
              <span className="text-text-secondary font-mono">
                Price: {health.currentPrice.toString().slice(0, 12)}...
              </span>
            )}
            {health.error && (
              <span className="text-danger truncate max-w-[200px]">{health.error}</span>
            )}
          </div>
        )}

        {/* Morpho wrapper info */}
        {info?.isMorphoWrapper && info.underlyingFeeds && info.underlyingFeeds.length > 0 && (
          <div className="text-xs">
            <span className="text-text-tertiary">Underlying feeds: </span>
            {info.underlyingFeeds.map((f, i) => (
              <span key={f} className="text-text-secondary font-mono">
                {i > 0 && ' / '}
                {truncateAddress(f)}
              </span>
            ))}
          </div>
        )}

        {/* Risk dimensions */}
        {risk && (
          <div className="space-y-2 pt-2 border-t border-border-subtle">
            {risk.dimensions.map((dim) => (
              <div key={dim.name}>
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <span className="text-text-secondary">{dim.name}</span>
                  <span className="text-text-tertiary">{dim.score}/100</span>
                </div>
                <ProgressBar
                  value={dim.score}
                  variant={dim.score >= 70 ? 'default' : dim.score >= 40 ? 'default' : 'default'}
                  className="h-1"
                />
                <p className="text-[10px] text-text-tertiary mt-0.5">{dim.rationale}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
