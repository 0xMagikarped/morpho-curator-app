/**
 * PR 31 — small human-friendly duration parser for the V2 Timelocks tab.
 *
 * Accepts:
 *   - `0` / `Instant` / empty / `-` → 0n
 *   - bare integer → seconds
 *   - `<n>s` / `<n>m` / `<n>h` / `<n>d` (decimals allowed for h / d)
 *
 * Returns `null` if the input doesn't parse. Pure — testable without React.
 */
export function parseDurationSeconds(raw: string): bigint | null {
  const s = raw.trim().toLowerCase();
  if (!s || s === 'instant' || s === '-') return 0n;

  // bare integer → seconds
  if (/^\d+$/.test(s)) return BigInt(s);

  // `<n><unit>` where unit ∈ {s, m, h, d}, n may be a decimal for h/d
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/.exec(s);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!isFinite(num) || num < 0) return null;
  const unit = m[2];

  switch (unit) {
    case 's':
      // integers only for seconds to avoid sub-second nonsense
      return /^\d+$/.test(m[1]) ? BigInt(m[1]) : null;
    case 'm':
      return BigInt(Math.round(num * 60));
    case 'h':
      return BigInt(Math.round(num * 3600));
    case 'd':
      return BigInt(Math.round(num * 86400));
    default:
      return null;
  }
}

/**
 * Inverse: format a bigint seconds value as the most readable unit.
 * Pure — used in display + as the default input value when entering
 * Edit mode.
 */
export function formatDurationSeconds(secs: bigint): string {
  if (secs === 0n) return '0';
  const s = Number(secs);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${(s / 60).toFixed(s % 60 === 0 ? 0 : 2)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(s % 3600 === 0 ? 0 : 2)}h`;
  return `${(s / 86400).toFixed(s % 86400 === 0 ? 0 : 2)}d`;
}
