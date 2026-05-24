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
 * Pure — used by general display code.
 */
export function formatDurationSeconds(secs: bigint): string {
  if (secs === 0n) return '0';
  const s = Number(secs);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${(s / 60).toFixed(s % 60 === 0 ? 0 : 2)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(s % 3600 === 0 ? 0 : 2)}h`;
  return `${(s / 86400).toFixed(s % 86400 === 0 ? 0 : 2)}d`;
}

/**
 * PR 32 — format ALWAYS as a number of days. Used by the V2 Timelocks
 * table where the curator asked for a single, consistent unit instead
 * of the auto-picked-unit display.
 *
 *   0     → "0"
 *   30    → "0.000347d"        (sub-day still shows, no clipping)
 *   86400 → "1d"                (integer day → no decimals)
 *   43200 → "0.5d"              (clean half)
 *   90000 → "1.041667d"         (mixed values → up to 6 dp, trailing 0s stripped)
 *
 * `parseDurationSeconds` still accepts every unit shape — only the
 * display + the edit-mode input pre-fill are unified to days.
 */
export function formatDurationDays(secs: bigint): string {
  // PR 35 — zero still wears the "d" suffix so the column reads as a
  // single consistent unit ("0d", "1d", "7d"). Previously zero rendered
  // as bare "0" which made the user think days hadn't kicked in.
  if (secs === 0n) return '0d';
  const days = Number(secs) / 86400;
  if (Number.isInteger(days)) return `${days}d`;
  // Up to 6 decimal places, strip trailing zeros (and a trailing `.`).
  const fixed = days.toFixed(6);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return `${trimmed}d`;
}
