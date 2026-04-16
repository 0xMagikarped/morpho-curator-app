import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { RiskAlert } from '../../lib/risk/riskTypes';

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

interface RiskAlertBannerProps {
  alerts: RiskAlert[];
  maxShow?: number; // kept for API compat but no longer used
}

export function RiskAlertBanner({ alerts }: RiskAlertBannerProps) {
  const [expanded, setExpanded] = useState(false);

  if (alerts.length === 0) return null;

  const topSeverity = alerts[0].severity;

  return (
    <div className={`border text-xs ${SEVERITY_STYLES[topSeverity]}`}>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer hover:opacity-80 transition-opacity"
      >
        <span className="font-medium">
          {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
        </span>
        <ChevronDown
          size={14}
          className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {alerts.map((alert) => (
            <div key={alert.id} className="flex items-center gap-2">
              <span className="font-mono shrink-0">{SEVERITY_ICONS[alert.severity]}</span>
              <span>{alert.title}</span>
              {alert.description && (
                <span className="text-text-tertiary ml-auto truncate max-w-[200px]">
                  {alert.description}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
