import { cn } from '../../lib/utils/cn';

interface VersionBadgeProps {
  version: 'v1' | 'v2';
  className?: string;
}

export function VersionBadge({ version, className }: VersionBadgeProps) {
  const isV1 = version === 'v1';
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wide',
        isV1 ? 'bg-version-v1/15 text-version-v1' : 'bg-version-v2/15 text-version-v2',
        className,
      )}
      title={isV1 ? 'MetaMorpho V1 — Queue-based allocation' : 'MetaMorpho V2 — Adapter-based allocation'}
    >
      {version.toUpperCase()}
    </span>
  );
}
