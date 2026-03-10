import { useState, useRef, useEffect } from 'react';

interface AllocationSegment {
  name: string;
  value: number; // USD or raw amount
  percentage: number; // 0-100
  formattedValue: string; // e.g. "$42.8M"
}

interface AllocationBarProps {
  segments: AllocationSegment[];
  loading?: boolean;
}

const SEGMENT_COLORS = [
  'var(--color-info)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-accent-primary)',
  'var(--color-migration)',
  'var(--color-chain-ethereum)',
  'var(--color-chain-base)',
  'var(--color-danger)',
];

export function AllocationBar({ segments, loading }: AllocationBarProps) {
  const [tooltip, setTooltip] = useState<{ x: number; segment: AllocationSegment } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setTooltip(null);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  if (loading) {
    return (
      <div>
        <div className="h-2 w-full bg-bg-hover animate-shimmer mb-3" />
        <div className="flex gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-3 w-20 bg-bg-hover animate-shimmer" />
          ))}
        </div>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className="h-2 w-full bg-bg-hover" />
    );
  }

  return (
    <div>
      {/* Bar */}
      <div
        ref={barRef}
        className="relative flex h-2 w-full overflow-hidden"
      >
        {segments.map((seg, i) => (
          <div
            key={seg.name}
            className="h-full transition-all duration-100 ease-out cursor-pointer"
            style={{
              width: `${Math.max(seg.percentage, 0.5)}%`,
              backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
            }}
            onMouseEnter={(e) => {
              const rect = barRef.current?.getBoundingClientRect();
              if (rect) {
                setTooltip({ x: e.clientX - rect.left, segment: seg });
              }
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-10 px-2 py-1.5 bg-bg-elevated border border-border-default text-xs pointer-events-none"
          style={{
            transform: `translateX(${tooltip.x}px) translateY(-100%)`,
            marginTop: '-8px',
          }}
        >
          <p className="text-text-primary font-medium">{tooltip.segment.name}</p>
          <p className="font-mono text-text-secondary">
            {tooltip.segment.formattedValue} · {tooltip.segment.percentage.toFixed(1)}%
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.map((seg, i) => (
          <div key={seg.name} className="flex items-center gap-1.5">
            <span
              className="inline-block w-1.5 h-1.5"
              style={{ backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
            />
            <span className="text-xs text-text-secondary">{seg.name}</span>
            <span className="text-[11px] font-mono text-text-tertiary">{seg.percentage.toFixed(0)}%</span>
            <span className="text-[11px] font-mono text-text-tertiary">{seg.formattedValue}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
