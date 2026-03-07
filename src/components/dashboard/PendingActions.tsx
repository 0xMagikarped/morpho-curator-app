import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { formatCountdown } from '../../lib/utils/format';
import type { PendingAction } from '../../types';

interface PendingActionsProps {
  actions: Array<PendingAction & { vaultName?: string; chainId: number }>;
}

export function PendingActions({ actions }: PendingActionsProps) {
  const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    if (actions.length === 0) return;
    const interval = setInterval(() => {
      setNowSeconds(BigInt(Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(interval);
  }, [actions.length]);

  if (actions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending Timelocked Actions</CardTitle>
        <Badge variant="warning">{actions.length}</Badge>
      </CardHeader>
      <div className="space-y-2">
        {actions.map((action, i) => {
          const isReady = action.validAt > 0n && action.validAt <= nowSeconds;

          return (
            <div
              key={i}
              className="flex items-center justify-between py-2 px-3 bg-bg-hover/30 rounded text-xs"
            >
              <div>
                <div className="flex items-center gap-2">
                  {action.vaultName && (
                    <span className="text-text-tertiary">{action.vaultName}</span>
                  )}
                  <Badge variant={isReady ? 'success' : 'warning'}>
                    {action.type}
                  </Badge>
                  <span className="text-text-primary">{action.description}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isReady ? (
                  <Badge variant="success">Ready</Badge>
                ) : action.validAt > 0n ? (
                  <span className="text-text-tertiary">
                    {formatCountdown(action.validAt)}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
