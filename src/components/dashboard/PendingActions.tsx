import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
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
    return (
      <Card className="!p-3">
        <CardHeader className="!mb-2">
          <CardTitle>Pending Actions</CardTitle>
          <Badge variant="success">None</Badge>
        </CardHeader>
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <Clock size={16} className="text-text-tertiary" />
          <p className="text-xs text-text-tertiary">No timelocked actions pending</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="!p-3">
      <CardHeader className="!mb-2">
        <CardTitle>Pending Actions</CardTitle>
        <Badge variant="warning">{actions.length}</Badge>
      </CardHeader>
      <div className="space-y-0">
        {actions.map((action, i) => {
          const isReady = action.validAt > 0n && action.validAt <= nowSeconds;

          return (
            <div
              key={i}
              className="flex items-center justify-between py-2 border-b border-border-subtle/30 last:border-0 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                {action.vaultName && (
                  <span className="text-text-tertiary truncate max-w-[100px]">{action.vaultName}</span>
                )}
                <Badge variant={isReady ? 'success' : 'warning'} className="text-[10px]">
                  {action.type}
                </Badge>
                <span className="text-text-primary truncate">{action.description}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {isReady ? (
                  <Badge variant="success" className="text-[10px]">Ready</Badge>
                ) : action.validAt > 0n ? (
                  <span className="text-text-tertiary font-mono text-[11px]">
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
