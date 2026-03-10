import { useEffect, useRef, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Card } from '../ui/Card';

interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean;
  sparklineData?: number[];
  loading?: boolean;
}

export function StatCard({ label, value, delta, deltaPositive, sparklineData, loading }: StatCardProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValue = useRef(value);
  const motionOk = useRef(true);

  useEffect(() => {
    motionOk.current = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (!motionOk.current || prevValue.current === value) {
      setDisplayValue(value);
      prevValue.current = value;
      return;
    }

    // Animate count-up: extract number, interpolate over 300ms
    const numMatch = value.match(/([\d,.]+)/);
    const prevMatch = prevValue.current.match(/([\d,.]+)/);
    if (!numMatch || !prevMatch) {
      setDisplayValue(value);
      prevValue.current = value;
      return;
    }

    const target = parseFloat(numMatch[1].replace(/,/g, ''));
    const start = parseFloat(prevMatch[1].replace(/,/g, ''));
    const prefix = value.slice(0, numMatch.index);
    const suffix = value.slice((numMatch.index ?? 0) + numMatch[1].length);
    const startTime = performance.now();
    const duration = 300;

    const animate = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const current = start + (target - start) * eased;
      // Detect if value is an integer (no decimals in original) vs a decimal
      const isInteger = Number.isInteger(target) && !numMatch[1].includes('.');
      const formatted = isInteger
        ? Math.round(current).toLocaleString('en-US')
        : target >= 100
          ? Math.round(current).toLocaleString('en-US')
          : current.toFixed(target < 1 ? 4 : 2);
      setDisplayValue(`${prefix}${formatted}${suffix}`);
      if (t < 1) requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
    prevValue.current = value;
  }, [value]);

  if (loading) {
    return (
      <Card className="!p-3">
        <div className="h-3 w-16 bg-bg-hover animate-shimmer mb-2" />
        <div className="h-6 w-24 bg-bg-hover animate-shimmer mb-1" />
        <div className="h-3 w-12 bg-bg-hover animate-shimmer" />
      </Card>
    );
  }

  const chartData = sparklineData?.map((v, i) => ({ i, v }));

  return (
    <Card className="!p-3">
      <p className="text-[11px] font-sans uppercase tracking-wider text-text-tertiary mb-1">
        {label}
      </p>
      <p className="text-2xl font-mono font-semibold text-text-primary leading-tight">
        {displayValue}
      </p>
      <div className="flex items-center justify-between mt-1">
        {delta ? (
          <span
            className={`inline-flex items-center gap-0.5 text-xs font-mono ${
              deltaPositive ? 'text-success' : 'text-danger'
            }`}
          >
            {deltaPositive ? (
              <TrendingUp size={12} />
            ) : (
              <TrendingDown size={12} />
            )}
            {delta}
          </span>
        ) : (
          <span />
        )}
        {chartData && chartData.length > 1 && (
          <div className="w-[60px] h-[24px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="var(--color-accent-primary)"
                  strokeWidth={1.5}
                  strokeOpacity={0.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </Card>
  );
}
