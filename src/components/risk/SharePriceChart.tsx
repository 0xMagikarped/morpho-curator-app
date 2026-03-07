import type { SharePriceRecord } from '../../lib/risk/riskTypes';

interface SharePriceChartProps {
  history: SharePriceRecord[];
  height?: number;
  width?: number;
}

export function SharePriceChart({ history, height = 40, width = 160 }: SharePriceChartProps) {
  if (history.length < 2) {
    return (
      <div className="text-xs text-text-tertiary" style={{ height, width }}>
        Collecting data...
      </div>
    );
  }

  // Sort ascending by time
  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const prices = sorted.map((r) => Number(BigInt(r.sharePrice)));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  // Determine trend
  const first = prices[0];
  const last = prices[prices.length - 1];
  const isUp = last >= first;
  const color = isUp ? '#34d399' : '#f87171'; // success / danger

  // Build SVG path
  const padding = 2;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const points = prices.map((p, i) => {
    const x = padding + (i / (prices.length - 1)) * innerW;
    const y = padding + innerH - ((p - min) / range) * innerH;
    return `${x},${y}`;
  });

  const pathD = points.map((p, i) => (i === 0 ? `M ${p}` : `L ${p}`)).join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block"
    >
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
