import type { OracleHealth } from '../../lib/oracle/oracleTypes';

interface OracleHealthIndicatorProps {
  health: OracleHealth | null | undefined;
}

export function OracleHealthIndicator({ health }: OracleHealthIndicatorProps) {
  if (!health) {
    return <span className="inline-block w-2 h-2 rounded-full bg-text-tertiary animate-pulse" title="Checking..." />;
  }

  if (health.isResponding) {
    const color = health.latencyMs < 1000 ? 'bg-success' : 'bg-warning';
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${color}`}
        title={`Responding (${health.latencyMs}ms)`}
      />
    );
  }

  return (
    <span
      className="inline-block w-2 h-2 rounded-full bg-danger"
      title={health.error ?? 'Not responding'}
    />
  );
}
