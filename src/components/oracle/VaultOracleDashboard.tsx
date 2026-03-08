import { useMemo } from 'react';
import type { Address } from 'viem';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { OracleHealthIndicator } from './OracleHealthIndicator';
import { OracleTypeBadge } from './OracleTypeBadge';
import { OracleRiskBadge } from './OracleRiskBadge';
import { useOracleInfo, useOracleHealth, useOracleRiskScore } from '../../lib/hooks/useOracle';
import { truncateAddress } from '../../lib/utils/format';

interface VaultOracleDashboardProps {
  chainId: number;
  oracleAddresses: Address[];
  marketLabels?: Map<Address, string>; // oracle addr -> market label
}

export function VaultOracleDashboard({ chainId, oracleAddresses, marketLabels }: VaultOracleDashboardProps) {
  const unique = useMemo(
    () => [...new Set(oracleAddresses.filter((a) => a !== '0x0000000000000000000000000000000000000000'))],
    [oracleAddresses],
  );

  if (unique.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Oracle Health</CardTitle>
        <Badge>{unique.length} oracle{unique.length !== 1 ? 's' : ''}</Badge>
      </CardHeader>
      <div className="space-y-1">
        {unique.map((addr) => (
          <OracleRow
            key={addr}
            chainId={chainId}
            oracleAddress={addr}
            label={marketLabels?.get(addr)}
          />
        ))}
      </div>
    </Card>
  );
}

function OracleRow({
  chainId,
  oracleAddress,
  label,
}: {
  chainId: number;
  oracleAddress: Address;
  label?: string;
}) {
  const { data: info } = useOracleInfo(chainId, oracleAddress);
  const { data: health } = useOracleHealth(chainId, oracleAddress);
  const { data: risk } = useOracleRiskScore(chainId, oracleAddress);

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-bg-hover/30 rounded text-xs">
      <OracleHealthIndicator health={health} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-text-primary font-mono">{truncateAddress(oracleAddress)}</span>
          {info && <OracleTypeBadge type={info.type} />}
        </div>
        {label && <p className="text-[10px] text-text-tertiary mt-0.5">{label}</p>}
      </div>
      <div className="flex items-center gap-2">
        {health && !health.isResponding && health.error && (
          <span className="text-danger text-[10px] max-w-[120px] truncate" title={health.error}>
            {health.error.length > 20 ? health.error.slice(0, 20) + '...' : health.error}
          </span>
        )}
        {health?.latencyMs != null && health.latencyMs > 0 && (
          <span className="text-text-tertiary">{health.latencyMs}ms</span>
        )}
        {risk && <OracleRiskBadge grade={risk.grade} score={risk.overall} compact />}
      </div>
    </div>
  );
}
