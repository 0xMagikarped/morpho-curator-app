/**
 * Live countdown to a timelock's `executableAt`.
 *
 * The V2 drawers used to render only the raw UTC unlock timestamp, which
 * reads as static text — there was nothing on screen that looked like a
 * timelock actually running. This ticks every second and shows the remaining
 * time alongside the absolute unlock time.
 */
import { useEffect, useState } from 'react';

/** `3d 04:12:09` / `04:12:09` / `12:09`. Empty string once elapsed. */
function formatRemaining(seconds: number): string {
  if (seconds <= 0) return '';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function TimelockCountdown({
  executableAt,
  className,
}: {
  /** Unix seconds. */
  executableAt: bigint;
  className?: string;
}) {
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Number(executableAt) - nowSec;
  const unlockUtc = new Date(Number(executableAt) * 1000).toUTCString();

  if (remaining <= 0) {
    return (
      <span className={className}>
        <span className="font-mono">unlocked</span>{' '}
        <span className="text-text-tertiary">({unlockUtc})</span>
      </span>
    );
  }

  return (
    <span className={className}>
      <span className="font-mono tabular-nums">{formatRemaining(remaining)}</span>{' '}
      <span className="text-text-tertiary">remaining · unlocks {unlockUtc}</span>
    </span>
  );
}
