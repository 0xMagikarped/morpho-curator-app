import type { RiskAlert } from '../../lib/risk/riskTypes';

interface RiskAlertBannerProps {
  alerts: RiskAlert[];
  maxShow?: number;
}

const SEVERITY_STYLES = {
  critical: 'bg-danger/15 border-danger/20 text-danger',
  warning: 'bg-warning/10 border-warning/20 text-warning',
  info: 'bg-info/15 border-info/20 text-info',
};

const SEVERITY_ICONS = {
  critical: '!!',
  warning: '!',
  info: 'i',
};

export function RiskAlertBanner({ alerts, maxShow = 3 }: RiskAlertBannerProps) {
  if (alerts.length === 0) return null;

  const topSeverity = alerts[0].severity;
  const shown = alerts.slice(0, maxShow);
  const remaining = alerts.length - shown.length;

  return (
    <div className={`rounded border p-3 text-xs space-y-1.5 ${SEVERITY_STYLES[topSeverity]}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
        </span>
      </div>
      {shown.map((alert) => (
        <div key={alert.id} className="flex items-center gap-2">
          <span className="font-mono">{SEVERITY_ICONS[alert.severity]}</span>
          <span>{alert.title}</span>
          {alert.description && (
            <span className="text-text-tertiary ml-auto truncate max-w-[200px]">
              {alert.description}
            </span>
          )}
        </div>
      ))}
      {remaining > 0 && (
        <p className="text-text-tertiary">+{remaining} more</p>
      )}
    </div>
  );
}
