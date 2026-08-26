/**
 * `1.37% → 1.36%` with the arrow coloured by direction.
 *
 * Shared by the V1 Reallocate tab and the V2 Allocation tab's reallocate
 * dialog so a projected rate reads identically on both. Extracted from
 * V2AllocationTab when V1 gained rate projection — the same reasoning as
 * lib/vault/utilizationTarget: parity has to be structural, not remembered.
 */
export function RateDelta({
  from,
  to,
  digits = 2,
  higherIsBetter = true,
  className,
}: {
  from: number;
  to: number | null;
  digits?: number;
  /** Whether an increase is good news, which decides the colour. */
  higherIsBetter?: boolean;
  className?: string;
}) {
  const fmt = (v: number) => `${v.toFixed(digits)}%`;
  const base = `font-mono text-text-tertiary${className ? ` ${className}` : ''}`;

  if (to === null) {
    return (
      <span className={base}>
        {fmt(from)} <span aria-hidden>→</span> —
      </span>
    );
  }

  // Below the display precision the arrow would point at a change the user
  // can't see. Treat that as unchanged rather than colouring noise.
  const epsilon = Math.pow(10, -digits) / 2;
  const diff = to - from;
  const tone =
    Math.abs(diff) < epsilon
      ? 'text-text-tertiary'
      : diff > 0 === higherIsBetter
        ? 'text-accent-primary'
        : 'text-warning';

  return (
    <span className={base}>
      {fmt(from)} <span aria-hidden>→</span> <span className={tone}>{fmt(to)}</span>
    </span>
  );
}
