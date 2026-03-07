import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import type { Alert } from '../../types';

interface AlertsFeedProps {
  alerts: Alert[];
  onDismiss: (id: string) => void;
  onClearAll: () => void;
}

const SEVERITY_COLORS = {
  critical: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
};

export function AlertsFeed({ alerts, onDismiss, onClearAll }: AlertsFeedProps) {
  const active = alerts.filter((a) => !a.dismissed);

  if (active.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
          <Badge variant="success">All clear</Badge>
        </CardHeader>
        <p className="text-xs text-text-tertiary">No active alerts.</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Alerts</CardTitle>
          <Badge variant="warning">{active.length}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClearAll}>
          Clear All
        </Button>
      </CardHeader>
      <div className="space-y-2">
        {active.slice(0, 10).map((alert) => (
          <div
            key={alert.id}
            className="flex items-center gap-2 text-xs py-1.5 px-2 bg-bg-hover/30 rounded"
          >
            <span className={`font-mono ${SEVERITY_COLORS[alert.severity]}`}>
              {alert.severity === 'critical' ? '!!' : alert.severity === 'warning' ? '!' : 'i'}
            </span>
            <span className="text-text-primary flex-1">{alert.title}</span>
            <span className="text-text-tertiary truncate max-w-[200px]">{alert.description}</span>
            <button
              onClick={() => onDismiss(alert.id)}
              className="text-text-tertiary hover:text-text-secondary ml-2"
              title="Dismiss"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}
