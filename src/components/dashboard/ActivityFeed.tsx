import { useState } from 'react';
import { Activity, Copy, Check } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Badge } from '../ui/Badge';
export type EventType = 'deposit' | 'withdraw' | 'rebalance' | 'liquidation';

export interface ActivityEvent {
  type: EventType;
  amount: string;
  vaultOrMarket: string;
  txHash: string;
  timestamp: number; // unix ms
}

interface ActivityFeedProps {
  events: ActivityEvent[];
  loading?: boolean;
  blockExplorerUrl?: string;
}

const eventBadgeVariant: Record<EventType, 'info' | 'default' | 'purple' | 'danger'> = {
  deposit: 'info',
  withdraw: 'default',
  rebalance: 'purple',
  liquidation: 'danger',
};

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncateHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

export function ActivityFeed({ events, loading, blockExplorerUrl }: ActivityFeedProps) {
  if (loading) {
    return (
      <Card className="!p-3">
        <CardHeader className="!mb-2">
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <div className="space-y-0">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-2 py-2 border-b border-border-subtle/30">
              <div className="h-4 w-14 bg-bg-hover rounded animate-shimmer" />
              <div className="h-4 w-20 bg-bg-hover rounded animate-shimmer" />
              <div className="flex-1" />
              <div className="h-3 w-12 bg-bg-hover rounded animate-shimmer" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card className="!p-3">
        <CardHeader className="!mb-2">
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <Activity size={20} className="text-text-tertiary" />
          <p className="text-xs text-text-tertiary">No recent on-chain activity</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="!p-3">
      <CardHeader className="!mb-2">
        <CardTitle>Activity</CardTitle>
        <Badge>{events.length}</Badge>
      </CardHeader>
      <div className="space-y-0">
        {events.slice(0, 10).map((event, i) => (
          <ActivityRow
            key={`${event.txHash}-${i}`}
            event={event}
            blockExplorerUrl={blockExplorerUrl}
          />
        ))}
      </div>
    </Card>
  );
}

function ActivityRow({
  event,
  blockExplorerUrl,
}: {
  event: ActivityEvent;
  blockExplorerUrl?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(event.txHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center gap-2 py-2 border-b border-border-subtle/30 last:border-0 group">
      <Badge variant={eventBadgeVariant[event.type]} className="text-[10px] min-w-[68px] justify-center">
        {event.type}
      </Badge>
      <span className="font-mono text-sm text-text-primary whitespace-nowrap">
        {event.amount}
      </span>
      <span className="text-xs text-text-secondary truncate flex-1 min-w-0">
        {event.vaultOrMarket}
      </span>
      <div className="flex items-center gap-1.5 shrink-0">
        {blockExplorerUrl ? (
          <a
            href={`${blockExplorerUrl}/tx/${event.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-text-tertiary hover:text-info transition-colors"
          >
            {truncateHash(event.txHash)}
          </a>
        ) : (
          <span className="text-[11px] font-mono text-text-tertiary">
            {truncateHash(event.txHash)}
          </span>
        )}
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 min-w-[28px] min-h-[28px] flex items-center justify-center"
          aria-label={`Copy transaction hash ${event.txHash}`}
        >
          {copied ? (
            <Check size={12} className="text-success" />
          ) : (
            <Copy size={12} className="text-text-tertiary hover:text-text-secondary" />
          )}
        </button>
      </div>
      <span className="text-[11px] font-mono text-text-tertiary whitespace-nowrap">
        {formatRelativeTime(event.timestamp)}
      </span>
    </div>
  );
}
